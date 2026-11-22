# Cartero

**Cliente de APIs web y open source, autoalojado.** Una alternativa a Postman con lo que allí es de pago incluido gratis y sin límites: runner de colecciones, mock servers, monitores, documentación publicada y colaboración en equipo. Importa tus colecciones de Postman sin perder nada.

> MIT · TypeScript · Un `docker compose up` y listo

## Qué incluye

| | |
|---|---|
| **Peticiones** | REST y GraphQL; params, cabeceras, body (raw/JSON/XML, form-data con ficheros, urlencoded, binario); historial; cookies; snippets de código en más de 20 lenguajes |
| **Autenticación** | Basic, Bearer, API Key, JWT, Digest, OAuth 1.0, **OAuth 2.0** (Authorization Code + PKCE, Client Credentials, Password, Implicit, refresco), Hawk, AWS SigV4, NTLM, Akamai EdgeGrid; herencia carpeta → colección |
| **Scripts** | Pre-request y post-response con la API `pm.*` de Postman (ejecutados con `postman-runtime`): `pm.test`, `pm.expect`, `pm.sendRequest`, `pm.environment`, `setNextRequest`… con autocompletado |
| **Variables** | Globales, de colección, de carpeta, entornos y datos de iteración. Las variables secretas se cifran en reposo (AES-256-GCM) |
| **Importar / exportar** | Postman (colecciones v1, v2.0 y v2.1, entornos, globales, volcado de datos y ZIP de exportación), Insomnia (v4 JSON y v5 YAML), OpenAPI 3.0/3.1, Swagger 2.0 y cURL. Exporta a Postman v2.1 (ida y vuelta sin pérdidas) |
| **Runner** | Ejecuta colecciones o carpetas sin límites, con iteraciones, datos CSV/JSON, retardo, «parar al primer fallo» y resultados en vivo |
| **CLI** | `cartero run`, equivalente a Newman, para CI: reporters de consola, JSON, JUnit y HTML; ejecuta ficheros o colecciones de tu servidor y sube el resultado |
| **Mock servers** | Responden con los ejemplos guardados: rutas con parámetros, cabeceras `x-mock-response-*`, variables dinámicas (`{{$randomEmail}}`…), retardo simulado, mocks privados y log de llamadas |
| **Monitores** | Ejecuciones programadas con cron y zona horaria; avisos por Slack, Discord, Telegram, email o webhook; historial con disponibilidad y tiempos |
| **Documentación** | Página pública por colección con descripciones en Markdown, ejemplos y cURL. Opcionalmente con contraseña. Las credenciales se ocultan solas |
| **IA (MCP)** | Servidor MCP integrado (`/mcp`) con 18 herramientas: Claude, Cursor y otros asistentes pueden explorar, enviar, ejecutar, crear peticiones e importar con tus permisos |
| **Idiomas** | Interfaz, manual y datos de ejemplo en **español e inglés**, con selector de idioma guardado en tu cuenta |
| **Ayuda** | Asistente de bienvenida, recorrido guiado, paleta de comandos (Ctrl+K), [manual completo](docs/manual/README.md) en `/ayuda` y datos de ejemplo con APIs reales que se quitan con un clic |
| **Equipos** | Workspaces, invitaciones, roles (propietario, admin, editor, lector), presencia en tiempo real, comentarios, historial de cambios con restauración, fork y merge, tokens de API |

## Puesta en marcha

```bash
git clone https://github.com/elrincondeisma/cartero.git && cd cartero
cp .env.example .env        # cambia CARTERO_SECRET_KEY y POSTGRES_PASSWORD
docker compose up -d
```

Abre `http://localhost:3000` y crea tu cuenta.

Para desactivar el registro abierto, pon `ALLOW_REGISTRATION=false`: el primer usuario siempre puede registrarse, y el resto solo con invitación.

### Configuración

