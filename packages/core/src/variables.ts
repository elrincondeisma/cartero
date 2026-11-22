import type { Variable } from './types.js'

export type VariableScope = Record<string, string>

/** Convierte una lista de variables a mapa, ignorando las deshabilitadas. */
export function toScope(vars: Variable[] | undefined): VariableScope {
  const out: VariableScope = {}
  for (const v of vars ?? []) {
    if (v.disabled || !v.key) continue
    out[v.key] = v.value == null ? '' : String(v.value)
  }
  return out
}

/**
 * Resuelve {{variables}} en un texto. Las capas se pasan de menor a mayor prioridad
 * (globales → colección → entorno → datos → locales), igual que en Postman.
 */
export function resolveVariables(text: string, layers: VariableScope[], maxDepth = 10): string {
  const merged: VariableScope = Object.assign({}, ...layers)
  let out = text
  for (let i = 0; i < maxDepth; i++) {
    const next = out.replace(/\{\{([^{}]+?)\}\}/g, (m, name: string) => {
      const key = name.trim()
      return Object.hasOwn(merged, key) ? merged[key] : m
    })
    if (next === out) break
    out = next
  }
  return out
}

/** Lista los nombres de {{variables}} usados en un texto. */
export function extractVariableNames(text: string): string[] {
  const names = new Set<string>()
  for (const m of text.matchAll(/\{\{([^{}]+?)\}\}/g)) names.add(m[1].trim())
  return [...names]
}
