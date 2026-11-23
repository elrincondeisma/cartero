import type {
  Collection,
  FolderItem,
  Item,
  KeyValue,
  QueryParam,
  RequestItem,
  ResponseExample,
  Variable,
} from '@cartero/core'
import { parse as parseYaml } from 'yaml'
import { REASONS, attachContracts, dereference } from './openapi.js'
import { sampleFromSchema } from './sample.js'

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

/** Texto de un valor de ejemplo para la URL o una cabecera. */
function asText(v: unknown): string {
  if (v === undefined || v === null) return ''
  return typeof v === 'string' ? v : JSON.stringify(v)
}

/** Ejemplo de un parámetro: example, examples, default o uno generado desde su esquema. */
function paramExample(p: any): unknown {
  if (p.example !== undefined) return p.example
  const ex = p.examples && Object.values<any>(p.examples)[0]
  if (ex?.value !== undefined) return ex.value
  if (p.schema?.example !== undefined) return p.schema.example
  if (p.schema?.default !== undefined) return p.schema.default
  return p.required || p.in === 'path' ? sampleFromSchema(p.schema ?? { type: 'string' }, p.name) : ''
}

/** Ejemplo del contenido de un requestBody o una respuesta. */
function mediaExample(media: any): unknown {
  if (!media) return undefined
  if (media.example !== undefined) return media.example
  const ex = media.examples && Object.values<any>(media.examples)[0]
  if (ex?.value !== undefined) return ex.value
  if (media.schema) return sampleFromSchema(media.schema)
  return undefined
}

/** URL del primer servidor, con sus {variables} sustituidas por el valor por defecto. */
function serverUrl(spec: any): string {
  const s = spec.servers?.[0]
  if (!s?.url) return ''
  return String(s.url)
    .replace(/\{([^}]+)\}/g, (_m: string, name: string) => s.variables?.[name]?.default ?? name)
    .replace(/\/$/, '')
}

function jsonMedia(content: any): [string, any] | undefined {
  if (!content) return undefined
  return Object.entries<any>(content).find(([type]) => /json/i.test(type)) ?? Object.entries<any>(content)[0]
}

export interface OpenApiImport {
  collection: Collection
  warnings: string[]
}

/**
 * Convierte una especificación OpenAPI 3.0/3.1 en una colección: una carpeta por tag y una
 * petición por operación, con {{baseUrl}}, :parámetros, query, cabeceras, cuerpo de ejemplo,
 * respuestas de ejemplo y su contrato. Es la versión ligera que usa la app de escritorio
 * (la web usa openapi-to-postmanv2).
 */
