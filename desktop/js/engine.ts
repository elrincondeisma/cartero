// Motor de contratos y mock para la app de escritorio: el mismo código que usan la web, el
// servidor y el MCP, empaquetado para QuickJS. Rust llama a estas funciones con JSON.
import {
  checkExchange,
  collectionToOpenApi,
  diffContracts,
  formatChange,
  formatIssue,
  hasContract,
  inferFromText,
  openApiToCollection,
  parseSpec,
  requestContractFrom,
  summarizeChanges,
} from '../../packages/contracts/src/index'
import { mockResponse } from '../../packages/mock/src/index'
import { stringify } from 'yaml'

const engine = {
  /** Lo enviado y lo recibido contra el contrato. */
  check: (contract: any, templateUrl: string, sent: any, res: any) => checkExchange(contract, templateUrl, sent, res),
  /** Cambios entre dos versiones, con su texto ya formateado (en español). */
  diff: (before: any, after: any) => {
    const changes = diffContracts(before ?? undefined, after ?? undefined)
    return { changes: changes.map((c) => ({ ...c, text: formatChange(c) })), summary: summarizeChanges(changes) }
  },
  formatIssue: (issue: any) => formatIssue(issue),
  hasContract: (c: any) => hasContract(c),
  infer: (text: string) => inferFromText(text) ?? null,
  requestContract: (request: any) => requestContractFrom(request),
  toOpenApi: (collection: any, format: 'json' | 'yaml') => {
    const { spec, warnings } = collectionToOpenApi(collection)
    return { text: format === 'json' ? JSON.stringify(spec, null, 2) : stringify(spec), warnings }
  },
  fromOpenApi: (text: string) => openApiToCollection(parseSpec(text)),
  isOpenApi: (text: string) => {
    try {
      const s = parseSpec(text)
      return !!s && typeof s === 'object' && (typeof s.openapi === 'string' || typeof s.swagger === 'string')
    } catch {
      return false
    }
  },
  mock: (collection: any, req: any, vars: Record<string, string>) => {
    const r = mockResponse(collection, req, [vars ?? {}])
    return {
      status: r.status,
      headers: r.headers,
      body: r.body,
      matched: r.match ? `${r.match.item.name} / ${r.match.example.name}` : null,
    }
  },
}

;(globalThis as any).__cartero_engine = engine
