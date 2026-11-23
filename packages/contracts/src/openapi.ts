import {
  type Collection,
  type Contract,
  type ContractParam,
  type FolderItem,
  isFolder,
  type Item,
  type JSONSchema,
  rawUrl,
  type RequestItem,
} from '@cartero/core'
import { inferSchema } from './infer.js'
import { normalizeSchema } from './schema.js'

/** Segmentos de ruta de una URL de Cartero, sin protocolo, host, {{baseUrl}} ni query. */
export function urlPathSegments(url: string): string[] {
  let u = url.split('#')[0].split('?')[0].trim()
  if (/^\{\{[^}]+\}\}/.test(u))
    return u
      .replace(/^\{\{[^}]+\}\}/, '')
      .split('/')
      .filter(Boolean)
  u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const slash = u.indexOf('/')
  u = slash === -1 ? '' : u.slice(slash + 1)
  return u.split('/').filter(Boolean)
}

/** Ruta al estilo OpenAPI: :id y {{id}} pasan a {id}. */
export function openApiPath(url: string): string {
  const segs = urlPathSegments(url).map((s) => {
    const colon = /^:(.+)$/.exec(s)
    if (colon) return `{${colon[1]}}`
    const v = /^\{\{\s*(.+?)\s*\}\}$/.exec(s)
    if (v) return `{${v[1]}}`
    return s
  })
  return `/${segs.join('/')}`
}

