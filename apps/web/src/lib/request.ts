import { type QueryParam, type Request, type Url, parseUrl, rawUrl } from '@cartero/core'

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export function urlObject(url: Url | string | undefined): Url {
  if (!url) return { raw: '' }
  if (typeof url === 'string') return parseUrl(url)
  if (url.raw === undefined) return { ...url, raw: rawUrl(url) }
  return url
}

/** El usuario escribe en la barra de URL: recalcula query params y path variables. */
export function setRawUrl(prev: Url | string | undefined, raw: string): Url {
  const before = urlObject(prev)
  const parsed = parseUrl(raw)
  const disabled = (before.query ?? []).filter((q) => q.disabled)
  const query = [...(parsed.query ?? []), ...disabled]
  const prevVars = new Map((before.variable ?? []).map((v) => [v.key, v]))
  const variable = (parsed.variable ?? []).map((v) => prevVars.get(v.key) ?? v)
  const out: Url = { ...parsed, raw }
  if (query.length) out.query = query
  else delete out.query
  if (variable.length) out.variable = variable
  else delete out.variable
  return out
}

/** El usuario edita la tabla de params: reconstruye la URL cruda. */
export function setQueryParams(prev: Url | string | undefined, query: QueryParam[]): Url {
  const u = urlObject(prev)
  const raw = u.raw ?? ''
  const hashIdx = raw.indexOf('#')
  const hash = hashIdx === -1 ? '' : raw.slice(hashIdx)
  const noHash = hashIdx === -1 ? raw : raw.slice(0, hashIdx)
  const base = noHash.split('?')[0]
  const enabled = query.filter((q) => !q.disabled && (q.key || q.value))
  const qs = enabled.map((q) => (q.value === null || q.value === undefined ? `${q.key ?? ''}` : `${q.key ?? ''}=${q.value}`)).join('&')
  const newRaw = base + (qs ? `?${qs}` : '') + hash
  return { ...parseUrl(newRaw), raw: newRaw, query, variable: u.variable }
}

export function contentTypeOf(req: Request): string | undefined {
  return req.header?.find((h) => !h.disabled && h.key.toLowerCase() === 'content-type')?.value
}

export function languageForContentType(ct?: string): string {
  if (!ct) return 'plaintext'
  if (/json/i.test(ct)) return 'json'
  if (/xml/i.test(ct)) return 'xml'
  if (/html/i.test(ct)) return 'html'
  if (/javascript/i.test(ct)) return 'javascript'
  if (/css/i.test(ct)) return 'css'
  if (/yaml/i.test(ct)) return 'yaml'
  return 'plaintext'
}

export function prettyBody(body: string, language: string): string {
  if (language === 'json') {
    try {
      return JSON.stringify(JSON.parse(body), null, 2)
    } catch {
      return body
    }
  }
  if (language === 'xml' || language === 'html') return formatXml(body)
  return body
}

function formatXml(xml: string): string {
  if (xml.length > 500_000 || xml.includes('\n  ')) return xml
  let pad = 0
  return xml
    .replace(/>\s*</g, '>\n<')
    .split('\n')
    .map((line) => {
      if (/^<\/\w/.test(line)) pad = Math.max(0, pad - 1)
      const out = '  '.repeat(pad) + line
      if (/^<\w[^>]*[^/]>.*$/.test(line) && !/<\/\w+>$/.test(line) && !/^<(br|hr|img|input|meta|link)\b/i.test(line)) pad++
      return out
    })
    .join('\n')
}

/** Petición vacía por defecto para "Nueva petición". */
export function emptyRequest(): Request {
  return { method: 'GET', url: { raw: '' }, header: [] }
}
