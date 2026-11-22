> 🌐 [English](../15-self-hosting.md) · **Español**

# Instalación y administración

## Instalación con Docker

```bash
git clone <repositorio> cartero && cd cartero
cp .env.example .env
# Edita .env: como mínimo CARTERO_SECRET_KEY (openssl rand -base64 32) y POSTGRES_PASSWORD
docker compose up -d
```

Se levantan tres contenedores: **cartero** (web, API y worker de monitores), **postgres** y **redis**. Abre `http://localhost:3000` (o el puerto de `CARTERO_PORT`).

## Variables de configuración

| Variable | Descripción |
|---|---|
| `CARTERO_SECRET_KEY` | **Obligatoria.** Cifra los secretos. Si la pierdes, no se podrán descifrar las variables secretas guardadas |
| `PUBLIC_URL` | URL pública (enlaces de invitación, callback de OAuth, avisos) |
| `ALLOW_REGISTRATION` | `false` para que solo puedan entrar el primer usuario y los invitados |
| `BLOCK_PRIVATE_NETWORKS` | `true` para impedir peticiones a IPs privadas (recomendado si es accesible desde Internet) |
| `SMTP_URL`, `SMTP_FROM` | Para enviar invitaciones y avisos por email, p. ej. `smtps://usuario:clave@smtp.ejemplo.com:465` |
| `INLINE_WORKER` | `false` para ejecutar los monitores en otro proceso (`node dist/worker.js`) |

## Detrás de un proxy inverso

Sirve Cartero con HTTPS (Traefik, Caddy, Nginx, Tailscale Serve…) y reenvía también:
- las conexiones **WebSocket** de `/api/ws` (presencia y cambios en vivo);
- `/mock/*` y `/mcp`.

Ejemplo con Caddy:

```
cartero.ejemplo.com {
  reverse_proxy localhost:3000
}
```

Con Tailscale (solo para tu red privada): `tailscale serve --bg --https=443 http://127.0.0.1:3000`.

## Copias de seguridad

- **Datos**: haz copia de la base de datos (`docker compose exec postgres pg_dump -U cartero cartero > copia.sql`) y del volumen `cartero-data` (ficheros subidos para form-data).
- **Guarda también `CARTERO_SECRET_KEY`**: sin ella no se descifran los secretos.
- Cada usuario puede exportar su workspace en **Ajustes → Workspace → Exportar workspace**.

## Actualizar

```bash
git pull
docker compose up -d --build
```

Las migraciones de la base de datos se aplican solas al arrancar.

## Datos de ejemplo desde la terminal

```bash
cd apps/server
pnpm demo seed   --email persona@ejemplo.com   # carga el workspace «Demo Cartero»
pnpm demo revert --email persona@ejemplo.com   # lo quita
```
