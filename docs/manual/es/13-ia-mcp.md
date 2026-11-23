> 🌐 [English](../13-ai-mcp.md) · **Español**

# Conectar asistentes de IA (MCP)

Cartero incluye un servidor **MCP** (*Model Context Protocol*), el estándar con el que Claude, Cursor y otros asistentes se conectan a herramientas. Una vez conectado, puedes pedirle cosas como:

- «Ejecuta la colección *Blog* y explícame por qué fallan los tests».
- «Crea una petición POST /users en la colección *API* con un test que compruebe el 201».
- «Importa la especificación OpenAPI de https://… y prueba todos los GET».
- «Genera el código en Python de la petición *Login*».
- «Crea el contrato de *Ver usuario* a partir de su respuesta y marca `phone` como opcional».
- «Comprueba si el backend sigue cumpliendo los contratos de la colección *API*».
- «¿Qué temperatura hace en Barcelona?» (usando tu colección de clima).

## Conectar

La forma más rápida es **Ajustes → Conectar IA (MCP)**: crea un token y te da la configuración lista para copiar.

### Claude Code

```bash
claude mcp add --transport http cartero https://TU-CARTERO/mcp \
  --header "Authorization: Bearer crt_TU_TOKEN"
```

### Claude Desktop

En *Ajustes → Desarrollador → Editar configuración* (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cartero": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://TU-CARTERO/mcp", "--header", "Authorization: Bearer crt_TU_TOKEN"]
    }
  }
}
```

### Cursor

En `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "cartero": { "url": "https://TU-CARTERO/mcp", "headers": { "Authorization": "Bearer crt_TU_TOKEN" } } } }
```

### Por stdio (local)

```bash
CARTERO_SERVER=https://TU-CARTERO CARTERO_TOKEN=crt_… node packages/mcp/dist/stdio.js
```

## Herramientas disponibles

| Herramienta | Qué hace |
|---|---|
| `listar_workspaces`, `listar_colecciones`, `ver_coleccion` | Explorar |
| `buscar_peticiones`, `ver_peticion` | Encontrar y leer peticiones |
| `enviar_peticion` | Enviar una petición guardada o suelta, con el entorno que elijas |
| `ejecutar_coleccion` | Lanzar el runner y obtener el resumen y los fallos |
| `crear_coleccion`, `crear_carpeta`, `crear_peticion`, `actualizar_peticion` | Crear y modificar (con scripts y tests) |
| `listar_entornos`, `guardar_variable` | Entornos y variables |
| `importar` | Postman, Insomnia, OpenAPI o cURL |
| `generar_codigo` | Código en más de 20 lenguajes |
| `listar_ejecuciones` | Historial de ejecuciones |
| `crear_mock`, `listar_mocks` | Mock servers |
| `ver_contrato`, `guardar_contrato` | Leer, crear, cambiar o quitar el [contrato](19-contratos.md) de una petición. Si un cambio rompe, no se guarda hasta que el asistente lo confirma con `aceptarCambiosQueRompen` |
| `generar_contrato` | Enviar la petición y deducir el contrato de la respuesta real (solo lo propone, salvo que se pida guardarlo) |
| `validar_contrato` | Enviar la petición y comprobar lo enviado y lo recibido contra el contrato |
| `historial_contrato` | Versiones del contrato y qué cambió en cada una |
| `exportar_openapi` | La colección como OpenAPI 3.1, con sus contratos |

También incluye el *prompt* **probar_api**, que revisa una colección completa y propone tests.

## Seguridad

- El asistente actúa **con tus permisos**: si eres lector, no puede modificar nada.
- **No puede borrar** nada.
- **Nunca ve los valores de las variables secretas**.
- Puedes revocar el token en cualquier momento en **Ajustes → Tokens de API**.
