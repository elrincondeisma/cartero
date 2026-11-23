import type { Contract } from '@cartero/core'
import { type ContractIssue, urlPathSegments, validateRequest, validateResponse } from '@cartero/contracts'
import type { Execution } from '@/api/types'

export interface ContractCheck {
  request: ContractIssue[]
  response: ContractIssue[]
  errors: number
  warnings: number
}

/**
 * Valores de los parámetros de ruta: la plantilla (/users/:id) y la URL enviada se alinean
 * desde el final, porque {{baseUrl}} puede llevar segmentos propios (/api/v1).
 */
function pathValues(template: string, sent: string): { key: string; value: string }[] {
  const tpl = urlPathSegments(template)
  const real = urlPathSegments(sent)
  const out: { key: string; value: string }[] = []
  for (let i = 1; i <= tpl.length && i <= real.length; i++) {
    const seg = tpl[tpl.length - i]
    const name = /^:(.+)$/.exec(seg)?.[1] ?? /^\{\{\s*(.+?)\s*\}\}$/.exec(seg)?.[1]
    if (name) out.push({ key: name, value: safeDecode(real[real.length - i]) })
  }
  return out
}

function queryValues(url: string): { key: string; value: string }[] {
  const q = url.split('#')[0].split('?')[1]
  if (!q) return []
  return [...new URLSearchParams(q)].map(([key, value]) => ({ key, value }))
}

/** Comprueba lo que se envió y lo que llegó contra el contrato de la petición. */
export function checkExecution(contract: Contract, templateUrl: string, execution: Execution): ContractCheck {
  const sent = execution.request
  const request = sent
    ? validateRequest(contract, {
        path: pathValues(templateUrl, sent.url),
        query: queryValues(sent.url),
        headers: sent.headers,
        body: sent.body,
      })
    : []
  const res = execution.response
  const response = res ? validateResponse(contract, { status: res.code, headers: res.headers, body: res.body }) : []
  const all = [...request, ...response]
  return {
    request,
    response,
    errors: all.filter((i) => i.level === 'error').length,
    warnings: all.filter((i) => i.level === 'warning').length,
  }
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
