> 🌐 [English](../05-scripts-and-tests.md) · **Español**

# Scripts y tests

Cartero ejecuta los scripts con el mismo motor que Postman (`postman-runtime`), así que **los scripts de tus colecciones de Postman funcionan sin cambios**.

- **Pre-request**: se ejecuta antes de enviar. Útil para calcular firmas, timestamps o pedir un token.
- **Post-response**: se ejecuta con la respuesta. Aquí van los **tests**.

Los scripts de colección y carpeta se ejecutan para cada petición que contienen, en orden: colección → carpeta → petición.

El editor tiene **autocompletado** de toda la API `pm` (Ctrl+Espacio) y una lista de **fragmentos** a la derecha para insertar los casos habituales.

## Tests

```js
pm.test('Código 200', () => {
  pm.response.to.have.status(200)
})

pm.test('Devuelve un usuario con email', () => {
  const user = pm.response.json()
  pm.expect(user).to.have.property('email')
  pm.expect(user.email).to.match(/@/)
})

pm.test('Responde rápido', () => {
  pm.expect(pm.response.responseTime).to.be.below(500)
})

pm.test('Cumple el schema', () => {
  pm.response.to.have.jsonSchema({
    type: 'object',
    required: ['id', 'name'],
    properties: { id: { type: 'number' } },
  })
})
```

Los resultados aparecen en la pestaña **Tests** de la respuesta y en el [runner](07-runner.md).

## Referencia rápida de `pm`

| Objeto | Para qué |
|---|---|
| `pm.response.code`, `.status`, `.responseTime`, `.json()`, `.text()`, `.headers.get('X')`, `.cookies.get('c')` | Leer la respuesta |
| `pm.response.to.have.status(200)`, `.header('X')`, `.jsonBody('a.b', 1)`, `.jsonSchema(s)` | Aserciones de respuesta |
| `pm.expect(valor).to.eql(…)`, `.include(…)`, `.be.above(n)`, `.match(/re/)`, `.have.lengthOf(n)` | Aserciones estilo Chai |
| `pm.request.headers.upsert({ key, value })`, `pm.request.url` | Modificar la petición (pre-request) |
| `pm.environment`, `pm.collectionVariables`, `pm.globals`, `pm.variables`, `pm.iterationData` | Variables (`get`, `set`, `unset`, `has`) |
| `pm.sendRequest(req, callback)` | Hacer otra petición desde el script |
| `pm.execution.setNextRequest('Nombre')` | En el runner, saltar a otra petición (o `null` para parar) |
| `pm.execution.skipRequest()` | No enviar la petición actual |
| `pm.info.iteration`, `pm.info.requestName` | Información de la ejecución |
| `console.log(…)` | Escribe en la pestaña Consola |

Librerías disponibles con `require`: `lodash`, `moment`, `crypto-js`, `uuid`, `ajv`, `cheerio`, `xml2js`, `chai`, `atob`, `btoa`, `tv4`.

## Ejemplo: login automático

En el pre-request de la colección:

```js
if (!pm.environment.get('token')) {
  pm.sendRequest({
    url: pm.environment.get('baseUrl') + '/login',
    method: 'POST',
    header: { 'Content-Type': 'application/json' },
    body: { mode: 'raw', raw: JSON.stringify({ user: pm.environment.get('usuario'), password: pm.environment.get('password') }) },
  }, (err, res) => {
    if (!err) pm.environment.set('token', res.json().token)
  })
}
```

## Seguridad

Los scripts se ejecutan en el servidor, en un proceso separado con límites de tiempo (30 s por script) y memoria. Un bucle infinito no afecta al resto de usuarios.
