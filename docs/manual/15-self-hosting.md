> 🌐 **English** · [Español](es/15-autoalojamiento.md)

# Installation and administration

## Install with Docker

```bash
git clone https://github.com/elrincondeisma/cartero.git && cd cartero
cp .env.example .env
# Edit .env: at least CARTERO_SECRET_KEY (openssl rand -base64 32) and POSTGRES_PASSWORD
docker compose up -d
```

Four containers start: **cartero** (web, API and monitor worker), **postgres**, **redis** and **updater** (applies updates when you ask for them from Administration). Cartero uses the latest published version (the `stable` image). Open `http://localhost:3000` (or the `CARTERO_PORT` port).

> **On AWS** there's a wizard that does all of this for you with CDK (ECS Fargate or EC2): see [Deploying to AWS](20-deploy-aws.md).

## First start: the setup wizard

The first time you open a new Cartero, a step-by-step wizard appears instead of the login page. Nobody can sign up until it creates the first account.

1. **Welcome**: checks that the database is ready and warns you if you're still using the development encryption key. You also pick the language.
2. **Admin account**: the account you'll manage Cartero with.
3. **Your instance**: its name and the **public URL** people will use. Cartero fills in the address you opened it from.
4. **Who can get in**: open sign-up, only your company's email domains, or invitation only.
5. **Google and GitHub** (optional): turn on social sign-in with the credentials of an OAuth app.
6. **Email** (optional): an SMTP server for invitations and alerts, with a test email.
7. **Security**: whether Cartero lives on a private network (requests can reach your LAN) or is exposed to the Internet (private IPs are blocked).
8. **Done**: a summary. When you go in, Cartero offers a guided tour and sample data.

If you close the browser halfway, you'll continue where you left off the next time you sign in. Everything you choose can be changed later in [Administration](17-admin-and-social-login.md), where you can also reopen the wizard (**System** tab, or **?** → **Setup wizard**).

## Environment variables

Only what the server needs **before it starts** has to be an environment variable:

| Variable | Description |
|---|---|
| `CARTERO_SECRET_KEY` | **Required in production.** Encrypts secrets. If you lose it, stored secrets can't be decrypted |
| `DATABASE_URL`, `REDIS_URL` | PostgreSQL 14+ and Redis (docker-compose sets them for you) |
| `POSTGRES_PASSWORD`, `CARTERO_PORT` | Database password and published port (docker-compose) |
| `ADMIN_EMAILS` | Accounts that become instance admins at every start (comma-separated). Useful to recover access |
| `INLINE_WORKER` | `false` to run monitors in a separate process (`node dist/worker.js`) |
| `CARTERO_TELEMETRY` | `off` turns off the anonymous daily statistics, overriding Administration. See [Telemetry](22-telemetry.md) |

Everything else is set in **Administration**. These variables still exist, but only as the **initial value** for a new instance:

| Variable | In Administration |
|---|---|
| `PUBLIC_URL` | General → Public URL |
| `ALLOW_REGISTRATION` | Sign-in → Who can create an account |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Sign-in → Google / GitHub |
| `SMTP_URL`, `SMTP_FROM` | Email |
| `BLOCK_PRIVATE_NETWORKS` | Security |

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

## Recovering access

If nobody can sign in as admin, use the commands in [Administration → If nobody can get in](17-admin-and-social-login.md#if-nobody-can-get-in).

## Updating

Cartero tells admins when there's a new version and updates from **Administration → System** with one button, thanks to the `updater` container. The details, how to pin a version or remove the `updater`: [Updating Cartero](21-updating.md).

By hand:

```bash
docker compose pull
docker compose up -d
```

Database migrations run automatically on startup.

## Sample data from the terminal

```bash
cd apps/server
pnpm demo seed   --email person@example.com   # loads the "Demo Cartero" workspace
pnpm demo revert --email person@example.com   # removes it
```
