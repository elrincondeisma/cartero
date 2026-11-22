import { Fragment, createElement } from 'react'
/**
 * i18n mínimo: el texto en español es la clave y en.ts lo traduce al inglés.
 * Si falta una traducción se muestra el español (nunca una clave rara).
 * Cambiar de idioma recarga la app, así t() puede ser una función normal
 * y funciona también en constantes de módulo.
 */
import { en } from './en'

export type Lang = 'es' | 'en'
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'English' },
]

const KEY = 'cartero-lang'

function detect(): Lang {
  const saved = localStorage.getItem(KEY)
  if (saved === 'es' || saved === 'en') return saved
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export const lang: Lang = detect()
export const locale = lang === 'en' ? 'en-US' : 'es-ES'
export const hasExplicitLang = () => localStorage.getItem(KEY) !== null
document.documentElement.lang = lang

type Vars = Record<string, unknown> | unknown[]

/** Traduce y sustituye {nombre} o {0} por los valores dados. */
export function t(text: string, vars?: Vars): string {
  let out = lang === 'en' ? (en[text] ?? text) : text
  if (vars) {
    out = out.replace(/\{(\w+)\}/g, (m, k: string) => {
      const v = Array.isArray(vars) ? vars[Number(k)] : vars[k]
      return v === undefined ? m : String(v)
    })
  }
  return out
}

/** Traduce mensajes del servidor: exactos o con la forma «Mensaje: detalle». */
export function tServer(message: string): string {
  if (lang === 'es') return message
  if (en[message]) return en[message]
  const i = message.indexOf(': ')
  if (i > 0 && en[message.slice(0, i)]) return `${en[message.slice(0, i)]}: ${message.slice(i + 2)}`
  return message
}

export function setLang(l: Lang, opts: { reload?: boolean } = {}) {
  localStorage.setItem(KEY, l)
  if (opts.reload !== false) location.reload()
}

/**
 * Traduce una frase entera que lleva elementos dentro (negritas, <kbd>, <code>…):
 *   tj('Pulsa {btn} para enviar', { btn: <b>Enviar</b> })
 * Así el orden de las palabras puede cambiar entre idiomas.
 */
export function tj(text: string, parts: Record<string, import('react').ReactNode>): import('react').ReactNode[] {
  return t(text)
    .split(/(\{\w+\})/)
    .filter(Boolean)
    .map((chunk, i) => {
      const m = chunk.match(/^\{(\w+)\}$/)
      return createElement(Fragment, { key: i }, m && m[1] in parts ? parts[m[1]] : chunk)
    })
}
