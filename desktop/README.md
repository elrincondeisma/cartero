> 🌐 **English** · [Español](README.es.md)

# Cartero Desktop

A native desktop API client written in Rust: local first (your collections live on your computer), with an optional connection to a Cartero server to sync and collaborate. Requests are sent **from your machine**, so they reach your `localhost`, your VPN and your network.

> **Status: phase F0 (foundations).** Not usable yet. See the roadmap below.

| Crate | What it does |
|---|---|
| `app` | The application, built with [GPUI](https://www.gpui.rs) and [gpui-component](https://github.com/longbridge/gpui-component) |
| `crates/model` | Data model: a superset of Postman Collection v2.1, variables, URLs, import/export |
| `crates/http` | HTTP engine (hyper + rustls) that times DNS, TCP, TLS, first byte and download separately |
| `crates/script` | `pm.*` script sandbox on QuickJS, with the same libraries Postman offers (chai, lodash, crypto-js…) |
| `js/` | Builds the sandbox library bundle (`crates/script/assets/sandbox-libs.js`, committed so `cargo build` doesn't need Node) |

## Build

```bash
# Linux only: system libraries for GPUI
sudo apt install libxkbcommon-dev libxkbcommon-x11-dev libwayland-dev libvulkan-dev libfontconfig-dev libx11-xcb-dev libxcb1-dev

cd desktop
cargo run -p cartero-desktop          # the app
cargo test --workspace                # tests (add -- --include-ignored for the ones that need Internet)
```

To change the sandbox libraries: `cd desktop/js && npm install && npm run build`.

## Roadmap

1. **F0 · Foundations** — workspace, CI on macOS/Windows/Linux and three risk spikes: GPUI with very large text, `pm.*` scripts on QuickJS, per-phase HTTP timings. ✅
2. **F1 · Local client** — collection tree, tabs, request editor, response viewer, environments and variables, history, Postman and cURL import/export.
3. **F2 · Scripts, tests and runner** — full `pm.*` API, console, collection runner, more auth methods, code snippets.
4. **F3 · Optional server** — connect to a Cartero server, two-way sync with conflict handling, presence.
5. **F4 · Product** — English and Spanish, themes, shortcuts, installers, auto-update.

### F0 results

| Spike | Result |
|---|---|
| UI: code editor with a 15 MB JSON (832,000 lines, tree-sitter highlighting) | First frame in 181 ms (91 ms empty); jumping to the end and typing is instant. 597 MB of memory: for huge responses, highlighting will be turned off above a size limit |
| Scripts: the same `pm.*` scripts the server test suite runs with postman-runtime | Pass, including chai assertions, `require('lodash')` and `require('crypto-js')`. Infinite loops are cut off. ~59 ms per run (to be lowered with precompiled bytecode in F2) |
| HTTP: real HTTPS with HTTP/2 | DNS, TCP, TLS, first byte and download measured separately; clear errors for refused connections, invalid URLs and timeouts |
