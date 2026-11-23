import type { Contract, ContractParam, Request } from '@cartero/core'
import { inferSchema } from './infer.js'
import { urlPathSegments } from './openapi.js'

/** Esquema de un texto JSON, o undefined si no es JSON. */
export function inferFromText(text: string | null | undefined): Contract['responses'][string]['body'] {
  if (!text?.trim()) return undefined
  try {
    return inferSchema(JSON.parse(text))
  } catch {
    return undefined
  }
}

const SKIP_HEADERS = new Set([
  'content-length',
  'host',
  'user-agent',
  'accept-encoding',
  'connection',
  'cookie',
])

/**
 * Parte de petición de un contrato sacada de la petición actual: parámetros de ruta,
 * query y cabeceras activas, y el esquema del cuerpo si es JSON sin variables.
 */
export function requestContractFrom(req: Request): NonNullable<Contract['request']> {
  const out: NonNullable<Contract['request']> = {}
  const raw = typeof req.url === 'string' ? req.url : (req.url?.raw ?? '')
  const path: ContractParam[] = []
  for (const s of urlPathSegments(raw)) {
    const m = /^:(.+)$/.exec(s)
    if (m) path.push({ name: m[1], required: true, schema: { type: 'string' } })
  }
  if (path.length) out.path = path
  const query = (typeof req.url === 'object' ? (req.url.query ?? []) : [])
    .filter((q) => q.key && !q.disabled)
    .map((q) => ({ name: q.key as string, required: false, schema: { type: 'string' } }))
  if (query.length) out.query = query
  const headers = (req.header ?? [])
    .filter((h) => h.key && !h.disabled && !SKIP_HEADERS.has(h.key.toLowerCase()))
    .map((h) => ({ name: h.key, required: true, schema: { type: 'string' } }))
  if (headers.length) out.headers = headers
  if (req.body?.mode === 'raw' && req.body.raw?.trim() && !/\{\{.+?\}\}/.test(req.body.raw)) {
    const body = inferFromText(req.body.raw)
    if (body) out.body = body
  }
  return out
}

/** ¿Tiene el contrato algo definido? */
export function hasContract(c: Contract | undefined): boolean {
  if (!c) return false
  const r = c.request
  return (
    Object.keys(c.responses ?? {}).length > 0 ||
    !!(r && (r.body || r.query?.length || r.headers?.length || r.path?.length))
  )
}
