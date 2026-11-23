import type { JSONSchema } from '@cartero/core'
import { normalizeSchema, typesOf } from './schema.js'

const FORMATS: Record<string, () => string> = {
  email: () => 'ana@example.com',
  uuid: () => '3f2b8c1e-6d4a-4f7e-9b1a-2c5d8e9f0a1b',
  'date-time': () => new Date().toISOString(),
  date: () => new Date().toISOString().slice(0, 10),
  time: () => '12:00:00',
  uri: () => 'https://example.com',
  url: () => 'https://example.com',
  hostname: () => 'example.com',
  ipv4: () => '192.0.2.1',
  ipv6: () => '2001:db8::1',
}

/** Valor de ejemplo para un texto, a partir del nombre del campo cuando ayuda. */
function sampleString(schema: JSONSchema, name?: string): string {
  if (schema.format && FORMATS[schema.format]) return FORMATS[schema.format]()
  const n = (name ?? '').toLowerCase()
  if (n.includes('email')) return 'ana@example.com'
  if (n === 'id' || n.endsWith('id')) return 'abc123'
  if (n.includes('name') || n.includes('nombre')) return 'Ana García'
  if (n.includes('url') || n.includes('link')) return 'https://example.com'
  if (n.includes('date') || n.includes('fecha') || n.endsWith('at')) return new Date().toISOString()
  const min = typeof schema.minLength === 'number' ? schema.minLength : 0
  const base = name ? name : 'texto'
  return base.length >= min ? base : base.padEnd(min, 'x')
}

function sampleNumber(schema: JSONSchema, integer: boolean): number {
  const min = typeof schema.minimum === 'number' ? schema.minimum : undefined
  const max = typeof schema.maximum === 'number' ? schema.maximum : undefined
  let v = min ?? (max !== undefined ? Math.min(max, 1) : integer ? 1 : 1.5)
  if (typeof schema.exclusiveMinimum === 'number' && v <= schema.exclusiveMinimum)
    v = schema.exclusiveMinimum + 1
  return integer ? Math.ceil(v) : v
}

/**
 * Genera un valor que cumple el esquema. Usa example/default/enum cuando los hay; si no,
 * valores con sentido según el tipo, el formato y el nombre del campo. Rellena todos los campos.
 */
export function sampleFromSchema(input: JSONSchema | undefined, name?: string, depth = 0): unknown {
  const schema = normalizeSchema(input)
  if (!schema || depth > 12) return null
  if (schema.example !== undefined) return schema.example
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0]
  if (schema.const !== undefined) return schema.const
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]
  for (const k of ['oneOf', 'anyOf'] as const) {
    if (Array.isArray(schema[k]) && schema[k].length) return sampleFromSchema(schema[k][0], name, depth + 1)
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length) {
    const merged = schema.allOf.reduce(
      (acc: JSONSchema, s: JSONSchema) => ({
        ...acc,
        ...s,
        properties: { ...(acc.properties ?? {}), ...(s.properties ?? {}) },
      }),
      {},
    )
    return sampleFromSchema(merged, name, depth + 1)
  }
  const type = typesOf(schema).find((t) => t !== 'null') ?? typesOf(schema)[0]
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries<JSONSchema>(schema.properties ?? {}))
        out[k] = sampleFromSchema(v, k, depth + 1)
      return out
    }
    case 'array': {
      const n = Math.max(1, typeof schema.minItems === 'number' ? schema.minItems : 1)
      return Array.from({ length: Math.min(n, 3) }, () =>
        sampleFromSchema(schema.items ?? {}, name, depth + 1),
      )
    }
    case 'string':
      return sampleString(schema, name)
    case 'integer':
      return sampleNumber(schema, true)
    case 'number':
      return sampleNumber(schema, false)
    case 'boolean':
      return true
    case 'null':
      return null
    default:
      return schema.properties ? sampleFromSchema({ ...schema, type: 'object' }, name, depth + 1) : null
  }
}
