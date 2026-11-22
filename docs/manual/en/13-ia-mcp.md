# Connecting AI assistants (MCP)

Cartero ships an **MCP** server (*Model Context Protocol*), the standard Claude, Cursor and other assistants use to connect to tools. Once connected, you can ask things like:

- "Run the *Blog* collection and explain why the tests fail."
- "Create a POST /users request in the *API* collection with a test that checks for 201."
- "Import the OpenAPI spec at https://… and test every GET."
- "Generate the Python code for the *Login* request."
- "What's the temperature in Barcelona?" (using your weather collection).

## Connect

The quickest way is **Settings → Connect AI (MCP)**: it creates a token and gives you copy-ready configuration.

### Claude Code

```bash
claude mcp add --transport http cartero https://YOUR-CARTERO/mcp \
  --header "Authorization: Bearer crt_YOUR_TOKEN"
```

### Claude Desktop

In *Settings → Developer → Edit Config* (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cartero": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://YOUR-CARTERO/mcp", "--header", "Authorization: Bearer crt_YOUR_TOKEN"]
    }
  }
}
```

### Cursor

In `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "cartero": { "url": "https://YOUR-CARTERO/mcp", "headers": { "Authorization": "Bearer crt_YOUR_TOKEN" } } } }
```

### Over stdio (local)

```bash
CARTERO_SERVER=https://YOUR-CARTERO CARTERO_TOKEN=crt_… node packages/mcp/dist/stdio.js
```

## Available tools

| Tool | What it does |
|---|---|
| `listar_workspaces`, `listar_colecciones`, `ver_coleccion` | Explore |
| `buscar_peticiones`, `ver_peticion` | Find and read requests |
| `enviar_peticion` | Send a saved or ad hoc request, with the environment of your choice |
| `ejecutar_coleccion` | Run the runner and get the summary and failures |
| `crear_coleccion`, `crear_carpeta`, `crear_peticion`, `actualizar_peticion` | Create and edit (with scripts and tests) |
| `listar_entornos`, `guardar_variable` | Environments and variables |
| `importar` | Postman, Insomnia, OpenAPI or cURL |
| `generar_codigo` | Code in 20+ languages |
| `listar_ejecuciones` | Run history |
| `crear_mock`, `listar_mocks` | Mock servers |

It also includes the **probar_api** prompt, which reviews a whole collection and suggests tests.

## Security

- The assistant acts **with your permissions**: if you're a viewer, it can't change anything.
- It **can't delete** anything.
- It **never sees secret variable values**.
- You can revoke the token anytime in **Settings → API tokens**.
