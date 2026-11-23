> 🌐 [English](README.md) · **Español**

# Cartero de escritorio

Un cliente de APIs de escritorio nativo, escrito en Rust: primero local (tus colecciones viven en tu ordenador) y con conexión opcional a un servidor de Cartero para sincronizar y colaborar. Las peticiones salen **de tu equipo**, así que llegan a tu `localhost`, a tu VPN y a tu red.

Manual de uso: [docs/manual/es/18-app-de-escritorio.md](../docs/manual/es/18-app-de-escritorio.md). Instaladores: [macOS](https://github.com/elrincondeisma/cartero/releases/latest/download/Cartero-macos-universal.dmg) · [Windows](https://github.com/elrincondeisma/cartero/releases/latest/download/Cartero-windows-x64-setup.exe) · [Linux .deb](https://github.com/elrincondeisma/cartero/releases/latest/download/cartero-linux-amd64.deb) · [Linux AppImage](https://github.com/elrincondeisma/cartero/releases/latest/download/Cartero-linux-x86_64.AppImage) ([todas las versiones](https://github.com/elrincondeisma/cartero/releases)).

| Crate | Qué hace |
|---|---|
| `app` | La aplicación, con [GPUI](https://www.gpui.rs) y [gpui-component](https://github.com/longbridge/gpui-component) (a través de `gpui-kit`) |
| `crates/model` | Modelo de datos (superconjunto de Postman Collection v2.1), importación sin pérdidas de Postman v1/v2.0/v2.1 y cURL, exportación, `{{variables}}`, URL, herencia de la auth y fragmentos de código |
| `crates/http` | Motor HTTP (hyper + rustls): tiempos por fase, redirecciones, cookies, descompresión, multipart, proxy, certificados de cliente, Digest, OAuth 1.0, AWS SigV4 y Hawk |
| `crates/script` | Sandbox `pm.*` sobre QuickJS con las librerías que ofrece Postman, cargadas bajo demanda |
| `crates/runner` | Ejecuta una petición con su cadena de scripts y colecciones enteras (iteraciones, datos CSV/JSON, `setNextRequest`, informes JSON/JUnit) |
| `crates/store` | SQLite local con el esquema lógico del servidor, orden fraccional compatible con el servidor y secretos cifrados |
| `crates/sync` | Sincronización opcional con un servidor de Cartero: bajar desde un cursor, subir con detección de conflictos, historial, ejecuciones y WebSocket en tiempo real |
| `js/` | Empaqueta las librerías del sandbox (`crates/script/assets/libs/`) y el motor de contratos y mock (`crates/script/assets/engine.js`, hecho con `packages/contracts` y `packages/mock`: el mismo código que la web y el servidor). Están versionados para que `cargo build` no necesite Node; si cambias esos paquetes, ejecuta `npm run build` aquí |
| `packaging/` | Iconos y scripts de los instaladores (`.dmg`, instalador de Windows, `.deb`, AppImage) |

## Compilar

```bash
# Solo Linux: librerías del sistema para GPUI
sudo apt install libxkbcommon-dev libxkbcommon-x11-dev libwayland-dev libvulkan-dev libfontconfig-dev libx11-xcb-dev libxcb1-dev

cd desktop
cargo run -p cartero-desktop          # la app
cargo test --workspace                # tests (añade -- --include-ignored para los que necesitan Internet)
```

- `CARTERO_DATA_DIR=/tmp/cartero` usa otra carpeta de datos (útil para hacer pruebas).
- Prueba de sincronización contra un servidor real: levanta uno (por ejemplo, `scripts/e2e-servers.sh`), crea un token de API y ejecuta `CARTERO_SYNC_TEST_URL=http://127.0.0.1:3201 CARTERO_SYNC_TEST_TOKEN=crt_… cargo test -p cartero-sync`.
- Librerías del sandbox: `cd desktop/js && npm install && npm run build`.
- Textos de la interfaz: el texto en español es la clave y la traducción inglesa va en `app/src/i18n/en.json`; un test falla si falta alguna.

## Instaladores

El workflow **Desktop · instaladores** (`.github/workflows/desktop-release.yml`) los genera en GitHub Actions:

- Con una etiqueta `desktop-vX.Y.Z` publica una release.
- Lanzado a mano (Actions → Run workflow) deja los instaladores en un borrador de release.

| Sistema | Resultado | Script |
|---|---|---|
| macOS | `.dmg` universal (Apple Silicon + Intel) | `packaging/macos/package.sh` |
| Windows | `…-windows-x64-setup.exe` (Inno Setup) | `packaging/windows/cartero.iss` |
| Linux | `.deb` y `.AppImage` | `packaging/linux/package.sh` |

**Firma.** Sin certificados, la app de macOS va con firma ad hoc (la primera vez hay que abrirla con clic derecho → Abrir) y Windows muestra un aviso de SmartScreen. Para firmar y notarizar en macOS, añade estos secretos al repositorio: `MACOS_CERTIFICATE` (el `.p12` de Developer ID Application en base64), `MACOS_CERTIFICATE_PASSWORD`, `MACOS_SIGN_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID` y `APPLE_APP_PASSWORD`.

**Actualizaciones.** La app consulta las releases al arrancar (Ajustes → Acerca de) y ofrece la descarga si hay una versión `desktop-v*` más nueva.

## Endpoints del servidor que usa

Los clientes nativos se autentican con `Authorization: Bearer crt_…`. Además de la API de siempre:

- `GET /api/workspaces/:ws/changes?since=…` — lo que ha cambiado desde un cursor, también lo borrado.
- `POST /api/workspaces/:ws/sync` — subir cambios. Cada operación lleva el contenido del servidor que la app vio por última vez (`base`); si el servidor tiene otra cosa, es un conflicto.
- `POST /api/workspaces/:ws/history` y `POST /api/workspaces/:ws/runs/report` — historial y resultados del runner.
- `/connect-desktop` (web) — conecta la app con el navegador y le entrega un token a través de `127.0.0.1`.

## Estado

| Fase | |
|---|---|
| F0 · Base y pruebas de riesgo | ✅ |
| F1 · Cliente local (árbol, pestañas, editor, respuesta, entornos, historial, importar y exportar) | ✅ |
| F2 · Scripts `pm.*` completos, runner, cookies, autenticaciones avanzadas, fragmentos de código | ✅ |
| F3 · Servidor opcional: sincronización, conflictos, presencia, subida de historial y ejecuciones | ✅ |
| F4 · Español e inglés, temas, atajos, paleta, ajustes, instaladores y aviso de actualizaciones | ✅ (faltan los certificados de firma) |

Siguiente: importar OpenAPI e Insomnia, esquema de GraphQL, peticiones WebSocket/SSE/gRPC, mocks locales y NTLM.
