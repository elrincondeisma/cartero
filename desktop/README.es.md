> 🌐 [English](README.md) · **Español**

# Cartero Desktop

Un cliente de APIs de escritorio nativo, escrito en Rust: local primero (tus colecciones viven en tu ordenador), con conexión opcional a un servidor de Cartero para sincronizar y colaborar. Las peticiones salen **desde tu máquina**, así que llegan a tu `localhost`, tu VPN y tu red.

> **Estado: fase F0 (base).** Todavía no se puede usar. Mira la hoja de ruta más abajo.

| Crate | Qué hace |
|---|---|
| `app` | La aplicación, hecha con [GPUI](https://www.gpui.rs) y [gpui-component](https://github.com/longbridge/gpui-component) |
| `crates/model` | Modelo de datos: superconjunto de Postman Collection v2.1, variables, URLs, importar y exportar |
| `crates/http` | Motor HTTP (hyper + rustls) que mide por separado DNS, TCP, TLS, primer byte y descarga |
| `crates/script` | Sandbox de scripts `pm.*` sobre QuickJS, con las mismas librerías que Postman (chai, lodash, crypto-js…) |
| `js/` | Genera el paquete de librerías del sandbox (`crates/script/assets/sandbox-libs.js`, versionado para que `cargo build` no necesite Node) |

## Compilar

```bash
# Solo en Linux: librerías de sistema para GPUI
sudo apt install libxkbcommon-dev libxkbcommon-x11-dev libwayland-dev libvulkan-dev libfontconfig-dev libx11-xcb-dev libxcb1-dev

cd desktop
cargo run -p cartero-desktop          # la app
cargo test --workspace                # tests (añade -- --include-ignored para los que necesitan Internet)
```

Para cambiar las librerías del sandbox: `cd desktop/js && npm install && npm run build`.

## Hoja de ruta

1. **F0 · Base**: workspace, CI en macOS/Windows/Linux y tres pruebas de riesgo: GPUI con texto muy grande, scripts `pm.*` en QuickJS y tiempos HTTP por fase. ✅
2. **F1 · Cliente local**: árbol de colecciones, pestañas, editor de peticiones, visor de respuestas, entornos y variables, historial, importar y exportar Postman y cURL.
3. **F2 · Scripts, tests y runner**: API `pm.*` completa, consola, runner de colecciones, más autenticaciones, snippets de código.
4. **F3 · Servidor opcional**: conectar con un servidor de Cartero, sincronización en los dos sentidos con conflictos, presencia.
5. **F4 · Producto**: español e inglés, temas, atajos, instaladores y actualización automática.

### Resultados de la F0

| Prueba | Resultado |
|---|---|
| Interfaz: editor de código con un JSON de 15 MB (832 000 líneas, resaltado tree-sitter) | Primer fotograma en 181 ms (91 ms vacío); saltar al final y escribir es instantáneo. 597 MB de memoria: para respuestas enormes se desactivará el resaltado a partir de un tamaño |
| Scripts: los mismos scripts `pm.*` que la suite del servidor ejecuta con postman-runtime | Pasan, con aserciones de chai, `require('lodash')` y `require('crypto-js')`. Los bucles infinitos se cortan. ~59 ms por ejecución (se bajará con bytecode precompilado en la F2) |
| HTTP: HTTPS real con HTTP/2 | DNS, TCP, TLS, primer byte y descarga medidos por separado; errores claros para conexión rechazada, URL no válida y tiempo de espera |
