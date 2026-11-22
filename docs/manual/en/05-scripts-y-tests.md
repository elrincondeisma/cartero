# Scripts and tests

Cartero runs scripts with the same engine as Postman (`postman-runtime`), so **the scripts in your Postman collections work unchanged**.

- **Pre-request**: runs before sending. Useful to compute signatures, timestamps or fetch a token.
- **Post-response**: runs with the response. **Tests** go here.

Collection and folder scripts run for every request they contain, in order: collection → folder → request.

The editor has **autocomplete** for the whole `pm` API (Ctrl+Space) and a list of **snippets** on the right to insert common cases.

## Tests

```js
pm.test('Status 200', () => {
  pm.response.to.have.status(200)
})

pm.test('Returns a user with an email', () => {
  const user = pm.response.json()
  pm.expect(user).to.have.property('email')
  pm.expect(user.email).to.match(/@/)
})

pm.test('Responds quickly', () => {
  pm.expect(pm.response.responseTime).to.be.below(500)
})

pm.test('Matches the schema', () => {
  pm.response.to.have.jsonSchema({
    type: 'object',
    required: ['id', 'name'],
    properties: { id: { type: 'number' } },
  })
})
```

Results show up in the response's **Tests** tab and in the [runner](07-runner.md).

## `pm` quick reference

| Object | Purpose |
|---|---|
| `pm.response.code`, `.status`, `.responseTime`, `.json()`, `.text()`, `.headers.get('X')`, `.cookies.get('c')` | Read the response |
| `pm.response.to.have.status(200)`, `.header('X')`, `.jsonBody('a.b', 1)`, `.jsonSchema(s)` | Response assertions |
| `pm.expect(value).to.eql(…)`, `.include(…)`, `.be.above(n)`, `.match(/re/)`, `.have.lengthOf(n)` | Chai-style assertions |
| `pm.request.headers.upsert({ key, value })`, `pm.request.url` | Modify the request (pre-request) |
| `pm.environment`, `pm.collectionVariables`, `pm.globals`, `pm.variables`, `pm.iterationData` | Variables (`get`, `set`, `unset`, `has`) |
| `pm.sendRequest(req, callback)` | Make another request from the script |
| `pm.execution.setNextRequest('Name')` | In the runner, jump to another request (or `null` to stop) |
| `pm.execution.skipRequest()` | Don't send the current request |
| `pm.info.iteration`, `pm.info.requestName` | Run information |
| `console.log(…)` | Writes to the Console tab |

Libraries available via `require`: `lodash`, `moment`, `crypto-js`, `uuid`, `ajv`, `cheerio`, `xml2js`, `chai`, `atob`, `btoa`, `tv4`.

## Example: automatic login

In the collection's pre-request script:

```js
if (!pm.environment.get('token')) {
  pm.sendRequest({
    url: pm.environment.get('baseUrl') + '/login',
    method: 'POST',
    header: { 'Content-Type': 'application/json' },
    body: { mode: 'raw', raw: JSON.stringify({ user: pm.environment.get('user'), password: pm.environment.get('password') }) },
  }, (err, res) => {
    if (!err) pm.environment.set('token', res.json().token)
  })
}
```

## Security

Scripts run on the server, in a separate process with time (30 s per script) and memory limits. An infinite loop won't affect other users.
