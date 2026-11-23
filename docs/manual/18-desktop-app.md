> 🌐 **English** · [Español](es/18-app-de-escritorio.md)

# Desktop app

Cartero also comes as a native desktop app for macOS, Windows and Linux. It works on its own as soon as you install it: your collections, environments and history are stored **on your computer**, and requests are sent **from your machine**, so they reach your `localhost`, your VPN and your local network. If you want, you can connect it to a Cartero server to sync workspaces across computers and work as a team.

## Install

Download the installer for your system (always the latest version):

| System | Download | Notes |
|---|---|---|
| macOS (Apple Silicon and Intel) | [Cartero-macos-universal.dmg](https://github.com/elrincondeisma/cartero/releases/latest/download/Cartero-macos-universal.dmg) | Open the `.dmg` and drag **Cartero** to **Applications**. It's signed and notarized by Apple, so it opens without warnings. |
| Windows 10/11 | [Cartero-windows-x64-setup.exe](https://github.com/elrincondeisma/cartero/releases/latest/download/Cartero-windows-x64-setup.exe) | If SmartScreen warns you, click **More info** → **Run anyway**. |
| Linux (Debian, Ubuntu) | [cartero-linux-amd64.deb](https://github.com/elrincondeisma/cartero/releases/latest/download/cartero-linux-amd64.deb) | `sudo apt install ./cartero-linux-amd64.deb` |
| Linux (any distribution) | [Cartero-linux-x86_64.AppImage](https://github.com/elrincondeisma/cartero/releases/latest/download/Cartero-linux-x86_64.AppImage) | `chmod +x Cartero-linux-x86_64.AppImage` and run it. |

Older versions are on the [releases page](https://github.com/elrincondeisma/cartero/releases). You can also download it from Cartero's web app: **Help (?) → Download the desktop app**.

The first time it opens, the app creates a workspace with an example collection against httpbin.org and an `httpbin` environment, so you can press **Send** right away.

## The window

- **Activity bar** (left): Collections, Environments and History. Click the active one again to hide the sidebar (`Ctrl+B`).
- **Collections**: tree with folders. Right-click for new request or folder, run, auth/scripts/variables, export, rename, duplicate and delete. Drag requests and folders to move them, also between collections.
- **Tabs**: each request opens in a tab. A dot means unsaved changes. Open tabs come back the next time you start the app.
- **Title bar**: workspace switcher, sync status, active environment, cookies and search (`Ctrl+K`).

## Sending requests

It works like the web app ([Requests](02-requests.md)):

- **Method and URL.** Paste a `curl` command into the URL bar and it becomes the request.
- Under the URL you can see every `{{variable}}` with its value and where it comes from (environment, collection or global); undefined ones are red.
- **Params** stay in sync with the URL. `:id` style path variables get their own table.
- **Authorization**: inherit, none, Basic, Bearer, API key, Digest, OAuth 1.0, OAuth 2.0 (getting a token with the browser and PKCE, client credentials or password), AWS Signature v4 and Hawk.
- **Body**: raw (JSON, text, XML, HTML, JavaScript), x-www-form-urlencoded, form-data with files, binary and GraphQL.
- **Scripts**: pre-request and post-response, with the `pm.*` API and snippets. The collection and its folders can have their own scripts, which run first ([Scripts and tests](05-scripts-and-tests.md)).
- **Response**: pretty or raw body (huge bodies are shown without colours to keep the app smooth), image preview, headers, cookies, phase timings (DNS, TCP, TLS, first byte, download), tests and console.
- **View as code**: cURL, HTTPie, JavaScript fetch, Node.js axios, Python requests, Go, PHP, C# and PowerShell.

Cookies sent by servers are stored per workspace and sent automatically; manage them with the cookie button in the title bar.

Requests leave **from your machine**, so they reach an API on the internet just as well as `localhost`, your local network or your VPN.

## Contracts

Each request's **Contract** tab works just like in the web app ([Contracts](19-contracts.md)). The checks use the same engine, so the results are identical.

- **Create the contract**: generate it from the last response or start from scratch. Edit it with the field tree, the parameter and header tables, or as JSON Schema.
- **On send**: next to the status code you'll see **Matches** or **N failures**. The response's **Contract** tab splits what was sent from what came back.
- **On save**: if the change would break whoever already uses the contract, a dialog lists the changes before saving.
- **History**: every version is kept on your machine, even if you're not connected to a server. If you sync, the server also records each contract change in its history.

## Local mock

Right-click a collection → **Start local mock**. The app starts a server on your machine (`http://127.0.0.1:4010`, or the next free port) and copies its URL.

- It answers like the web app's [mock servers](08-mock-servers.md): with your saved examples and, when none matches, with data generated from the contract.
- It accepts the `x-mock-response-*` headers.
- It uses the variables from the active environment.
- It allows requests from the browser (CORS), so your frontend can point at that URL with no backend and no connection.
- What you save applies straight away, without restarting it.
- While it's running, the collection shows its port. Stop it with **Stop local mock**; it also stops when you switch workspace or close the app.

## Environments and variables

**Environments** in the activity bar: create, edit and choose the active one (also from the title bar). Mark a variable as **secret** with the eye icon: its value is hidden and stored encrypted with a key kept in your system keychain. Global variables are at the bottom of the list. When a script calls `pm.environment.set`, the value is saved in the environment (you can turn that off in Settings).

## Runner

Right-click a collection or folder → **Run**. Choose iterations, delay, a CSV or JSON data file (one iteration per row) and whether to stop on the first failure. Results appear as they arrive; you can export them as JSON or JUnit. `pm.execution.setNextRequest` and `skipRequest` work like in Postman.

## Import and export

**Import** (`Ctrl+O`, or the button next to Collections) accepts, pasted or from a file:

- Postman collections v1, v2.0 and v2.1, and Postman environments and globals;
- a full Cartero export;
- **OpenAPI 3.0/3.1** specs in JSON or YAML: each operation becomes a request with its contract;
- cURL commands.

Right-click a collection:
- **Export (Postman v2.1)** saves it without losing anything.
- **Export OpenAPI 3.1 (YAML)** or **(JSON)** generates the spec with the contracts.

## Connecting to a Cartero server

Settings → **Servers**:

1. Type your server address and click **Connect with the browser**. The server's `/connect-desktop` page opens; sign in if needed and click **Connect**. The app receives a token through `127.0.0.1` (nothing leaves your computer). You can also paste a token created in the web app (Settings → API tokens).
2. You will see the server's workspaces. **Download** one to have it on this computer, or **Upload** the current workspace to the server.

A synced workspace shows a cloud in the title bar. The app syncs every few seconds, as soon as someone else changes something (WebSocket) and when you click **Sync now**. It works offline too: changes wait until the server is reachable again. Your request history and runner results are uploaded so the team can see them in the web app. The avatars next to the status show who else is connected.

**Conflicts.** If someone changed on the server the same thing you changed here, the status turns orange. Open **Resolve conflicts…**: you see both versions and choose **Keep mine** or **Keep the server's**.

Mock servers, monitors and published docs are managed in the web app.

## Settings

- **General**: theme (light, dark or same as the system) and language (Spanish or English).
- **Requests**: timeout, redirects, SSL certificate verification, script timeout and response highlighting limit.
- **Proxy**: HTTP proxy (HTTPS goes through a CONNECT tunnel) with an exception list.
- **Certificates**: client certificates for mutual TLS (per domain, PEM) and custom CA certificates.
- **About**: version, data folder and update checks.

## Keyboard shortcuts

On macOS use `⌘` instead of `Ctrl`.

| Shortcut | Action |
|---|---|
| `Ctrl+T` / `Ctrl+N` | New request |
| `Ctrl+Enter` | Send |
| `Ctrl+S` | Save |
| `Ctrl+W` | Close tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+K` / `Ctrl+P` | Search requests and commands |
| `Ctrl+L` | Go to the URL bar |
| `Ctrl+O` | Import |
| `Ctrl+B` | Show or hide the sidebar |
| `Ctrl+Shift+F` | Search in collections |
| `Ctrl+,` | Settings |

## Where your data lives

| System | Folder |
|---|---|
| macOS | `~/Library/Application Support/Cartero` |
| Windows | `%APPDATA%\Cartero` |
| Linux | `~/.local/share/Cartero` |

It is an SQLite database (`cartero.db`). Back it up by copying the folder with the app closed.
