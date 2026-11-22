# Installation and administration

## Install with Docker

```bash
git clone <repository> cartero && cd cartero
cp .env.example .env
# Edit .env: at least CARTERO_SECRET_KEY (openssl rand -base64 32) and POSTGRES_PASSWORD
docker compose up -d
```

Three containers start: **cartero** (web, API and monitor worker), **postgres** and **redis**. Open `http://localhost:3000` (or the `CARTERO_PORT` port).

## Configuration variables

| Variable | Description |
|---|---|
| `CARTERO_SECRET_KEY` | **Required.** Encrypts secrets. If you lose it, stored secret variables can't be decrypted |
| `PUBLIC_URL` | Public URL (invitation links, OAuth callback, alerts) |
| `ALLOW_REGISTRATION` | `false` so only the first user and invitees can sign up |
| `BLOCK_PRIVATE_NETWORKS` | `true` to block requests to private IPs (recommended if reachable from the Internet) |
| `SMTP_URL`, `SMTP_FROM` | To send invitations and alerts by email, e.g. `smtps://user:pass@smtp.example.com:465` |
| `INLINE_WORKER` | `false` to run monitors in a separate process (`node dist/worker.js`) |

## Behind a reverse proxy

Serve Cartero over HTTPS (Traefik, Caddy, Nginx, Tailscale Serve…) and also forward:
- **WebSocket** connections on `/api/ws` (presence and live changes);
- `/mock/*` and `/mcp`.

Example with Caddy:

```
cartero.example.com {
  reverse_proxy localhost:3000
}
```

With Tailscale (private network only): `tailscale serve --bg --https=443 http://127.0.0.1:3000`.

## Backups

- **Data**: back up the database (`docker compose exec postgres pg_dump -U cartero cartero > backup.sql`) and the `cartero-data` volume (files uploaded for form-data).
- **Also keep `CARTERO_SECRET_KEY`**: without it secrets can't be decrypted.
- Each user can export their workspace in **Settings → Workspace → Export workspace**.

## Updating

```bash
git pull
docker compose up -d --build
```

Database migrations run automatically on startup.

## Sample data from the terminal

```bash
cd apps/server
pnpm demo seed   --email person@example.com   # loads the "Demo Cartero" workspace
pnpm demo revert --email person@example.com   # removes it
```
