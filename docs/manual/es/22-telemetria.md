> 🌐 [English](../22-telemetry.md) · **Español**

# Telemetría

Una vez al día, cada instalación de Cartero envía un informe anónimo a `cartero.elrincondeisma.com`. Lleva recuentos y datos técnicos, para saber cuánta gente usa Cartero, qué versión tiene, qué funciones usa y qué errores aparecen. **Nunca lleva tu contenido.** Viene activada y puedes apagarla cuando quieras.

## Lo que nunca se envía

- Peticiones, URLs, cabeceras, cuerpos ni respuestas.
- Colecciones, nombres de carpetas o peticiones, entornos, variables ni secretos.
- Emails, nombres, cuentas ni nombres de workspaces.
- La IP de tu servidor. El colector solo guarda el país que Vercel deduce de la conexión, y no guarda la IP.

## Lo que se envía

El informe exacto lo ves en **Administración → Sistema → Estadísticas anónimas → Ver lo que se envía**.

| Grupo | Datos |
|---|---|
| Instalación | Un identificador aleatorio de la instalación (se genera la primera vez; no sale de nada tuyo), versión, canal (`stable` o una versión fija), cómo está instalada (`docker-compose`, `aws-ec2`, `aws-fargate`, `source`, `dev`), sistema operativo y arquitectura, versión mayor de Node y de PostgreSQL, si hay Redis, días desde la instalación |
| Configuración | Solo sí o no: login con Google o GitHub activo, SMTP configurado, registro abierto, dominios limitados, bloqueo de redes privadas, búsqueda y actualización automática de versiones, instalación terminada |
| Tamaño | Número de usuarios, admins, usuarios activos (7 y 30 días), workspaces personales y de equipo, colecciones, peticiones guardadas, entornos, mocks, monitores, documentación publicada y tokens de API usados en 30 días |
| Uso desde el último informe | Peticiones enviadas, runs por origen (app, CLI, monitor, escritorio) y resultado, impactos en mocks, comentarios, importaciones por formato (`postman-collection`, `openapi-3`, `curl`…), llamadas MCP por nombre de herramienta, cURL pegados |
| Errores | Errores 5xx por ruta-patrón y código (por ejemplo `POST /api/workspaces/:ws/import 500`, nunca el mensaje), actualizaciones fallidas |

## Apagarla

Cualquiera de estas la apaga:

- **Administración → Sistema → Estadísticas anónimas**, o el interruptor del último paso del asistente de instalación.
- La variable de entorno `CARTERO_TELEMETRY=off` (en `.env` con Docker Compose). Manda sobre el panel.
- La variable estándar `DO_NOT_TRACK=1`.

Apagada, no se envía nada ni se cuenta nada.

## Dónde van los datos

Los informes llegan a una función de Vercel en `cartero.elrincondeisma.com/api/telemetry` y se guardan en una base de datos PostgreSQL (Neon, en la UE). Solo los ven quienes mantienen Cartero, y siempre como totales: cuántas instalaciones, versiones y funciones. Los informes de hace más de 13 meses se borran.

El código que construye el informe está en [`apps/server/src/lib/telemetry.ts`](../../../apps/server/src/lib/telemetry.ts), y el colector, en [`apps/landing/src/pages/api/telemetry.ts`](../../../apps/landing/src/pages/api/telemetry.ts).
