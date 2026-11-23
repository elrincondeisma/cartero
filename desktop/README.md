> 🌐 **English** · [Español](README.es.md)

# Cartero Desktop

A native desktop API client written in Rust: local first (your collections live on your computer), with an optional connection to a Cartero server to sync and collaborate. Requests are sent **from your machine**, so they reach your `localhost`, your VPN and your network.

User guide: [docs/manual/18-desktop-app.md](../docs/manual/18-desktop-app.md). Installers: [Releases](https://github.com/elrincondeisma/cartero/releases).

| Crate | What it does |
|---|---|
| `app` | The application, built with [GPUI](https://www.gpui.rs) and [gpui-component](https://github.com/longbridge/gpui-component) (via `gpui-kit`) |
| `crates/model` | Data model (a superset of Postman Collection v2.1), lossless Postman v1/v2.0/v2.1 and cURL import, export, `{{variables}}`, URLs, auth inheritance and code snippets |
| `crates/http` | HTTP engine (hyper + rustls): per-phase timings, redirects, cookies, decompression, multipart, proxy, client certificates, Digest, OAuth 1.0, AWS SigV4 and Hawk |
| `crates/script` | `pm.*` sandbox on QuickJS with the libraries Postman offers, loaded on demand |
| `crates/runner` | Runs a request with its script chain, and whole collections (iterations, CSV/JSON data, `setNextRequest`, JSON/JUnit reports) |
| `crates/store` | Local SQLite with the server's logical schema, fractional ordering compatible with the server and encrypted secrets |
| `crates/sync` | Optional sync with a Cartero server: pull since a cursor, push with conflict detection, history, runs and a realtime WebSocket |
| `js/` | Builds the sandbox libraries (`crates/script/assets/libs/`) and the contracts and mock engine (`crates/script/assets/engine.js`, made from `packages/contracts` and `packages/mock`: the same code as the web app and the server). They're committed so `cargo build` doesn't need Node; if you change those packages, run `npm run build` here |
| `packaging/` | Icons and installer scripts (`.dmg`, Windows setup, `.deb`, AppImage) |

## Build

```bash
# Linux only: system libraries for GPUI
sudo apt install libxkbcommon-dev libxkbcommon-x11-dev libwayland-dev libvulkan-dev libfontconfig-dev libx11-xcb-dev libxcb1-dev

cd desktop
cargo run -p cartero-desktop          # the app
cargo test --workspace                # tests (add -- --include-ignored for the ones that need Internet)
```

- `CARTERO_DATA_DIR=/tmp/cartero` uses a separate data folder (handy for trying things out).
- Sync test against a real server: start one (for example `scripts/e2e-servers.sh`), create an API token and run `CARTERO_SYNC_TEST_URL=http://127.0.0.1:3201 CARTERO_SYNC_TEST_TOKEN=crt_… cargo test -p cartero-sync`.
- Sandbox libraries: `cd desktop/js && npm install && npm run build`.
- UI strings: the Spanish text is the key, the English translation lives in `app/src/i18n/en.json`; a test fails if one is missing.

## Installers

The **Desktop · installers** workflow (`.github/workflows/desktop-release.yml`) builds them on GitHub Actions:

- With a `desktop-vX.Y.Z` tag it publishes a release.
- Run by hand (Actions → Run workflow) it leaves the installers in a draft release.

| System | Output | Script |
|---|---|---|
| macOS | Universal `.dmg` (Apple Silicon + Intel) | `packaging/macos/package.sh` |
| Windows | `…-windows-x64-setup.exe` (Inno Setup) | `packaging/windows/cartero.iss` |
| Linux | `.deb` and `.AppImage` | `packaging/linux/package.sh` |

**Signing.** Without certificates, the macOS app gets an ad-hoc signature (the first launch needs right-click → Open) and Windows shows a SmartScreen warning. To sign and notarize on macOS, add these repository secrets: `MACOS_CERTIFICATE` (Developer ID Application `.p12` in base64), `MACOS_CERTIFICATE_PASSWORD`, `MACOS_SIGN_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID` and `APPLE_APP_PASSWORD`.

**Updates.** The app checks the releases on start (Settings → About) and offers the download when there is a newer `desktop-v*` version.

## Server endpoints it uses

Native clients authenticate with `Authorization: Bearer crt_…`. On top of the regular API:

- `GET /api/workspaces/:ws/changes?since=…` — what changed since a cursor, including deletions.
- `POST /api/workspaces/:ws/sync` — upload changes. Each operation carries the server content the app saw last (`base`); if the server has something else, it is a conflict.
- `POST /api/workspaces/:ws/history` and `POST /api/workspaces/:ws/runs/report` — history and runner results.
- `/connect-desktop` (web) — signs the app in through the browser, delivering a token to `127.0.0.1`.

## Status

| Phase | |
|---|---|
| F0 · Foundations and risk spikes | ✅ |
| F1 · Local client (tree, tabs, editor, response, environments, history, import/export) | ✅ |
| F2 · Full `pm.*` scripts, runner, cookies, advanced auth, code snippets | ✅ |
| F3 · Optional server: sync, conflicts, presence, history and runs upload | ✅ |
| F4 · English and Spanish, themes, shortcuts, palette, settings, installers, update checks | ✅ (signing certificates pending) |

Next: OpenAPI and Insomnia import, GraphQL schema, WebSocket/SSE/gRPC requests, local mocks, NTLM.
