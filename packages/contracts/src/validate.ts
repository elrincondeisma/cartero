import type { Contract, ContractParam, ContractResponse, JSONSchema } from '@cartero/core'
import type { ErrorObject, Options, ValidateFunction } from 'ajv'
import * as Ajv2020Module from 'ajv/dist/2020.js'
import * as addFormatsModule from 'ajv-formats'
import { format, joinPath, jsonType, normalizeSchema, pointerToPath, typesOf } from './schema.js'

// ajv publica CommonJS: según el empaquetador llega el módulo o su default
interface AjvLike {
  compile(schema: object): ValidateFunction
}
const unwrap = (m: any) =>
  typeof m === 'function' ? m : typeof m?.default === 'function' ? m.default : m?.default?.default
const Ajv2020: new (opts: Options) => AjvLike = unwrap(Ajv2020Module)
const addFormats: (ajv: AjvLike) => void = unwrap(addFormatsModule)

/**
 * Un incumplimiento del contrato. `message` es una plantilla en español con {0}, {1}…
 * (la web la traduce con `t(message, params)`; fuera de la web, `formatIssue`).
 */
export interface ContractIssue {
  level: 'error' | 'warning'
  where: 'status' | 'body' | 'header' | 'query' | 'path'
  /** Ruta dentro del cuerpo ($.user.email) o nombre del parámetro. */
  path: string
  message: string
  params?: (string | number)[]
}

export function formatIssue(issue: ContractIssue): string {
  return `${issue.path}: ${format(issue.message, issue.params)}`
}

let ajv: AjvLike | undefined
const cache = new Map<string, ValidateFunction>()

function compile(schema: JSONSchema): ValidateFunction | undefined {
  const key = JSON.stringify(schema)
  let fn = cache.get(key)
  if (fn) return fn
  if (!ajv) {
    ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true })
    addFormats(ajv)
  }
  let compiled: ValidateFunction
  try {
    compiled = ajv.compile(schema)
  } catch {
    return undefined
  }
  if (cache.size > 200) cache.clear()
  cache.set(key, compiled)
  return compiled
}

