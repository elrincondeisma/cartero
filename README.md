> 🌐 **English** · [Español](README.es.md)

# Cartero

[![Cartero product video (1 minute)](apps/landing/public/video/poster-en.jpg)](https://github.com/elrincondeisma/cartero/raw/main/apps/landing/public/video/cartero-en.mp4)

**An open-source, self-hosted web API client.** A Postman alternative that includes what Postman charges for, free and without limits: collection runner, mock servers, monitors, published documentation and team collaboration. Import your Postman collections without losing anything.

> MIT · TypeScript · One `docker compose up` and you're done

## What's included

| | |
|---|---|
| **Requests** | REST and GraphQL; params, headers, body (raw/JSON/XML, form-data with files, urlencoded, binary); history; cookies; code snippets in 20+ languages |
| **Authentication** | Basic, Bearer, API Key, JWT, Digest, OAuth 1.0, **OAuth 2.0** (Authorization Code + PKCE, Client Credentials, Password, Implicit, refresh), Hawk, AWS SigV4, NTLM, Akamai EdgeGrid; inherited folder → collection |
| **Scripts** | Pre-request and post-response scripts with Postman's `pm.*` API (run by `postman-runtime`): `pm.test`, `pm.expect`, `pm.sendRequest`, `pm.environment`, `setNextRequest`… with autocomplete |
| **Variables** | Global, collection, folder, environment and iteration data. Secret variables are encrypted at rest (AES-256-GCM) |
| **Import / export** | Postman (v1, v2.0 and v2.1 collections, environments, globals, data dumps and export ZIPs), Insomnia (v4 JSON and v5 YAML), OpenAPI 3.0/3.1, Swagger 2.0 and cURL. Exports to Postman v2.1 (lossless round trip) |
| **Runner** | Run collections or folders without limits, with iterations, CSV/JSON data, delay, "stop on first failure" and live results |
| **CLI** | `cartero run`, a Newman equivalent for CI: console, JSON, JUnit and HTML reporters; runs files or collections from your server and uploads the result |
| **Mock servers** | Respond with your saved examples: routes with parameters, `x-mock-response-*` headers, dynamic variables (`{{$randomEmail}}`…), simulated latency, private mocks and a call log |
| **Monitors** | Scheduled runs with cron and time zone; alerts via Slack, Discord, Telegram, email or webhook; history with uptime and timings |
| **Documentation** | A public page per collection with Markdown descriptions, examples and cURL. Optional password. Credentials are hidden automatically |
| **AI (MCP)** | Built-in MCP server (`/mcp`) with 18 tools: Claude, Cursor and other assistants can browse, send, run, create requests and import, with your permissions |
| **Languages** | UI, user guide and sample data in **English and Spanish**, with a language switch saved to your account |
| **Help** | Welcome wizard, guided tour, command palette (Ctrl+K), [full user guide](docs/manual/README.md) at `/ayuda` and sample data with real APIs that you can remove in one click |
| **Teams** | Workspaces, invitations, roles (owner, admin, editor, viewer), real-time presence, comments, change history with restore, fork and merge, API tokens |
| **Sign-in and admin** | Email and password, **Google** and **GitHub**. Admin panel to manage accounts (admin/user roles, disable, delete), open sign-up, allowed email domains and OAuth credentials |

## Getting started

```bash
git clone https://github.com/elrincondeisma/cartero.git && cd cartero
cp .env.example .env        # change CARTERO_SECRET_KEY and POSTGRES_PASSWORD
docker compose up -d
```

Open `http://localhost:3000` and create your account.

The first account you create is the instance admin. From **Administration** (account menu) you can close sign-up, limit it to your email domains, turn on Google and GitHub sign-in and manage accounts. See the [user guide](docs/manual/17-admin-and-social-login.md).

### Configuration

| Variable | Default | Description |
|---|---|---|
| `CARTERO_SECRET_KEY` | — (required) | Key used to encrypt secrets. Generate one with `openssl rand -base64 32` and **don't lose it** |
| `DATABASE_URL` | — | PostgreSQL 14 or later |
| `REDIS_URL` | — | Redis (for monitors) |
| `PUBLIC_URL` | `http://localhost:3000` | Public URL: invitation links, OAuth and alerts |
| `ALLOW_REGISTRATION` | `true` | Initial value for open sign-up (then changed in the admin panel) |
| `ADMIN_EMAILS` | — | Accounts that are instance admins, comma-separated |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Google sign-in (optional; can also be set in the admin panel) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | — | GitHub sign-in (optional; can also be set in the admin panel) |
| `BLOCK_PRIVATE_NETWORKS` | `false` | Blocks requests to private IPs (SSRF protection). Turn it on if your instance is public |
| `SMTP_URL` / `SMTP_FROM` | — | To send invitations and email alerts |
| `INLINE_WORKER` | `true` | `false` to run monitors in a separate process (`node dist/worker.js`) |

> **Behind a proxy (Traefik, Caddy, Nginx):** also forward the WebSocket connections on `/api/ws`, used for presence and live changes.

## Connect AI assistants (MCP)

In **Settings → Connect AI (MCP)** you create a token and copy the configuration for your client. For example, in Claude Code:

```bash
claude mcp add --transport http cartero https://cartero.example.com/mcp --header "Authorization: Bearer crt_xxx"
```

More in the [user guide](docs/manual/13-ai-mcp.md).

## CLI

```bash
# Run an exported Postman file with an environment and data
npx @cartero/cli run collection.postman_collection.json -e prod.postman_environment.json -d data.csv -r cli,junit

# Run a collection from your server and upload the result
CARTERO_SERVER=https://cartero.example.com CARTERO_TOKEN=crt_xxx \
  npx @cartero/cli run <collection-id> -e <environment-id> --workspace <workspace-id> --report
```

Exit codes: `0` if everything passes, `1` if a test or request fails, `2` on a usage error.

## Architecture

```
apps/
  server/     Fastify + Drizzle (PostgreSQL) + BullMQ (Redis) + WebSocket
  web/        React 19 + Vite + Tailwind + TanStack Query + Monaco
  landing/    Astro website (English and Spanish)
packages/
  core/       Data model (a superset of Postman Collection v2.1)
  executor/   Runs requests with postman-runtime in an isolated process (time and memory limits)
  importers/  Postman, Insomnia, OpenAPI, cURL
  exporters/  Postman v2.1 and code snippets
  cli/        cartero run
  mcp/        MCP server (stdio and Streamable HTTP)
docs/manual/  User guide in English; Spanish in docs/manual/es (also served at /ayuda)
video/        Promo video (Remotion)
```

Requests are sent **from the server**. That means no CORS problems, and you can test APIs on your local network. User scripts run in a child process with time and memory limits.

## Development

Requirements: Node 22+, pnpm 12+ and Docker.

```bash
pnpm install
pnpm db:up                     # development Postgres (5433) and Redis (6380)
pnpm --filter "./packages/*" build
pnpm --filter @cartero/server dev   # API on :3000
pnpm --filter @cartero/web dev      # Web on :5173
```

Tests:

```bash
pnpm test                      # unit and integration (needs pnpm db:up)
npx playwright test            # E2E (with the API and web running)
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before sending a PR.

## License

[MIT](LICENSE). Cartero uses `postman-runtime`, `postman-collection`, `postman-collection-transformer`, `openapi-to-postmanv2` and `postman-code-generators`, all licensed under Apache-2.0. Cartero is not affiliated with Postman, Inc.
