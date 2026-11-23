> 🌐 [English](../19-contracts.md) · **Español**

# Contratos

Un contrato fija, para una petición, **lo que envía el frontend y lo que debe devolver el backend**. Los dos equipos trabajan contra lo mismo y, cuando alguien se sale, Cartero lo dice en cuanto se envía la petición.

Cada contrato tiene dos partes:

- **Petición**: parámetros de ruta (`:id`), query, cabeceras y estructura del cuerpo.
- **Respuestas**: una por código de estado (`200`, `404`, `422`…). Cada una tiene sus cabeceras y la estructura del cuerpo. También valen rangos (`4XX`) y `default`.

Se edita en la pestaña **Contrato** de la petición, junto a **Ejemplos**. Por debajo se guarda como JSON Schema (draft 2020-12, el de OpenAPI 3.1).

## Crear un contrato

Hay dos formas, y puedes combinarlas:

- **Desde una respuesta real.** Envía la petición, abre **Contrato** y pulsa **Generar desde la última respuesta**.
  - Cartero saca los tipos, detecta formatos (email, uuid, fecha, URL) y guarda los valores reales como ejemplo.
  - La parte de petición se rellena con la ruta, la query, las cabeceras y el cuerpo actuales.
  - Al generar, todos los campos quedan como obligatorios. Desmarca los que puedan faltar.
- **A mano**, antes de que exista el backend. Pulsa **Empezar en blanco** y añade los campos.

Para añadir otro código, usa **Código de respuesta**. Si la última respuesta trae ese mismo código, el botón **Generar desde la última respuesta** también aparece dentro de él.

Guarda la petición (Ctrl+S) para guardar el contrato.

## El editor de campos

Cada fila es un campo, con:

- **Nombre** y **tipo**: texto, número, entero, sí/no, objeto, lista o nulo.
- **Obligatorio**: si puede faltar o no.
- **Puede ser nulo**: si admite `null` además de su tipo.
- **Más detalles** (icono de ajustes): descripción, ejemplo, formato y valores permitidos, separados por comas.

Los objetos y las listas se despliegan. Una lista tiene una fila **cada elemento** que describe sus elementos.

Si prefieres escribir el esquema, **Ver como JSON Schema** muestra el contrato entero en el editor de código. Lo que cambies ahí se aplica en el momento, siempre que el JSON sea válido.

## Comprobación al enviar

Si la petición tiene contrato, cada vez que la envías Cartero comprueba las dos partes:

- Junto al código de estado aparece **Cumple el contrato** (verde) o **Contrato: N fallos** (rojo). Pulsa la insignia para ver el detalle.
- La pestaña **Contrato** de la respuesta separa **lo que se ha enviado** de **lo que ha llegado**. Cada fallo lleva su ruta y el motivo, por ejemplo:

| Ruta | Motivo |
|---|---|
| `$.email` | Es obligatorio y no ha llegado |
| `$.id` | Se esperaba integer y ha llegado string |
| `$.estado` | Solo admite estos valores: "activo", "baja" |
| `page` | Falta el parámetro obligatorio |
| `500` | Este código no está en el contrato (previstos: 200, 404) |

Los campos que llegan y el contrato no menciona salen como **aviso** (en ámbar), no como fallo. Para prohibirlos, pon `"additionalProperties": false` en el JSON Schema.

## Cambios que rompen

Al guardar, Cartero compara el contrato nuevo con el guardado. Si algún cambio rompe a quien ya lo usa, aparece un diálogo con la lista antes de guardar. Puedes **Seguir editando** o **Guardar igualmente**.

| Rompe | No rompe |
|---|---|
| Quitar un campo de la respuesta | Añadir un campo opcional |
| Cambiar el tipo de un campo | Añadir un código de respuesta |
| Que un campo de la respuesta deje de ser obligatorio | Que un campo de la petición deje de ser obligatorio |
| Que la petición pida un campo o parámetro nuevo obligatorio | Aceptar más valores en la petición |
| Quitar un código de respuesta | |
| Que la respuesta pueda traer valores nuevos en un campo con valores limitados | |

## Historial

**Historial**, en la columna del contrato, lista cada versión guardada: quién la guardó, cuándo y qué cambió, con lo que rompe en rojo y lo compatible en verde. Las versiones también salen en el historial de la colección y se pueden restaurar desde allí (ver [Equipos y colaboración](11-equipos-y-colaboracion.md)).

## Mock desde el contrato

Un [mock server](08-mock-servers.md) responde con los ejemplos guardados. Si una petición no tiene ninguno que encaje pero sí tiene contrato, el mock genera una respuesta que lo cumple:

- Usa los ejemplos y valores permitidos del contrato y, si no hay, valores con sentido según el formato y el nombre del campo.
- Responde con el primer código 2xx del contrato. Con la cabecera `x-mock-response-code: 404` pides otro.

Así el frontend puede avanzar con solo el contrato, sin escribir ejemplos.

## OpenAPI

- **Exportar**: en el menú de la colección, **Exportar OpenAPI 3.1 (YAML)** o **(JSON)**.
  - Cada petición con contrato aporta sus parámetros, su `requestBody` y sus respuestas.
  - Las peticiones sin contrato se describen a partir de su cuerpo y sus ejemplos.
- **Importar**: al importar un OpenAPI 3.0/3.1 (ver [Colecciones e importación](06-colecciones-e-importacion.md)), cada petición recibe su contrato a partir de los esquemas. Se resuelven `$ref` y el `nullable` de OpenAPI 3.0.

En el árbol de la colección, las peticiones con contrato llevan un pequeño icono de documento con una marca.

## Desde un asistente de IA

El [servidor MCP](13-ia-mcp.md) tiene herramientas para todo lo anterior: `ver_contrato`, `generar_contrato`, `guardar_contrato`, `validar_contrato`, `historial_contrato` y `exportar_openapi`. Puedes pedirle, por ejemplo, «genera el contrato de todas las peticiones de *API* y dime cuáles no cumplen». Los cambios que rompen tampoco se guardan desde el asistente sin confirmarlos.
