import type { Contract, ContractParam, JSONSchema } from '@cartero/core'
import { format, joinPath, normalizeSchema, typesOf } from './schema.js'

/**
 * Un cambio entre dos versiones de un contrato. `breaking` marca lo que puede romper al
 * frontend (o hacer que el backend rechace lo que el frontend ya envía).
 */
export interface ContractChange {
  breaking: boolean
  /** «request» o el código de respuesta («200», «404»…) */
  section: string
  /** Ruta dentro del cuerpo ($.user.email), nombre del parámetro o el propio código */
  path: string
  /** Si el cambio es de un parámetro: de ruta, query o cabecera */
  param?: ParamKind
  message: string
  params?: (string | number)[]
}

export type ParamKind = 'path' | 'query' | 'header'

const PARAM_LABEL: Record<ParamKind, string> = { path: 'ruta', query: 'query', header: 'cabecera' }

export function formatChange(c: ContractChange): string {
  const where = c.section === 'request' ? 'Petición' : `Respuesta ${c.section}`
  const path = c.param ? `${PARAM_LABEL[c.param]} ${c.path}` : c.path
  return `${where} · ${path}: ${format(c.message, c.params)}`
}

type Side = 'request' | 'response'

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function diffSchema(
  oldS: JSONSchema | undefined,
  newS: JSONSchema | undefined,
  side: Side,
  section: string,
  path: string,
  out: ContractChange[],
) {
  const a = normalizeSchema(oldS)
  const b = normalizeSchema(newS)
  if (!a && !b) return
  if (!a) {
    out.push({ breaking: false, section, path, message: 'Se define la estructura' })
    return
  }
  if (!b) {
    out.push({ breaking: side === 'response', section, path, message: 'Se quita la estructura' })
    return
  }
  const ta = typesOf(a)
  const tb = typesOf(b)
  if (ta.length && tb.length && !sameJson([...ta].sort(), [...tb].sort())) {
    // integer → number amplía; number → integer restringe
    const widen = (from: string[], to: string[]) =>
      from.every((t) => to.includes(t) || (t === 'integer' && to.includes('number')))
    // En la respuesta rompe si llega algo nuevo; en la petición, si deja de aceptarse algo
    const breaking = side === 'response' ? !widen(tb, ta) : !widen(ta, tb)
    out.push({
      breaking,
      section,
      path,
      message: 'Cambia el tipo: {0} → {1}',
      params: [ta.join(' o '), tb.join(' o ')],
    })
    if (!(ta.includes('object') && tb.includes('object')) && !(ta.includes('array') && tb.includes('array')))
      return
  }

  if (Array.isArray(a.enum) || Array.isArray(b.enum)) {
    const ea: unknown[] = a.enum ?? []
    const eb: unknown[] = b.enum ?? []
    const added = eb.filter((v) => !ea.some((x) => sameJson(x, v)))
    const removed = ea.filter((v) => !eb.some((x) => sameJson(x, v)))
    if (!a.enum)
      out.push({ breaking: side === 'request', section, path, message: 'Se limitan los valores permitidos' })
    else if (!b.enum)
      out.push({ breaking: side === 'response', section, path, message: 'Ya no se limitan los valores' })
    else {
      if (added.length)
        out.push({
          breaking: side === 'response',
          section,
          path,
          message: 'Nuevos valores posibles: {0}',
          params: [added.map((v) => JSON.stringify(v)).join(', ')],
        })
      if (removed.length)
        out.push({
          breaking: side === 'request',
          section,
          path,
          message: 'Se quitan valores: {0}',
          params: [removed.map((v) => JSON.stringify(v)).join(', ')],
        })
    }
  }

  if (a.format !== b.format && (a.format || b.format)) {
    out.push({
      breaking: side === 'request' ? !!b.format : !!b.format && b.format !== a.format,
      section,
      path,
      message: 'Cambia el formato: {0} → {1}',
      params: [a.format ?? '—', b.format ?? '—'],
    })
  }

  if (a.properties || b.properties) {
    const pa: Record<string, JSONSchema> = a.properties ?? {}
    const pb: Record<string, JSONSchema> = b.properties ?? {}
    const ra = new Set<string>(a.required ?? [])
    const rb = new Set<string>(b.required ?? [])
    for (const k of Object.keys(pa)) {
      const p = joinPath(path, k)
      if (!(k in pb)) {
        out.push({ breaking: side === 'response', section, path: p, message: 'Se quita el campo' })
        continue
      }
      if (ra.has(k) && !rb.has(k))
        out.push({ breaking: side === 'response', section, path: p, message: 'Deja de ser obligatorio' })
      if (!ra.has(k) && rb.has(k))
        out.push({ breaking: side === 'request', section, path: p, message: 'Pasa a ser obligatorio' })
      diffSchema(pa[k], pb[k], side, section, p, out)
    }
    for (const k of Object.keys(pb)) {
      if (k in pa) continue
      const required = rb.has(k)
      out.push({
        breaking: side === 'request' && required,
        section,
        path: joinPath(path, k),
        message: required ? 'Nuevo campo obligatorio' : 'Nuevo campo opcional',
      })
    }
  }

  if (a.items || b.items) diffSchema(a.items, b.items, side, section, `${path}[]`, out)
}