/** Clave para emparejar una petición con una operación: método + ruta sin nombres de variable. */
export function operationKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path.replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '') || '/'}`
}

export const REASONS: Record<string, string> = {
  '200': 'OK',
  '201': 'Created',
  '202': 'Accepted',
  '204': 'No Content',
  '400': 'Bad Request',
  '401': 'Unauthorized',
  '403': 'Forbidden',
  '404': 'Not Found',
  '409': 'Conflict',
  '422': 'Unprocessable Entity',
  '429': 'Too Many Requests',
  '500': 'Internal Server Error',
}

function paramSpec(p: ContractParam, location: 'path' | 'query' | 'header') {
  return {
    name: p.name,
    in: location,
    ...(location === 'path' ? { required: true } : p.required ? { required: true } : {}),
    ...(p.description ? { description: p.description } : {}),
    schema: p.schema ?? { type: 'string' },
  }
}

function tryJson(text: string | null | undefined): { ok: boolean; value?: unknown } {
  if (!text?.trim()) return { ok: false }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

export interface OpenApiResult {
  spec: Record<string, any>
  warnings: string[]
}

/**
 * Convierte una colección en OpenAPI 3.1. Las peticiones con contrato llevan sus esquemas;
 * las que no, lo que se puede deducir de su URL, su cuerpo y sus ejemplos guardados.
 */
export function collectionToOpenApi(collection: Collection): OpenApiResult {
  const paths: Record<string, Record<string, any>> = {}
  const warnings: string[] = []
  const servers = new Set<string>()
  const tags = new Map<string, string | undefined>()

  const visit = (items: Item[], folder?: FolderItem) => {
    for (const item of items) {
      if (isFolder(item)) {
        visit(item.item, folder ?? item)
        continue
      }
      const req = (item as RequestItem).request
      const raw = rawUrl(req.url)
      const host = /^(https?:\/\/[^/?#]+)/i.exec(raw)
      if (host) servers.add(host[1])
      const path = openApiPath(raw)
      const method = (req.method || 'GET').toLowerCase()
      paths[path] ??= {}
      if (paths[path][method]) {
        warnings.push(`«${item.name}» repite ${method.toUpperCase()} ${path}; se usa la primera.`)
        continue
      }
      const contract = (item as RequestItem).contract
      const op: Record<string, any> = { summary: item.name }
      if (item.description || req.description) op.description = item.description ?? req.description
      if (folder) {
        op.tags = [folder.name]
        tags.set(folder.name, folder.description)
      }

      // Parámetros: los del contrato y, si faltan, los que se ven en la URL
      const params: any[] = []
      const named = new Set<string>()
      for (const [loc, list] of [
        ['path', contract?.request?.path],
        ['query', contract?.request?.query],
        ['header', contract?.request?.headers],
      ] as const) {
        for (const p of list ?? []) {
          params.push(paramSpec(p, loc))
          named.add(`${loc}:${p.name}`)
        }
      }
      for (const m of path.matchAll(/\{([^}]+)\}/g)) {
        if (!named.has(`path:${m[1]}`))
          params.push({ name: m[1], in: 'path', required: true, schema: { type: 'string' } })
      }
      if (!contract?.request?.query && typeof req.url === 'object') {
        for (const q of req.url.query ?? []) {
          if (!q.key || q.disabled || named.has(`query:${q.key}`)) continue
          params.push({
            name: q.key,
            in: 'query',
            schema: { type: 'string' },
            ...(q.value ? { example: q.value } : {}),
          })
        }
      }
      if (params.length) op.parameters = params

      // Cuerpo de la petición
      const body = req.body
      if (contract?.request?.body) {
        op.requestBody = {
          required: true,
          content: { 'application/json': { schema: contract.request.body } },
        }
      } else if (body?.mode === 'raw' && body.raw?.trim()) {
        const parsed = tryJson(body.raw)
        op.requestBody = parsed.ok
          ? {
              content: {
                'application/json': {
                  schema: inferSchema(parsed.value, { examples: false }),
                  example: parsed.value,
                },
              },
            }
          : { content: { 'text/plain': { schema: { type: 'string' }, example: body.raw } } }
      }

      // Respuestas
      const responses: Record<string, any> = {}
      if (contract && Object.keys(contract.responses ?? {}).length) {
        for (const [code, r] of Object.entries(contract.responses)) {
          responses[code] = {
            description: r.description || REASONS[code] || 'Respuesta',
            ...(r.headers?.length
              ? {
                  headers: Object.fromEntries(
                    r.headers.map((h) => [
                      h.name,
                      {
                        ...(h.required ? { required: true } : {}),
                        ...(h.description ? { description: h.description } : {}),
                        schema: h.schema ?? { type: 'string' },
                      },
                    ]),
                  ),
                }
              : {}),
            ...(r.body ? { content: { 'application/json': { schema: r.body } } } : {}),
          }
        }
      } else {
        for (const ex of (item as RequestItem).response ?? []) {
          const code = String(ex.code ?? 200)
          if (responses[code]) continue
          const parsed = tryJson(ex.body)
          responses[code] = {
            description: ex.name || REASONS[code] || 'Respuesta',
            ...(parsed.ok
              ? {
                  content: {
                    'application/json': {
                      schema: inferSchema(parsed.value, { examples: false }),
                      example: parsed.value,
                    },
                  },
                }
              : {}),
          }
        }
      }
      op.responses = Object.keys(responses).length ? responses : { '200': { description: 'OK' } }
      paths[path][method] = op
    }
  }
  visit(collection.item)

  const spec: Record<string, any> = {
    openapi: '3.1.0',
    info: {
      title: collection.info.name || 'API',
      version: collection.info.version || '1.0.0',
      ...(collection.info.description ? { description: collection.info.description } : {}),
    },
    ...(servers.size ? { servers: [...servers].map((url) => ({ url })) } : {}),
    ...(tags.size
      ? { tags: [...tags].map(([name, description]) => ({ name, ...(description ? { description } : {}) })) }
      : {}),
    paths,
  }
  return { spec, warnings }
}

/** Resuelve los $ref internos (#/components/…) de una especificación, sin entrar en bucles. */
export function dereference(spec: any, node: any, seen: Set<string> = new Set()): any {
  if (Array.isArray(node)) return node.map((n) => dereference(spec, n, seen))
  if (!node || typeof node !== 'object') return node
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
    if (seen.has(node.$ref)) return {}
    let target: any = spec
    for (const part of node.$ref.slice(2).split('/'))
      target = target?.[part.replace(/~1/g, '/').replace(/~0/g, '~')]
    if (target === undefined) return {}
    const next = new Set(seen)
    next.add(node.$ref)
    const { $ref: _ref, ...rest } = node
    return { ...dereference(spec, target, next), ...dereference(spec, rest, seen) }
  }
  const out: any = {}
  for (const [k, v] of Object.entries(node)) out[k] = dereference(spec, v, seen)
  return out
}

function jsonSchemaOf(content: any): JSONSchema | undefined {
  if (!content || typeof content !== 'object') return undefined
  const key = Object.keys(content).find((k) => /json/i.test(k)) ?? Object.keys(content)[0]
  const media = key ? content[key] : undefined
  if (!media?.schema) return undefined
  const schema = normalizeSchema(media.schema) as JSONSchema
  if (media.example !== undefined && schema.example === undefined)
    return { ...schema, example: media.example }
  return schema
}

/** Lee los contratos de una especificación OpenAPI 3.x, indexados por `operationKey`. */
export function contractsFromOpenApi(input: any): Map<string, Contract> {
  const out = new Map<string, Contract>()
  if (!input || typeof input.openapi !== 'string') return out
  const spec = dereference(input, input)
  for (const [path, ops] of Object.entries<any>(spec.paths ?? {})) {
    const shared: any[] = ops.parameters ?? []
    for (const method of ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']) {
      const op = ops[method]
      if (!op) continue
      const contract: Contract = { responses: {} }
      const request: NonNullable<Contract['request']> = {}
      const params = [
        ...shared.filter((s) => !(op.parameters ?? []).some((p: any) => p.name === s.name && p.in === s.in)),
        ...(op.parameters ?? []),
      ]
      for (const p of params) {
        const loc =
          p.in === 'path' ? 'path' : p.in === 'query' ? 'query' : p.in === 'header' ? 'headers' : undefined
        if (!loc) continue
        ;(request[loc] ??= []).push({
          name: p.name,
          ...(p.required || p.in === 'path' ? { required: true } : {}),
          ...(p.description ? { description: p.description } : {}),
          ...(p.schema ? { schema: normalizeSchema(p.schema) } : {}),
        })
      }
      const body = jsonSchemaOf(op.requestBody?.content)
      if (body) request.body = body
      if (Object.keys(request).length) contract.request = request
      for (const [code, r] of Object.entries<any>(op.responses ?? {})) {
        const headers: ContractParam[] = Object.entries<any>(r.headers ?? {}).map(([name, h]) => ({
          name,
          ...(h.required ? { required: true } : {}),
          ...(h.description ? { description: h.description } : {}),
          ...(h.schema ? { schema: normalizeSchema(h.schema) } : {}),
        }))
        const rbody = jsonSchemaOf(r.content)
        contract.responses[code] = {
          ...(r.description ? { description: r.description } : {}),
          ...(rbody ? { body: rbody } : {}),
          ...(headers.length ? { headers } : {}),
        }
      }
      out.set(operationKey(method, path), contract)
    }
  }
  return out
}

/** Cuelga en cada petición de la colección el contrato de su operación OpenAPI. Devuelve cuántas. */
export function attachContracts(collection: Collection, spec: any): number {
  const contracts = contractsFromOpenApi(spec)
  if (!contracts.size) return 0
  let n = 0
  const visit = (items: Item[]) => {
    for (const item of items) {
      if (isFolder(item)) {
        visit(item.item)
        continue
      }
      const req = (item as RequestItem).request
      const c = contracts.get(operationKey(req.method || 'GET', openApiPath(rawUrl(req.url))))
      if (c) {
        ;(item as RequestItem).contract = c
        n++
      }
    }
  }
  visit(collection.item)
  return n
}