function valueAt(data: unknown, pointer: string): unknown {
  let cur: any = data
  for (const p of pointer.split('/').slice(1)) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = cur[p.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return cur
}

function ajvIssue(e: ErrorObject, data: unknown, where: ContractIssue['where']): ContractIssue {
  const p = e.params as Record<string, any>
  switch (e.keyword) {
    case 'required':
      return {
        level: 'error',
        where,
        path: pointerToPath(e.instancePath, p.missingProperty),
        message: 'Es obligatorio y no ha llegado',
      }
    case 'type':
      return {
        level: 'error',
        where,
        path: pointerToPath(e.instancePath),
        message: 'Se esperaba {0} y ha llegado {1}',
        params: [[].concat(p.type).join(' o '), jsonType(valueAt(data, e.instancePath))],
      }
    case 'enum':
      return {
        level: 'error',
        where,
        path: pointerToPath(e.instancePath),
        message: 'Solo admite estos valores: {0}',
        params: [(p.allowedValues ?? []).map((v: unknown) => JSON.stringify(v)).join(', ')],
      }
    case 'const':
      return {
        level: 'error',
        where,
        path: pointerToPath(e.instancePath),
        message: 'Debe valer {0}',
        params: [JSON.stringify(p.allowedValue)],
      }
    case 'format':
      return {
        level: 'error',
        where,
        path: pointerToPath(e.instancePath),
        message: 'No tiene formato {0}',
        params: [p.format],
      }
    case 'additionalProperties':
      return {
        level: 'error',
        where,
        path: pointerToPath(e.instancePath, p.additionalProperty),
        message: 'El contrato no permite este campo',
      }
    default:
      return {
        level: 'error',
        where,
        path: pointerToPath(e.instancePath),
        message: 'No cumple la regla {0}',
        params: [`${e.keyword} ${JSON.stringify(p)}`],
      }
  }
}

/** Campos que llegan y el contrato no menciona (aviso, no error), cuando el objeto no los prohíbe. */
function extraFields(
  schema: JSONSchema | undefined,
  data: unknown,
  path: string,
  where: ContractIssue['where'],
  out: ContractIssue[],
) {
  if (!schema || data === null || typeof data !== 'object') return
  if (Array.isArray(data)) {
    if (schema.items && typeof schema.items === 'object') {
      // Basta con mirar unos pocos elementos para avisar
      data.slice(0, 20).forEach((v, i) => extraFields(schema.items, v, `${path}[${i}]`, where, out))
    }
    return
  }
  if (!schema.properties || schema.additionalProperties !== undefined) return
  for (const [k, v] of Object.entries(data)) {
    const sub = schema.properties[k]
    if (!sub)
      out.push({ level: 'warning', where, path: joinPath(path, k), message: 'No está en el contrato' })
    else extraFields(sub, v, joinPath(path, k), where, out)
  }
}

/** Valida un valor JSON contra un esquema. */
export function validateValue(
  schema: JSONSchema,
  data: unknown,
  where: ContractIssue['where'] = 'body',
): ContractIssue[] {
  const s = normalizeSchema(schema) ?? {}
  const fn = compile(s)
  const out: ContractIssue[] = []
  if (!fn) {
    out.push({
      level: 'warning',
      where,
      path: '$',
      message: 'El esquema del contrato no es válido y no se ha podido comprobar',
    })
    return out
  }
  if (!fn(data)) {
    const seen = new Set<string>()
    for (const e of fn.errors ?? []) {
      // anyOf/oneOf repiten el error de cada rama: basta con uno por ruta y tipo
      const issue = ajvIssue(e, data, where)
      const k = `${issue.path}|${e.keyword}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(issue)
    }
  }
  extraFields(s, data, '$', where, out)
  return out
}

/** Busca qué parte del contrato describe un código: exacto, rango (2XX) o «default». */
export function responseFor(
  contract: Contract | undefined,
  status: number,
): { code: string; spec: ContractResponse } | undefined {
  const r = contract?.responses ?? {}
  const exact = r[String(status)]
  if (exact) return { code: String(status), spec: exact }
  const range = `${String(status)[0]}XX`
  for (const k of Object.keys(r)) if (k.toUpperCase() === range) return { code: k, spec: r[k] }
  if (r.default) return { code: 'default', spec: r.default }
  return undefined
}

function parseBody(body: string | null | undefined): { ok: true; value: unknown } | { ok: false } {
  if (body === null || body === undefined || body.trim() === '') return { ok: false }
  try {
    return { ok: true, value: JSON.parse(body) }
  } catch {
    return { ok: false }
  }
}

/** Convierte el texto de un parámetro al tipo que pide su esquema, para validarlo. */
function coerce(raw: string, schema: JSONSchema | undefined): unknown {
  const types = typesOf(schema)
  if (
    (types.includes('integer') || types.includes('number')) &&
    raw.trim() !== '' &&
    !Number.isNaN(Number(raw))
  )
    return Number(raw)
  if (types.includes('boolean') && (raw === 'true' || raw === 'false')) return raw === 'true'
  return raw
}

function checkParams(
  params: ContractParam[] | undefined,
  actual: { key: string; value: string }[],
  where: ContractIssue['where'],
  caseInsensitive = false,
): ContractIssue[] {
  const out: ContractIssue[] = []
  const norm = (s: string) => (caseInsensitive ? s.toLowerCase() : s)
  for (const p of params ?? []) {
    const found = actual.find((a) => norm(a.key) === norm(p.name))
    if (!found || found.value === '') {
      if (p.required)
        out.push({
          level: 'error',
          where,
          path: p.name,
          message: where === 'header' ? 'Falta la cabecera obligatoria' : 'Falta el parámetro obligatorio',
        })
      continue
    }
    if (p.schema && !/^\{\{.+\}\}$/.test(found.value)) {
      for (const i of validateValue(p.schema, coerce(found.value, p.schema), where))
        if (i.level === 'error') out.push({ ...i, path: p.name })
    }
  }
  return out
}

export interface ResponseToCheck {
  status: number
  headers: { key: string; value: string }[]
  body: string | null | undefined
}

/** Comprueba una respuesta real contra el contrato. */
export function validateResponse(contract: Contract, res: ResponseToCheck): ContractIssue[] {
  const found = responseFor(contract, res.status)
  if (!found) {
    const codes = Object.keys(contract.responses ?? {})
    return [
      {
        level: 'error',
        where: 'status',
        path: String(res.status),
        message: codes.length
          ? 'Este código no está en el contrato (previstos: {0})'
          : 'El contrato no define ninguna respuesta',
        params: [codes.join(', ')],
      },
    ]
  }
  const out = checkParams(found.spec.headers, res.headers, 'header', true)
  if (found.spec.body) {
    const parsed = parseBody(res.body)
    if (!parsed.ok) {
      out.push({
        level: 'error',
        where: 'body',
        path: '$',
        message: res.body?.trim()
          ? 'La respuesta no es JSON y el contrato espera un JSON'
          : 'La respuesta llega vacía y el contrato espera un cuerpo',
      })
    } else out.push(...validateValue(found.spec.body, parsed.value, 'body'))
  }
  return out
}

export interface RequestToCheck {
  query: { key: string; value: string }[]
  headers: { key: string; value: string }[]
  path: { key: string; value: string }[]
  /** Cuerpo en texto (solo se comprueba si es JSON) */
  body?: string | null
  /** El cuerpo tiene variables {{…}} y no se puede comprobar tal cual */
  bodyHasVariables?: boolean
}

/** Comprueba lo que envía el frontend contra su parte del contrato. */
export function validateRequest(contract: Contract, req: RequestToCheck): ContractIssue[] {
  const spec = contract.request
  if (!spec) return []
  const out = [
    ...checkParams(spec.path, req.path, 'path'),
    ...checkParams(spec.query, req.query, 'query'),
    ...checkParams(spec.headers, req.headers, 'header', true),
  ]
  if (spec.body && !req.bodyHasVariables) {
    const parsed = parseBody(req.body)
    if (!parsed.ok) {
      out.push({
        level: 'error',
        where: 'body',
        path: '$',
        message: req.body?.trim()
          ? 'El cuerpo no es JSON y el contrato espera un JSON'
          : 'Falta el cuerpo que pide el contrato',
      })
    } else out.push(...validateValue(spec.body, parsed.value, 'body'))
  }
  return out
}