function diffParams(
  oldP: ContractParam[] | undefined,
  newP: ContractParam[] | undefined,
  side: Side,
  section: string,
  kind: ParamKind,
  out: ContractChange[],
) {
  const a = oldP ?? []
  const b = newP ?? []
  const key = (p: ContractParam) => (kind === 'header' ? p.name.toLowerCase() : p.name)
  for (const p of a) {
    const q = b.find((x) => key(x) === key(p))
    const path = p.name
    const param = kind
    if (!q) {
      out.push({ breaking: side === 'response' && !!p.required, section, path, param, message: 'Se quita' })
      continue
    }
    if (!p.required && q.required)
      out.push({ breaking: side === 'request', section, path, param, message: 'Pasa a ser obligatorio' })
    if (p.required && !q.required)
      out.push({ breaking: side === 'response', section, path, param, message: 'Deja de ser obligatorio' })
    const from = out.length
    diffSchema(p.schema, q.schema, side, section, path, out)
    for (let i = from; i < out.length; i++) out[i].param = kind
  }
  for (const q of b) {
    if (a.some((p) => key(p) === key(q))) continue
    out.push({
      breaking: side === 'request' && !!q.required,
      section,
      path: q.name,
      param: kind,
      message: q.required ? 'Nuevo y obligatorio' : 'Nuevo y opcional',
    })
  }
}

/** Compara dos versiones de un contrato y lista los cambios, separando los que rompen. */
export function diffContracts(oldC: Contract | undefined, newC: Contract | undefined): ContractChange[] {
  const out: ContractChange[] = []
  const a = oldC ?? { responses: {} }
  const b = newC ?? { responses: {} }

  diffParams(a.request?.path, b.request?.path, 'request', 'request', 'path', out)
  diffParams(a.request?.query, b.request?.query, 'request', 'request', 'query', out)
  diffParams(a.request?.headers, b.request?.headers, 'request', 'request', 'header', out)
  diffSchema(a.request?.body, b.request?.body, 'request', 'request', '$', out)

  const ra = a.responses ?? {}
  const rb = b.responses ?? {}
  for (const code of Object.keys(ra)) {
    if (!(code in rb)) {
      out.push({ breaking: true, section: code, path: code, message: 'Se quita este código de respuesta' })
      continue
    }
    diffParams(ra[code].headers, rb[code].headers, 'response', code, 'header', out)
    diffSchema(ra[code].body, rb[code].body, 'response', code, '$', out)
  }
  for (const code of Object.keys(rb)) {
    if (!(code in ra))
      out.push({ breaking: false, section: code, path: code, message: 'Nuevo código de respuesta' })
  }
  return out
}

/** Resumen en una línea para el historial: «2 cambios que rompen, 3 compatibles». */
export function summarizeChanges(changes: ContractChange[]): string {
  const breaking = changes.filter((c) => c.breaking).length
  const compatible = changes.length - breaking
  const parts: string[] = []
  if (breaking) parts.push(breaking === 1 ? '1 cambio que rompe' : `${breaking} cambios que rompen`)
  if (compatible) parts.push(compatible === 1 ? '1 compatible' : `${compatible} compatibles`)
  return parts.join(', ') || 'sin cambios de estructura'
}
