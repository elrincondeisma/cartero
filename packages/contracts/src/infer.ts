import type { JSONSchema } from '@cartero/core'
import { jsonType, typesOf } from './schema.js'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const URI = /^https?:\/\/[^\s]+$/

function stringFormat(s: string): string | undefined {
  if (UUID.test(s)) return 'uuid'
  if (EMAIL.test(s)) return 'email'
  if (DATE_TIME.test(s) && !Number.isNaN(Date.parse(s))) return 'date-time'
  if (DATE.test(s)) return 'date'
  if (URI.test(s)) return 'uri'
  return undefined
}

export interface InferOptions {
  /** Guarda el valor real como `example` (por defecto, sí). */
  examples?: boolean
}

/**
 * Saca un JSON Schema de un valor real: tipos, campos obligatorios (todos los que llegan),
 * formatos reconocibles y ejemplos. Las listas fusionan la forma de todos sus elementos.
 */
export function inferSchema(value: unknown, opts: InferOptions = {}): JSONSchema {
  const examples = opts.examples !== false
  const type = jsonType(value)
  if (type === 'null') return { type: 'null' }
  if (type === 'array') {
    const arr = value as unknown[]
    if (!arr.length) return { type: 'array', items: {} }
    const items = arr.slice(0, 50).map((v) => inferSchema(v, opts))
    return { type: 'array', items: items.reduce((a, b) => mergeSchemas(a, b)) }
  }
  if (type === 'object') {
    const obj = value as Record<string, unknown>
    const properties: Record<string, JSONSchema> = {}
    for (const [k, v] of Object.entries(obj)) properties[k] = inferSchema(v, opts)
    const keys = Object.keys(obj)
    return { type: 'object', properties, ...(keys.length ? { required: keys } : {}) }
  }
  const schema: JSONSchema = { type }
  if (type === 'string') {
    const fmt = stringFormat(value as string)
    if (fmt) schema.format = fmt
  }
  if (examples) schema.example = value
  return schema
}

/**
 * Une dos esquemas que describen valores del mismo sitio (elementos de una lista).
 * Un campo solo sigue siendo obligatorio si lo es en los dos.
 */
export function mergeSchemas(a: JSONSchema, b: JSONSchema): JSONSchema {
  const ta = typesOf(a)
  const tb = typesOf(b)
  if (!ta.length) return b
  if (!tb.length) return a
  const nonNullA = ta.filter((t) => t !== 'null')
  const nonNullB = tb.filter((t) => t !== 'null')
  const hasNull = ta.includes('null') || tb.includes('null')

  // integer y number juntos son number
  const merged = Array.from(new Set([...nonNullA, ...nonNullB]))
  const types = merged.includes('number') ? merged.filter((t) => t !== 'integer') : merged

  if (types.length === 1 && types[0] === 'object' && nonNullA.length && nonNullB.length) {
    const props: Record<string, JSONSchema> = { ...(a.properties ?? {}) }
    for (const [k, v] of Object.entries<JSONSchema>(b.properties ?? {}))
      props[k] = props[k] ? mergeSchemas(props[k], v) : v
    const reqA = new Set<string>(a.required ?? [])
    const required = (b.required ?? []).filter((k: string) => reqA.has(k))
    return {
      type: hasNull ? ['object', 'null'] : 'object',
      properties: props,
      ...(required.length ? { required } : {}),
    }
  }
  if (types.length === 1 && types[0] === 'array' && nonNullA.length && nonNullB.length) {
    return { type: hasNull ? ['array', 'null'] : 'array', items: mergeSchemas(a.items ?? {}, b.items ?? {}) }
  }
  // Solo uno trae valor (el otro es null): ese esquema, admitiendo null
  if (!nonNullA.length || !nonNullB.length) {
    const base = nonNullA.length ? a : b
    const t = typesOf(base).filter((x) => x !== 'null')
    return { ...base, type: [...t, 'null'] }
  }
  const out: JSONSchema = { type: hasNull ? [...types, 'null'] : types.length === 1 ? types[0] : types }
  if (a.format && a.format === b.format) out.format = a.format
  if (a.example !== undefined) out.example = a.example
  return out
}
