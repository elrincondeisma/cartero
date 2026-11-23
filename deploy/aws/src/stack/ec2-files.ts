/**
 * Lo que monta la EC2 al arrancar. El user data es estático (no cambia entre despliegues, así la
 * máquina nunca se reemplaza ni se reinicia por un cambio): instala Docker, escribe estos ficheros
 * y lanza `apply.sh`, que lee la configuración de SSM y los secretos de Secrets Manager.
 * «Actualizar» del asistente cambia el parámetro de SSM y vuelve a lanzar `apply.sh` con SSM Run Command.
 * «Actualizar» de la app lo hace el contenedor `updater` (el mismo que en Docker Compose): descarga
 * otra vez `:stable` y recrea solo Cartero.
 */
import { readFileSync } from 'node:fs'
import { aws_ec2 as ec2 } from 'aws-cdk-lib'

/** El script del updater es el mismo que el del docker-compose.yml de la raíz del repo. */
export const UPDATER = readFileSync(new URL('../../../../docker/updater.sh', import.meta.url), 'utf8')

export const COMPOSE = `services:
  cartero:
    image: \${CARTERO_IMAGE}
    restart: unless-stopped
    environment:
      NODE_ENV: production
      DATABASE_URL: \${DATABASE_URL}
      REDIS_URL: \${REDIS_URL}
      CARTERO_SECRET_KEY: \${CARTERO_SECRET_KEY}
      PUBLIC_URL: \${PUBLIC_URL}
      ADMIN_EMAILS: \${ADMIN_EMAILS}
      ALLOW_REGISTRATION: \${ALLOW_REGISTRATION}
      FILES_DIR: /data/files
      CARTERO_UPDATER: compose
      CARTERO_CHANNEL: \${CARTERO_CHANNEL}
      CARTERO_DEPLOY: aws-ec2
    volumes:
      - /data/cartero/files:/data/files
      - /data/cartero/updater:/data/updater
  updater:
    image: docker:28-cli
    restart: unless-stopped
    command: ["sh", "/project/updater.sh"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /opt/cartero:/project:ro
      - /data/cartero/updater:/shared/updater
  postgres:
    image: postgres:17-alpine
    profiles: [db]
    restart: unless-stopped
    environment:
      POSTGRES_USER: cartero
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      POSTGRES_DB: cartero
    volumes:
      - /data/postgres:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
    profiles: [redis]
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - /data/redis:/data
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      SITE_ADDRESS: \${SITE_ADDRESS}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - /data/caddy:/data
`

/** Caddy pide y renueva el certificado de Let's Encrypt solo; el WebSocket pasa sin configurar nada. */
export const CADDYFILE = `{$SITE_ADDRESS} {
\tencode zstd gzip
\treverse_proxy cartero:3000
}
`

/** Lee la configuración (SSM) y los secretos, escribe .env y levanta los contenedores. */
export function applyScript(region: string, paramName: string): string {
  return `#!/bin/bash
# Aplica la configuración de Cartero. Lo lanzan el arranque (cartero-apply.service) y «Actualizar».
set -euo pipefail
cd /opt/cartero
REGION='${region}'
PARAM='${paramName}'
CFG=$(aws ssm get-parameter --region "$REGION" --name "$PARAM" --query Parameter.Value --output text)
j() { printf '%s' "$CFG" | jq -r "$1"; }
sec() { aws secretsmanager get-secret-value --region "$REGION" --secret-id "$1" --query SecretString --output text; }
enc() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }

PROFILES=()
KEY=$(sec "$(j .secrets.key)")
POSTGRES_PASSWORD=''
if [ "$(j .db.mode)" = container ]; then
  POSTGRES_PASSWORD=$(sec "$(j .secrets.db)")
  DATABASE_URL="postgres://cartero:$(enc "$POSTGRES_PASSWORD")@postgres:5432/cartero"
  PROFILES+=(db)
else
  DBS=$(sec "$(j .secrets.db)")
  U=$(printf '%s' "$DBS" | jq -r .username)
  P=$(printf '%s' "$DBS" | jq -r .password)
  DATABASE_URL="postgres://$(enc "$U"):$(enc "$P")@$(j .db.host):$(j .db.port)/$(j .db.name)"
  if [ "$(j .db.ssl)" = true ]; then DATABASE_URL="$DATABASE_URL?sslmode=require"; fi
fi
if [ "$(j .cache.mode)" = container ]; then
  REDIS_URL='redis://redis:6379'
  PROFILES+=(redis)
else
  SCHEME=redis; if [ "$(j .cache.tls)" = true ]; then SCHEME=rediss; fi
  AUTH=''
  if [ -n "$(j .secrets.redis)" ]; then AUTH=":$(enc "$(sec "$(j .secrets.redis)" | jq -r .password)")@"; fi
  REDIS_URL="$SCHEME://$AUTH$(j .cache.host):$(j .cache.port)"
fi

umask 077
IMAGE=$(j .image)
# stable se actualiza desde la app; una versión concreta (o un digest) queda fijada
CHANNEL=pinned
case "$IMAGE" in *@*) ;; *:*) CHANNEL=\${IMAGE##*:} ;; esac

cat > .env <<ENV
CARTERO_IMAGE=$IMAGE
CARTERO_CHANNEL=$CHANNEL
SITE_ADDRESS=$(j .site)
PUBLIC_URL=$(j .publicUrl)
ADMIN_EMAILS=$(j .adminEmails)
ALLOW_REGISTRATION=$(j .allowRegistration)
CARTERO_SECRET_KEY=$KEY
DATABASE_URL=$DATABASE_URL
REDIS_URL=$REDIS_URL
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
COMPOSE_PROFILES=$(IFS=,; echo "\${PROFILES[*]:-}")
ENV

mkdir -p /data/cartero/files /data/cartero/updater /data/caddy
chown 1000:1000 /data/cartero/files /data/cartero/updater
docker compose pull --quiet
docker compose up -d --remove-orphans
echo "Cartero aplicado: $(j .image)"
`
}

const SYSTEMD = `[Unit]
Description=Aplicar la configuración de Cartero
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/opt/cartero/apply.sh
RemainAfterExit=yes
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
`

/** Escribe un fichero con un heredoc cuyo delimitador no puede aparecer dentro. */
const write = (path: string, content: string, mode = '644') =>
  `cat > ${path} <<'CARTERO_EOF'\n${content}CARTERO_EOF\nchmod ${mode} ${path}`

export function ec2UserData(region: string, paramName: string): ec2.UserData {
  const ud = ec2.UserData.forLinux()
  ud.addCommands(
    'set -euxo pipefail',
    // En una red existente la IP pública llega con la EIP unos segundos después de arrancar
    'for i in $(seq 1 60); do curl -fsS -m 5 -o /dev/null https://github.com && break; sleep 5; done',
    'dnf install -y docker jq python3',
    'systemctl enable --now docker',
    'mkdir -p /usr/local/lib/docker/cli-plugins',
    'curl -fsSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose',
    'chmod +x /usr/local/lib/docker/cli-plugins/docker-compose',
    'mkdir -p /opt/cartero /data',
    write('/opt/cartero/docker-compose.yml', COMPOSE),
    write('/opt/cartero/Caddyfile', CADDYFILE),
    write('/opt/cartero/apply.sh', applyScript(region, paramName), '755'),
    write('/opt/cartero/updater.sh', UPDATER, '755'),
    write('/etc/systemd/system/cartero-apply.service', SYSTEMD),
    'systemctl daemon-reload',
    'systemctl enable --now cartero-apply.service',
  )
  return ud
}
