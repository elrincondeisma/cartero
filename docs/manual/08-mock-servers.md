# Mock servers

Un mock server simula tu API respondiendo con los **ejemplos** guardados en las peticiones. Es útil para que el frontend avance antes de que exista el backend, para demos o para pruebas que no deben tocar producción.

## Crear un mock

1. Guarda ejemplos en tus peticiones: envía la petición y pulsa el icono de guardar de la respuesta, o créalos en la pestaña **Ejemplos**.
2. Ve a **Mock servers → Nuevo**, elige la colección y, si quieres, un entorno (para resolver `{{variables}}` en los ejemplos) y un retardo.
3. Copia la URL: `https://TU-CARTERO/mock/abc123`.

Si una petición de ejemplo es `GET {{baseUrl}}/users/:id`, el mock responde a `GET https://TU-CARTERO/mock/abc123/users/42`.

## Cómo elige la respuesta

1. El **método** debe coincidir.
2. La **ruta** debe coincidir segmento a segmento. `:param` y `{{variable}}` valen cualquier valor, pero una ruta exacta gana a una con parámetros.
3. Los **query params** que coinciden suman puntos.
4. A igualdad, se prefieren respuestas 2xx.

Puedes forzar un ejemplo con cabeceras en la petición:

| Cabecera | Efecto |
|---|---|
| `x-mock-response-name: Post no encontrado` | Usa el ejemplo con ese nombre |
| `x-mock-response-code: 404` | Usa un ejemplo con ese código |
| `x-mock-response-id: <id>` | Usa ese ejemplo exacto |
| `x-mock-match-request-body: true` | Exige que el body coincida |
| `x-mock-match-request-headers: X-Tenant` | Exige que esas cabeceras coincidan |

Si nada coincide, responde **404** con un mensaje explicativo.

## Respuestas dinámicas

En el body de un ejemplo puedes usar variables dinámicas, que cambian en cada llamada:

```json
{ "id": "{{$guid}}", "email": "{{$randomEmail}}", "creado": "{{$isoTimestamp}}" }
```

## Mocks privados y log

- **Privado**: exige un token de API en la cabecera `x-api-key`.
- **Llamadas recibidas**: el panel muestra cada llamada, qué ejemplo respondió y cuándo.
- El mock admite **CORS**, así que puedes llamarlo directamente desde una web.
