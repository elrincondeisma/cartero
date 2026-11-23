> 🌐 **English** · [Español](es/22-telemetria.md)

# Telemetry

Once a day, each Cartero installation sends an anonymous report to `cartero.elrincondeisma.com`. It contains counts and technical details, so we know how many people use Cartero, which version they run, which features they use and which errors show up. **It never contains your content.** It's on by default, and you can turn it off at any time.

## What is never sent

- Requests, URLs, headers, bodies or responses.
- Collections, folder or request names, environments, variables or secrets.
- Emails, names, accounts or workspace names.
- Your server's IP address. The collector only keeps the country that Vercel deduces from the connection, and it doesn't store the IP.

## What is sent

You can see the exact report in **Administration → System → Anonymous statistics → See what is sent**.

| Group | Fields |
|---|---|
| Installation | A random installation ID (generated the first time; it isn't derived from anything about you), version, channel (`stable` or a fixed version), how it runs (`docker-compose`, `aws-ec2`, `aws-fargate`, `source`, `dev`), operating system and architecture, Node and PostgreSQL major versions, whether Redis is available, days since installation |
| Configuration | Yes/no only: Google or GitHub sign-in on, SMTP set up, open registration, domain restriction, private-network blocking, update checks and automatic updates, setup finished |
| Size | Numbers of users, admins, active users (7 and 30 days), personal and team workspaces, collections, saved requests, environments, mocks, monitors, published docs, API tokens used in 30 days |
| Usage since the last report | Requests sent, runs by origin (app, CLI, monitor, desktop) and result, mock hits, comments, imports by format (`postman-collection`, `openapi-3`, `curl`…), MCP calls by tool name, cURL commands pasted |
| Errors | 5xx errors by route pattern and status code (for example `POST /api/workspaces/:ws/import 500`, never the message), failed updates |

## Turning it off

Any of these turns it off:

- **Administration → System → Anonymous statistics**, or the switch in the last step of the setup wizard.
- The environment variable `CARTERO_TELEMETRY=off` (in `.env` with Docker Compose). It takes priority over the panel.
- The standard variable `DO_NOT_TRACK=1`.

When it's off, nothing is sent and nothing is counted.

## Where the data goes

Reports go to a Vercel function at `cartero.elrincondeisma.com/api/telemetry` and are stored in a PostgreSQL database (Neon, in the EU). Only Cartero's maintainers can see them, and only as totals: how many installations, versions and features. Reports older than 13 months are deleted.

The code that builds the report is in [`apps/server/src/lib/telemetry.ts`](../../apps/server/src/lib/telemetry.ts), and the collector is in [`apps/landing/src/pages/api/telemetry.ts`](../../apps/landing/src/pages/api/telemetry.ts).
