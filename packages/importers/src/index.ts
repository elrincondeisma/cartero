import { unzipSync, strFromU8 } from 'fflate'
import YAML from 'yaml'
import type { ImportResult } from '@cartero/core'
import { importCurl, isCurl } from './curl.js'
import { importInsomniaV4, importInsomniaV5, isInsomniaV4, isInsomniaV5 } from './insomnia.js'
import { importOpenApi, isOpenApi } from './openapi.js'
import {
  importPostmanCollection,
  importPostmanEnvironment,
  importPostmanGlobals,
  isPostmanCollection,
  isPostmanDump,
  isPostmanEnvironment,
  isPostmanGlobals,
} from './postman.js'

export * from './curl.js'
export * from './insomnia.js'
export * from './openapi.js'
export * from './postman.js'

function empty(format: string): ImportResult {
  return { collections: [], environments: [], warnings: [], format }
}

function merge(into: ImportResult, from: ImportResult) {
  into.collections.push(...from.collections)
  into.environments.push(...from.environments)
  if (from.globals) into.globals = [...(into.globals ?? []), ...from.globals]
  into.warnings.push(...from.warnings)
}

function parseStructured(text: string): any | undefined {
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t)
    } catch {
      return undefined
    }
  }
  try {
    const doc = YAML.parse(t)
    return doc && typeof doc === 'object' ? doc : undefined
  } catch {
    return undefined
  }
}

async function importJson(json: any): Promise<ImportResult> {
  if (isPostmanDump(json)) {
    const r = empty('postman-dump')
    for (const c of json.collections) r.collections.push(await importPostmanCollection(c))
    for (const e of json.environments ?? []) r.environments.push(importPostmanEnvironment(e))
    if (Array.isArray(json.globals)) r.globals = importPostmanGlobals({ values: json.globals })
    return r
  }
  if (isPostmanCollection(json)) {
    const r = empty('postman-collection')
    r.collections.push(await importPostmanCollection(json))
    return r
  }
  if (isPostmanGlobals(json)) return { ...empty('postman-globals'), globals: importPostmanGlobals(json) }
  if (isPostmanEnvironment(json)) {
    const r = empty('postman-environment')
    r.environments.push(importPostmanEnvironment(json))
    return r
  }
  if (isInsomniaV4(json)) return { ...empty('insomnia-v4'), ...importInsomniaV4(json) }
  if (isInsomniaV5(json)) return { ...empty('insomnia-v5'), ...importInsomniaV5(json) }
  if (isOpenApi(json)) {
    const { collection, warnings } = await importOpenApi(json)
    return { ...empty(json.swagger ? 'swagger-2' : `openapi-${json.openapi}`), collections: [collection], warnings }
  }
  throw new Error('Formato no reconocido')
}

function isZip(data: Uint8Array) {
  return data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04
}

/**
 * Detecta el formato e importa. Acepta texto (JSON, YAML, cURL) o binario (ZIP de exportación de Postman).
 */
export async function importAny(input: string | Uint8Array): Promise<ImportResult> {
  if (input instanceof Uint8Array) {
    if (isZip(input)) {
      const files = unzipSync(input)
      const result = empty('zip')
      for (const [name, bytes] of Object.entries(files)) {
        if (name.endsWith('/') || name.startsWith('__MACOSX') || !/\.(json|ya?ml)$/i.test(name)) continue
        try {
          merge(result, await importAny(strFromU8(bytes)))
        } catch (e) {
          result.warnings.push(`${name}: ${(e as Error).message}`)
        }
      }
      if (!result.collections.length && !result.environments.length && !result.globals)
        throw new Error('El ZIP no contiene nada importable')
      return result
    }
    input = strFromU8(input)
  }

  const text = input.replace(/^﻿/, '')
  if (isCurl(text)) {
    const r = empty('curl')
    r.collections.push(importCurl(text))
    return r
  }
  const json = parseStructured(text)
  if (json === undefined) throw new Error('No se pudo leer el contenido: no es JSON, YAML ni cURL')
  return importJson(json)
}
