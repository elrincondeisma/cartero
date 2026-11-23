import type { Contract } from '@cartero/core'
import { urlPathSegments } from './openapi.js'
import { type ContractIssue, validateRequest, validateResponse } from './validate.js'

type KV = { key: string; value: string }

/** Lo que se envió de verdad (URL ya resuelta, cabeceras y cuerpo finales). */
export interface SentRequest {
  url: string
  headers: KV[]
  body?: string | null
}

/** Lo que llegó. */
export interface ReceivedResponse {
  code: number
  headers: KV[]
  body?: string | null
}

export interface ExchangeCheck {
  request: ContractIssue[]
  response: ContractIssue[]
  errors: number
  warnings: number
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * Valores de los parámetros de ruta: la plantilla (/users/:id) y la URL enviada se alinean
 * desde el final, porque {{baseUrl}} puede llevar segmentos propios (/api/v1).
 */
export function pathValues(template: string, sent: string): KV[] {
  const tpl = urlPathSegments(template)
  const real = urlPathSegments(sent)
  const out: KV[] = []
  for (let i = 1; i <= tpl.length && i <= real.length; i++) {
    const seg = tpl[tpl.length - i]
    const name = /^:(.+)$/.exec(seg)?.[1] ?? /^\{\{\s*(.+?)\s*\}\}$/.exec(seg)?.[1]
    if (name) out.push({ key: name, value: safeDecode(real[real.length - i]) })
  }
  return out
}

export function queryValues(url: string): KV[] {
  const q = url.split('#')[0].split('?')[1]
  if (!q) return []
  return [...new URLSearchParams(q)].map(([key, value]) => ({ key, value }))
}

/** Comprueba lo que se envió y lo que llegó contra el contrato de la petición. */
export function checkExchange(
  contract: Contract,
  templateUrl: string,
  sent?: SentRequest | null,
  res?: ReceivedResponse | null,
): ExchangeCheck {
  const request = sent
    ? validateRequest(contract, {
        path: pathValues(templateUrl, sent.url),
        query: queryValues(sent.url),
        headers: sent.headers,
        body: sent.body,
      })
    : []
  const response = res
    ? validateResponse(contract, { status: res.code, headers: res.headers, body: res.body })
    : []
  const all = [...request, ...response]
  return {
    request,
    response,
    errors: all.filter((i) => i.level === 'error').length,
    warnings: all.filter((i) => i.level === 'warning').length,
  }
}
