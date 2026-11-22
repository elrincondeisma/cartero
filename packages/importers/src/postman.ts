import transformer from 'postman-collection-transformer'
import { type Collection, type Environment, POSTMAN_SCHEMA_V21, type Variable, ensureIds } from '@cartero/core'

export function isPostmanCollection(json: any): boolean {
  if (!json || typeof json !== 'object') return false
  if (json.info && Array.isArray(json.item)) return true
  // v1: { id, name, order, requests: [...] }
  return Array.isArray(json.requests) && (Array.isArray(json.order) || Array.isArray(json.folders))
}

export function isPostmanEnvironment(json: any): boolean {
  return !!json && Array.isArray(json.values) && json._postman_variable_scope !== 'globals' && !json.info
}

export function isPostmanGlobals(json: any): boolean {
  return !!json && Array.isArray(json.values) && json._postman_variable_scope === 'globals'
}

export function isPostmanDump(json: any): boolean {
  return !!json && json.version === 1 && Array.isArray(json.collections)
}

function postmanVersion(json: any): '1.0.0' | '2.0.0' | '2.1.0' {
  if (!json.info) return '1.0.0'
  const schema: string = json.info.schema ?? ''
  if (schema.includes('v2.0.0')) return '2.0.0'
  return '2.1.0'
}

function convertStep(json: any, inputVersion: string, outputVersion: string): Promise<any> {
  return new Promise((resolve, reject) =>
    transformer.convert(json, { inputVersion, outputVersion, retainIds: true }, (err, out) =>
      err ? reject(err) : resolve(out),
    ),
  )
}

/** El transformador no tiene ruta directa 2.0 → 2.1, así que pasamos por v1. */
async function convert(json: any, inputVersion: string): Promise<any> {
  const v1 = inputVersion === '1.0.0' ? json : await convertStep(json, inputVersion, '1.0.0')
  return convertStep(v1, '1.0.0', '2.1.0')
}

/** Normaliza cualquier versión de colección de Postman (v1, v2.0, v2.1) a v2.1. */
export async function importPostmanCollection(json: any): Promise<Collection> {
  const version = postmanVersion(json)
  const v21: Collection = version === '2.1.0' ? structuredClone(json) : await convert(json, version)
  v21.info.schema = POSTMAN_SCHEMA_V21
  v21.item ??= []
  return ensureIds(v21)
}

function normalizeVariables(values: any[]): Variable[] {
  return (values ?? [])
    .filter((v) => v && typeof v.key === 'string')
    .map((v) => {
      const out: Variable = { key: v.key, value: v.value == null ? '' : String(v.value) }
      if (v.type && v.type !== 'text') out.type = v.type
      if (v.enabled === false || v.disabled === true) out.disabled = true
      if (v.description) out.description = typeof v.description === 'string' ? v.description : v.description.content
      return out
    })
}

export function importPostmanEnvironment(json: any): Environment {
  return { id: json.id, name: json.name ?? 'Entorno importado', values: normalizeVariables(json.values) }
}

export function importPostmanGlobals(json: any): Variable[] {
  return normalizeVariables(json.values)
}
