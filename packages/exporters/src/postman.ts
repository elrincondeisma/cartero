import { type Collection, type Environment, POSTMAN_SCHEMA_V21, type Variable } from '@cartero/core'

/** Elimina claves undefined para que el JSON exportado quede limpio. */
function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

export function exportPostmanCollection(collection: Collection): Collection {
  const out = clean(collection)
  out.info = { ...out.info, schema: POSTMAN_SCHEMA_V21 }
  // Orden de claves igual que Postman: info, item, auth, event, variable
  const { info, item, auth, event, variable, ...rest } = out
  return clean({ info, item, auth, event, variable, ...rest })
}

function exportVars(values: Variable[]) {
  return values.map((v) => ({
    key: v.key,
    value: v.value,
    type: v.type ?? 'default',
    enabled: !v.disabled,
  }))
}

export function exportPostmanEnvironment(env: Environment) {
  return {
    id: env.id,
    name: env.name,
    values: exportVars(env.values),
    _postman_variable_scope: 'environment',
    _postman_exported_at: new Date().toISOString(),
    _postman_exported_using: 'Cartero',
  }
}

export function exportPostmanGlobals(values: Variable[]) {
  return {
    name: 'Globals',
    values: exportVars(values),
    _postman_variable_scope: 'globals',
    _postman_exported_at: new Date().toISOString(),
    _postman_exported_using: 'Cartero',
  }
}
