#!/bin/sh
# Updater de Cartero para Docker Compose (y la EC2 del despliegue de AWS).
#
# Cartero no puede reiniciarse a sí mismo: cuando alguien pulsa «Actualizar» en Administración, deja
# el fichero `request` en la carpeta compartida. Este contenedor lo recoge, descarga otra vez la imagen
# `:stable` y recrea solo el servicio `cartero`. No abre puertos y no acepta parámetros: lo único que
# puede pedir la app es «vuelve a descargar stable».
#
# Necesita: el socket de Docker, la carpeta del proyecto en /project (solo lectura) y la carpeta
# compartida con Cartero en $SHARED (por defecto /shared/updater).
set -u

SHARED=${SHARED:-/shared/updater}
SERVICE=${SERVICE:-cartero}
mkdir -p "$SHARED"
chown 1000:1000 "$SHARED" 2>/dev/null || true # Cartero corre como node (uid 1000)

# Mismo proyecto de Compose que el que nos ha arrancado
PROJECT=$(docker inspect "$(hostname)" --format '{{ index .Config.Labels "com.docker.compose.project" }}')
dc() { docker compose -p "$PROJECT" --project-directory /project "$@"; }

status() {
  # El mensaje va a JSON: sin comillas, barras ni saltos de línea
  msg=$(printf '%s' "$2" | tr -d '"\\' | tr '\n\r\t' '   ' | cut -c1-300)
  printf '{"state":"%s","at":"%s","message":"%s"}\n' "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$msg" >"$SHARED/status.tmp"
  mv "$SHARED/status.tmp" "$SHARED/status.json"
}

echo "Updater de Cartero: proyecto $PROJECT, servicio $SERVICE"
while true; do
  touch "$SHARED/heartbeat"
  if [ -f "$SHARED/request" ]; then
    rm -f "$SHARED/request"
    # La imagen del contenedor en marcha (`config --images` las lista todas, en cualquier orden)
    image=$(docker inspect --format '{{ .Config.Image }}' $(dc ps -q "$SERVICE") 2>&1 | head -n 1)
    case "$image" in
      *:stable)
        status running "Descargando $image"
        echo "Actualizando $image"
        if out=$(dc pull --quiet "$SERVICE" 2>&1) && out=$(dc up -d --no-deps "$SERVICE" 2>&1); then
          status done "$image"
          echo "Hecho"
        else
          status failed "$out"
          echo "Falló: $out"
        fi
        ;;
      *)
        status failed "La imagen no es :stable ($image): la versión está fijada"
        ;;
    esac
  fi
  sleep 10
done
