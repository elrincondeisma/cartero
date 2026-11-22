import { type Request, type VariableScope, resolveVariables } from '@cartero/core'
import sdk from 'postman-collection'
import codegen from 'postman-code-generators'

export interface SnippetLanguage {
  key: string
  label: string
  syntax: string
  variants: string[]
}

export function snippetLanguages(): SnippetLanguage[] {
  return codegen.getLanguageList().map((l) => ({
    key: l.key,
    label: l.label,
    syntax: l.syntax_mode,
    variants: l.variants.map((v) => v.key),
  }))
}

/**
 * Genera un snippet de código para la petición. Si se pasan capas de variables,
 * se sustituyen antes de generar.
 */
export function generateSnippet(
  request: Request,
  language: string,
  variant: string,
  layers: VariableScope[] = [],
  options: Record<string, unknown> = {},
): Promise<string> {
  const json = layers.length ? JSON.parse(resolveVariables(JSON.stringify(request), layers.map(escapeLayer))) : request
  const req = new sdk.Request(json)
  return new Promise((resolve, reject) =>
    codegen.convert(language, variant, req, { indentCount: 2, indentType: 'Space', trimRequestBody: true, followRedirect: true, ...options }, (err, snippet) =>
      err ? reject(err) : resolve(snippet),
    ),
  )
}

// Los valores se insertan dentro de un JSON: hay que escaparlos.
function escapeLayer(layer: VariableScope): VariableScope {
  const out: VariableScope = {}
  for (const [k, v] of Object.entries(layer)) out[k] = JSON.stringify(v).slice(1, -1)
  return out
}
