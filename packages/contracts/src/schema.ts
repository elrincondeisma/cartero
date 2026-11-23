import type { JSONSchema } from '@cartero/core'

/** Tipos de JSON Schema que maneja el editor visual. */
export const SCHEMA_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'] as const
export type SchemaType = (typeof SCHEMA_TYPES)[number]

/** Tipos declarados de un esquema, como lista ('string' → ['string']). Vacío si admite cualquiera. */
export function typesOf(schema: JSONSchema | undefined): string[] {
  if (!schema) return []
  if (Array.isArray(schema.type)) return schema.type
  if (typeof schema.type === 'string') return [schema.type]
  if (schema.properties) return ['object']
  if (schema.items) return ['array']
  return []
}

/** Tipo principal (sin contar «null») y si admite null. */
export function mainType(schema: JSONSchema | undefined): { type: string | undefined; nullable: boolean } {
  const types = typesOf(schema)
  const nonNull = types.filter((t) => t !== 'null')
  return {
    type: nonNull[0] ?? (types.includes('null') ? 'null' : undefined),
    nullable: types.includes('null') && nonNull.length > 0,
  }
}

/** Escribe el tipo de un esquema respetando si admite null. */
export function withType(schema: JSONSchema, type: string, nullable: boolean): JSONSchema {
  const next: JSONSchema = { ...schema, type: nullable && type !== 'null' ? [type, 'null'] : type }
  if (type !== 'object') {
    delete next.properties
    delete next.required
    delete next.additionalProperties
  }
  if (type !== 'array') delete next.items
  if (type === 'object' && !next.properties) next.properties = {}
  if (type === 'array' && !next.items) next.items = { type: 'string' }
  return next
}

/** Tipo del valor real de un JSON, con los mismos nombres que JSON Schema. */
export function jsonType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

/**
 * Normaliza un esquema que viene de fuera (OpenAPI 3.0, Swagger): `nullable: true` pasa a
 * `type: [t, 'null']` y `example` se conserva. Recorre properties, items, anyOf, oneOf y allOf.
 */
export function normalizeSchema(schema: JSONSchema | undefined): JSONSchema | undefined {
  if (!schema || typeof schema !== 'object') return schema
  const out: JSONSchema = { ...schema }
  if (out.nullable === true) {
    const types = typesOf(out)
    if (types.length && !types.includes('null')) out.type = [...types, 'null']
    delete out.nullable
  } else if (out.nullable === false) delete out.nullable
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([k, v]) => [k, normalizeSchema(v as JSONSchema)]),
    )
  }
  if (out.items && typeof out.items === 'object' && !Array.isArray(out.items))
    out.items = normalizeSchema(out.items)
  for (const k of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(out[k])) out[k] = out[k].map((s: JSONSchema) => normalizeSchema(s))
  }
  if (out.additionalProperties && typeof out.additionalProperties === 'object')
    out.additionalProperties = normalizeSchema(out.additionalProperties)
  return out
}

/** Pasa un JSON Pointer de ajv (/user/0/email) a la notación legible $.user[0].email. */
export function pointerToPath(pointer: string, extra?: string): string {
  const parts = pointer
    .split('/')
    .slice(1)
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
  if (extra !== undefined) parts.push(extra)
  let out = '$'
  for (const p of parts)
    out += /^\d+$/.test(p) ? `[${p}]` : /^[A-Za-z_$][\w$]*$/.test(p) ? `.${p}` : `[${JSON.stringify(p)}]`
  return out
}

export function joinPath(base: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`
}

/** Sustituye {0}, {1}… por sus valores. Es el mismo formato que usa `t()` en la web. */
export function format(template: string, params: (string | number)[] = []): string {
  return template.replace(/\{(\d+)\}/g, (m, i) =>
    params[Number(i)] !== undefined ? String(params[Number(i)]) : m,
  )
}
