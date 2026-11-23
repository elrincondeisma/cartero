> 🌐 [English](../15-self-hosting.md) · **Español**

# Instalación y administración

## Instalación con Docker

```bash
git clone https://github.com/elrincondeisma/cartero.git && cd cartero
cp .env.example .env
# Edita .env: como mínimo CARTERO_SECRET_KEY (openssl rand -base64 32) y POSTGRES_PASSWORD
docker compose up -d
```

Arrancan tres contenedores: **cartero** (web, API y worker de monitores), **postgres** y **redis**. Abre `http://localhost:3000` (o el puerto de `CARTERO_PORT`).

> **En AWS** hay un asistente que lo hace todo por ti con CDK (ECS Fargate o EC2): mira [Desplegar en AWS](20-desplegar-en-aws.md).

## Primer arranque: el asistente

La primera vez que abres un Cartero nuevo aparece un asistente paso a paso en lugar del login. Nadie puede registrarse hasta que crea la primera cuenta.

1. **Bienvenida**: comprueba que la base de datos está lista y te avisa si sigues con la clave de cifrado de desarrollo. También eliges el idioma.
2. **Cuenta de administrador**: la cuenta con la que gestionarás Cartero.
3. **Tu instancia**: su nombre y la **URL pública** con la que se entrará. Cartero rellena la dirección por la que lo has abierto.
4. **Quién puede entrar**: registro abierto, solo los dominios de email de tu empresa o solo por invitación.
5. **Google y GitHub** (opcional): activa el login social con las credenciales de una aplicación OAuth.
6. **Email** (opcional): un servidor SMTP para invitaciones y avisos, con email de prueba.
7. **Seguridad**: si Cartero está en una red privada (las peticiones pueden llegar a tu red local) o expuesto a Internet (se bloquean las IPs privadas).
8. **Listo**: un resumen. Al entrar, Cartero te ofrece un recorrido guiado y datos de ejemplo.

Si cierras el navegador a medias, la próxima vez que entres seguirás donde lo dejaste. Todo lo que elijas se puede cambiar después en [Administración](17-administracion-y-login-social.md), desde donde también puedes volver a abrir el asistente (pestaña **Sistema**, o **?** → **Asistente de instalación**).

## Variables de entorno

Solo tiene que ser variable de entorno lo que el servidor necesita **antes de arrancar**:

| Variable | Descripción |
|---|---|
| `CARTERO_SECRET_KEY` | **Obligatoria en producción.** Cifra los secretos. Si la pierdes, los secretos guardados no se pueden descifrar |
| `DATABASE_URL`, `REDIS_URL` | PostgreSQL 14+ y Redis (docker-compose las pone por ti) |
| `POSTGRES_PASSWORD`, `CARTERO_PORT` | Contraseña de la base de datos y puerto publicado (docker-compose) |
| `ADMIN_EMAILS` | Cuentas que pasan a admin de la instancia en cada arranque (separadas por comas). Sirve para recuperar el acceso |
| `INLINE_WORKER` | `false` para ejecutar los monitores en un proceso aparte (`node dist/worker.js`) |

Todo lo demás se ajusta en **Administración**. Estas variables siguen existiendo, pero solo como **valor inicial** de una instancia nueva:

| Variable | En Administración |
|---|---|
| `PUBLIC_URL` | General → URL pública |
| `ALLOW_REGISTRATION` | Inicio de sesión → Quién puede crear una cuenta |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Inicio de sesión → Google / GitHub |
| `SMTP_URL`, `SMTP_FROM` | Email |
| `BLOCK_PRIVATE_NETWORKS` | Seguridad |

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

## Recuperar el acceso

Si nadie puede entrar como admin, usa los comandos de [Administración → Si nadie puede entrar](17-administracion-y-login-social.md#si-nadie-puede-entrar).

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
