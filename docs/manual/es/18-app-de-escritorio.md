> 🌐 [English](../18-desktop-app.md) · **Español**

# App de escritorio

Cartero también es una app de escritorio nativa para macOS, Windows y Linux. Funciona sola nada más instalarla: tus colecciones, entornos e historial se guardan **en tu ordenador**, y las peticiones salen **desde tu equipo**, así que llegan a tu `localhost`, a tu VPN y a tu red local. Si quieres, la conectas a un servidor de Cartero para sincronizar workspaces entre ordenadores y trabajar en equipo.

## Instalarla

Descarga el instalador de tu sistema en la [página de releases](https://github.com/elrincondeisma/cartero/releases):

| Sistema | Fichero | Notas |
|---|---|---|
| macOS (Apple Silicon e Intel) | `Cartero-…-macos-universal.dmg` | Abre el `.dmg` y arrastra **Cartero** a **Aplicaciones**. Si la versión no está firmada, la primera vez haz clic derecho en la app → **Abrir** → **Abrir**. |
| Windows 10/11 | `Cartero-…-windows-x64-setup.exe` | Si SmartScreen avisa, pulsa **Más información** → **Ejecutar de todas formas**. |
| Linux | `.deb` o `.AppImage` | `sudo apt install ./cartero_…_amd64.deb`, o da permiso de ejecución al AppImage y ábrelo. |

La primera vez la app crea un workspace con una colección de ejemplo contra httpbin.org y un entorno `httpbin`, para que puedas pulsar **Enviar** desde el primer momento.

## La ventana

- **Barra de actividad** (izquierda): Colecciones, Entornos e Historial. Pulsa otra vez el activo para ocultar la barra lateral (`Ctrl+B`).
- **Colecciones**: árbol con carpetas. Con el botón derecho: nueva petición o carpeta, ejecutar, auth/scripts/variables, exportar, renombrar, duplicar y eliminar. Arrastra peticiones y carpetas para moverlas, también entre colecciones.
- **Pestañas**: cada petición se abre en una pestaña. Un punto indica cambios sin guardar. Las pestañas abiertas vuelven la próxima vez que abras la app.
- **Barra de título**: cambio de workspace, estado de la sincronización, entorno activo, cookies y búsqueda (`Ctrl+K`).

## Enviar peticiones

Funciona como la web ([Peticiones](02-peticiones.md)):

- **Método y URL.** Si pegas un comando `curl` en la barra de la URL, se convierte en la petición.
- Debajo de la URL ves cada `{{variable}}` con su valor y de dónde sale (entorno, colección o global); las que no existen salen en rojo.
- Los **parámetros** se sincronizan con la URL. Las variables de ruta tipo `:id` tienen su propia tabla.
- **Autorización**: heredar, ninguna, Basic, Bearer, API key, Digest, OAuth 1.0, OAuth 2.0 (token con el navegador y PKCE, credenciales de cliente o usuario y contraseña), AWS Signature v4 y Hawk.
- **Cuerpo**: raw (JSON, texto, XML, HTML, JavaScript), x-www-form-urlencoded, form-data con ficheros, binario y GraphQL.
- **Scripts**: antes de enviar y después de la respuesta, con la API `pm.*` y fragmentos. La colección y sus carpetas pueden tener los suyos, que se ejecutan antes ([Scripts y tests](05-scripts-y-tests.md)).
- **Respuesta**: cuerpo bonito o crudo (los enormes se muestran sin colores para que la app siga fluida), vista previa de imágenes, cabeceras, cookies, tiempos por fase (DNS, TCP, TLS, primer byte y descarga), tests y consola.
- **Ver como código**: cURL, HTTPie, JavaScript fetch, Node.js axios, Python requests, Go, PHP, C# y PowerShell.

Las cookies que mandan los servidores se guardan por workspace y se envían solas; gestiónalas con el botón de cookies de la barra de título.

## Entornos y variables

**Entornos** en la barra de actividad: crea, edita y elige el activo (también desde la barra de título). Marca una variable como **secreta** con el icono del ojo: su valor se oculta y se guarda cifrado con una clave que vive en el llavero del sistema. Las variables globales están al final de la lista. Cuando un script llama a `pm.environment.set`, el valor se guarda en el entorno (se puede desactivar en Ajustes).

## Runner

Botón derecho en una colección o carpeta → **Ejecutar**. Elige iteraciones, retardo, un fichero de datos CSV o JSON (una iteración por fila) y si parar al primer fallo. Los resultados aparecen según llegan y puedes exportarlos en JSON o JUnit. `pm.execution.setNextRequest` y `skipRequest` funcionan como en Postman.

## Importar y exportar

**Importar** (`Ctrl+O`, o el botón junto a Colecciones) acepta colecciones de Postman v1, v2.0 y v2.1, entornos y globales de Postman, una exportación completa de Cartero y comandos cURL, pegados o desde un fichero. Botón derecho en una colección → **Exportar** la guarda en Postman v2.1, sin perder nada.

## Conectar con un servidor de Cartero

Ajustes → **Servidores**:

1. Escribe la dirección de tu servidor y pulsa **Conectar con el navegador**. Se abre la página `/connect-desktop` del servidor; entra si hace falta y pulsa **Conectar**. La app recibe un token a través de `127.0.0.1` (no sale nada de tu ordenador). También puedes pegar un token creado en la web (Ajustes → Tokens de API).
2. Verás los workspaces del servidor. **Descarga** uno para tenerlo en este ordenador, o **sube** el workspace actual al servidor.

Un workspace sincronizado muestra una nube en la barra de título. La app sincroniza cada pocos segundos, al momento cuando otra persona cambia algo (WebSocket) y al pulsar **Sincronizar ahora**. También funciona sin conexión: los cambios esperan a que el servidor vuelva a estar disponible. El historial de peticiones y los resultados del runner se suben para que el equipo los vea en la web. Los avatares junto al estado muestran quién más está conectado.

**Conflictos.** Si alguien cambió en el servidor lo mismo que tú aquí, el estado se pone naranja. Abre **Resolver conflictos…**: verás las dos versiones y eliges **Quedarme con la mía** o **Quedarme con la del servidor**.

Los mock servers, los monitores y la documentación publicada se gestionan en la web.

## Ajustes

- **General**: tema (claro, oscuro o como el sistema) e idioma (español o inglés).
- **Peticiones**: tiempo máximo de espera, redirecciones, verificación de certificados SSL, tiempo máximo de los scripts y límite del resaltado de respuestas.
- **Proxy**: proxy HTTP (HTTPS va por un túnel CONNECT) con lista de excepciones.
- **Certificados**: certificados de cliente para TLS mutuo (por dominio, PEM) y certificados de CA propios.
- **Acerca de**: versión, carpeta de datos y comprobación de actualizaciones.

## Atajos de teclado

En macOS usa `⌘` en lugar de `Ctrl`.

| Atajo | Acción |
|---|---|
| `Ctrl+T` / `Ctrl+N` | Petición nueva |
| `Ctrl+Intro` | Enviar |
| `Ctrl+S` | Guardar |
| `Ctrl+W` | Cerrar la pestaña |
| `Ctrl+Tab` / `Ctrl+Mayús+Tab` | Pestaña siguiente / anterior |
| `Ctrl+K` / `Ctrl+P` | Buscar peticiones y comandos |
| `Ctrl+L` | Ir a la barra de la URL |
| `Ctrl+O` | Importar |
| `Ctrl+B` | Mostrar u ocultar la barra lateral |
| `Ctrl+Mayús+F` | Buscar en las colecciones |
| `Ctrl+,` | Ajustes |

## Dónde se guardan tus datos

| Sistema | Carpeta |
|---|---|
| macOS | `~/Library/Application Support/Cartero` |
| Windows | `%APPDATA%\Cartero` |
| Linux | `~/.local/share/Cartero` |

Es una base de datos SQLite (`cartero.db`). Para hacer una copia de seguridad, copia la carpeta con la app cerrada.