| Variable | Por defecto | Descripción |
|---|---|---|
| `CARTERO_SECRET_KEY` | — (obligatoria) | Clave para cifrar los secretos. Genera una con `openssl rand -base64 32` y **no la pierdas** |
| `DATABASE_URL` | — | PostgreSQL 14 o superior |
| `REDIS_URL` | — | Redis (para los monitores) |
| `PUBLIC_URL` | `http://localhost:3000` | URL pública: enlaces de invitación, OAuth y avisos |
| `ALLOW_REGISTRATION` | `true` | Registro abierto |
| `BLOCK_PRIVATE_NETWORKS` | `false` | Bloquea peticiones a IPs privadas (protección SSRF). Actívalo si tu instancia es pública |
| `SMTP_URL` / `SMTP_FROM` | — | Para enviar invitaciones y avisos por email |
| `INLINE_WORKER` | `true` | `false` para ejecutar los monitores en un proceso aparte (`node dist/worker.js`) |

> **Detrás de un proxy (Traefik, Caddy, Nginx):** reenvía también las conexiones WebSocket de `/api/ws`, que se usan para la presencia y los cambios en vivo.

## Conectar asistentes de IA (MCP)

En **Ajustes → Conectar IA (MCP)** creas un token y copias la configuración para tu cliente. Por ejemplo, en Claude Code:

```bash
claude mcp add --transport http cartero https://cartero.ejemplo.com/mcp --header "Authorization: Bearer crt_xxx"
```

Más detalles en el [manual](docs/manual/13-ia-mcp.md).

## CLI

```bash
# Ejecutar un fichero exportado de Postman con un entorno y datos
npx @cartero/cli run coleccion.postman_collection.json -e prod.postman_environment.json -d datos.csv -r cli,junit

# Ejecutar una colección de tu servidor y subir el resultado
CARTERO_SERVER=https://cartero.ejemplo.com CARTERO_TOKEN=crt_xxx \
  npx @cartero/cli run <id-coleccion> -e <id-entorno> --workspace <id-workspace> --report
```

Códigos de salida: `0` si todo pasa, `1` si falla algún test o petición, `2` si hay un error de uso.

## Arquitectura

```
apps/
  server/     Fastify + Drizzle (PostgreSQL) + BullMQ (Redis) + WebSocket
  web/        React 19 + Vite + Tailwind + TanStack Query + Monaco
packages/
  core/       Modelo de datos (superconjunto de Postman Collection v2.1)
  executor/   Ejecución con postman-runtime en un proceso aislado (límites de tiempo y memoria)
  importers/  Postman, Insomnia, OpenAPI, cURL
  exporters/  Postman v2.1 y snippets de código
  cli/        cartero run
  mcp/        Servidor MCP (stdio y Streamable HTTP)
docs/manual/  Manual de uso (también en /ayuda)
```

Las peticiones se envían **desde el servidor**. Así no hay problemas de CORS y puedes probar APIs de tu red local. Los scripts de usuario se ejecutan en un proceso hijo con límites de tiempo y memoria.

## Desarrollo

Requisitos: Node 22+, pnpm 12+ y Docker.

```bash
pnpm install
pnpm db:up                     # Postgres (5433) y Redis (6380) de desarrollo
pnpm --filter "./packages/*" build
pnpm --filter @cartero/server dev   # API en :3000
pnpm --filter @cartero/web dev      # Web en :5173
```

Tests:

```bash
pnpm test                      # unitarios e integración (necesita pnpm db:up)
npx playwright test            # E2E (con la API y la web levantadas)
```

Lee [CONTRIBUTING.md](CONTRIBUTING.md) antes de mandar un PR.

## Licencia

[MIT](LICENSE). Cartero usa `postman-runtime`, `postman-collection`, `postman-collection-transformer`, `openapi-to-postmanv2` y `postman-code-generators`, todas con licencia Apache-2.0. Cartero no está afiliado a Postman, Inc.
