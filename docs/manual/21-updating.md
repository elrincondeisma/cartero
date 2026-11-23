> 🌐 **English** · [Español](es/21-actualizar.md)

# Updating Cartero

Each new version of Cartero is published with a version number (`v0.2.0`, `v0.2.1`…), release notes and a Docker image. Installations use the `stable` image, which always points to the latest published version. You can update from Cartero itself.

## From Administration

In **Administration → System → Updates** you see the installed version, the latest published version (with a link to its notes) and an **Update to X.Y.Z** button. When there's a new version, admins also see a notice next to their avatar.

Pressing the button pulls the `stable` image again and restarts Cartero. It takes from a few seconds (Docker Compose) to a few minutes (AWS Fargate), and the page reloads on its own when the new version answers. Database migrations run on startup.

Two switches in the same card:

- **Check for new versions.** Cartero asks GitHub for the list of versions every six hours. Turn it off if your server has no internet access or you'd rather it didn't.
- **Update automatically every night.** If there's a new version, Cartero updates between 03:00 and 05:00 UTC. It's off by default.

## What restarts Cartero

Cartero can't restart itself, so the button asks for a restart from whatever runs it. The request has no parameters: it can only mean "pull `stable` again".

| Where it runs | What restarts it |
|---|---|
| Docker Compose (`docker-compose.yml` in the repository) | The `updater` container: it pulls `stable` and recreates only the `cartero` service. |
| AWS EC2 (the AWS wizard) | The same `updater` container, next to Cartero on the machine. |
| AWS Fargate (the AWS wizard) | ECS: Cartero asks for a new deployment of its own service. Its role can do this only on the stack's cluster. |

**The `updater` container** uses the official `docker:cli` image and the script in [`docker/updater.sh`](../../docker/updater.sh). It has no ports. It communicates with Cartero through a shared folder, and every 10 seconds it checks whether there's a request. It needs the Docker socket, which **is equivalent to root access on the machine**. If you don't want that, delete the `updater` service from `docker-compose.yml`: Cartero will still tell you about new versions, and you update by hand:

```bash
docker compose pull
docker compose up -d
```

## Pinning a version

To stay on a specific version and update when you decide:

- **Docker Compose:** set `CARTERO_VERSION=0.2.0` in `.env` and run `docker compose up -d`. Cartero shows "the version is pinned" instead of the button. To go back to automatic updates, remove the line.
- **AWS:** in *Resource by resource* mode, the wizard asks for the version (`stable` or `X.Y.Z`). To change it, run `pnpm deploy:aws` again and pick **Update**.

## If an update fails

- **Fargate:** ECS starts the new version alongside the old one, and only switches traffic when it answers `/api/health`. If it fails, the circuit breaker goes back to the previous version on its own.
- **Docker Compose and EC2:** if the image can't be pulled, nothing changes. If the new version doesn't start, `docker compose logs cartero` shows why.

In both cases, Administration shows the error. Before updating an important installation, make a backup (see [Backups](15-self-hosting.md#backups)).

## Building from source

If you build the image yourself, Cartero is a development build: it tells you about new versions, but it doesn't update itself.

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```