export function openApiToCollection(input: any): OpenApiImport {
  if (!input || typeof input !== 'object') throw new Error('La especificación está vacía')
  if (input.swagger)
    throw new Error('Swagger 2.0 no se puede importar aquí: conviértelo a OpenAPI 3 o impórtalo desde la web')
  if (typeof input.openapi !== 'string')
    throw new Error('No es una especificación OpenAPI (falta el campo «openapi»)')
  const spec = dereference(input, input)
  const warnings: string[] = []
  const root: Item[] = []
  const folders = new Map<string, FolderItem>()

  for (const [path, ops] of Object.entries<any>(spec.paths ?? {})) {
    const shared: any[] = ops?.parameters ?? []
    for (const method of METHODS) {
      const op = ops?.[method]
      if (!op) continue
      const params: any[] = [
        ...shared.filter((s) => !(op.parameters ?? []).some((p: any) => p.name === s.name && p.in === s.in)),
        ...(op.parameters ?? []),
      ]
      const segments = path
        .split('/')
        .filter(Boolean)
        .map((s) => s.replace(/^\{(.+)\}$/, ':$1'))
      const query: QueryParam[] = params
        .filter((p) => p.in === 'query')
        .map((p) => ({
          key: p.name,
          value: asText(paramExample(p)),
          ...(p.required ? {} : { disabled: true }),
          ...(p.description ? { description: p.description } : {}),
        }))
      const variable: Variable[] = params
        .filter((p) => p.in === 'path')
        .map((p) => ({
          key: p.name,
          value: asText(paramExample(p)),
          ...(p.description ? { description: p.description } : {}),
        }))
      const header: KeyValue[] = params
        .filter((p) => p.in === 'header')
        .map((p) => ({
          key: p.name,
          value: asText(paramExample(p)),
          ...(p.required ? {} : { disabled: true }),
        }))

      let body: RequestItem['request']['body']
      const reqMedia = jsonMedia(op.requestBody?.content)
      if (reqMedia) {
        const [type, media] = reqMedia
        const ex = mediaExample(media)
        if (/x-www-form-urlencoded/i.test(type) && ex && typeof ex === 'object')
          body = {
            mode: 'urlencoded',
            urlencoded: Object.entries(ex).map(([key, value]) => ({ key, value: asText(value) })),
          }
        else if (ex !== undefined) {
          body = {
            mode: 'raw',
            raw: typeof ex === 'string' ? ex : JSON.stringify(ex, null, 2),
            options: { raw: { language: /json/i.test(type) ? 'json' : 'text' } },
          }
          if (!header.some((h) => h.key.toLowerCase() === 'content-type'))
            header.push({ key: 'Content-Type', value: type })
        }
      }

      const qs = query
        .filter((q) => !q.disabled)
        .map((q) => `${q.key}=${q.value}`)
        .join('&')
      const raw = `{{baseUrl}}/${segments.join('/')}${qs ? `?${qs}` : ''}`
      const url = {
        raw,
        host: ['{{baseUrl}}'],
        path: segments,
        ...(query.length ? { query } : {}),
        ...(variable.length ? { variable } : {}),
      }

      const response: ResponseExample[] = []
      for (const [code, r] of Object.entries<any>(op.responses ?? {})) {
        const media = jsonMedia(r?.content)
        const ex = media ? mediaExample(media[1]) : undefined
        if (ex === undefined || !/^\d{3}$/.test(code)) continue
        response.push({
          name: r.description || `${code} ${REASONS[code] ?? ''}`.trim(),
          code: Number(code),
          status: REASONS[code] ?? '',
          header: [{ key: 'Content-Type', value: media![0] }],
          body: typeof ex === 'string' ? ex : JSON.stringify(ex, null, 2),
          _postman_previewlanguage: /json/i.test(media![0]) ? 'json' : 'text',
        })
      }

      const item: RequestItem = {
        name: op.summary || op.operationId || `${method.toUpperCase()} ${path}`,
        request: {
          method: method.toUpperCase(),
          url,
          header,
          ...(body ? { body } : {}),
          ...(op.description ? { description: op.description } : {}),
        },
        response,
      }
      const tag: string | undefined = op.tags?.[0]
      if (!tag) root.push(item)
      else {
        let folder = folders.get(tag)
        if (!folder) {
          const info = (spec.tags ?? []).find((t: any) => t.name === tag)
          folder = { name: tag, item: [], ...(info?.description ? { description: info.description } : {}) }
          folders.set(tag, folder)
          root.push(folder)
        }
        folder.item.push(item)
      }
    }
  }

  const base = serverUrl(spec)
  if (!base)
    warnings.push('La especificación no tiene «servers»: rellena la variable baseUrl de la colección.')
  const collection: Collection = {
    info: {
      name: spec.info?.title || 'OpenAPI',
      ...(spec.info?.description ? { description: spec.info.description } : {}),
      ...(spec.info?.version ? { version: spec.info.version } : {}),
    },
    item: root,
    variable: [{ key: 'baseUrl', value: base }],
  } as Collection
  const n = attachContracts(collection, input)
  if (n) warnings.push(`${n} petición(es) con contrato importado desde los esquemas de OpenAPI.`)
  return { collection, warnings }
}

/** Lee una especificación en JSON o YAML. */
export function parseSpec(text: string): any {
  const t = text.trim()
  if (t.startsWith('{')) return JSON.parse(t)
  return parseYaml(t)
}
