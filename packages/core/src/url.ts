import type { QueryParam, Url } from './types.js'

/** Parsea una URL cruda (con posibles {{variables}}) al formato estructurado de Postman. */
export function parseUrl(raw: string): Url {
  const url: Url = { raw }
  let rest = raw.trim()

  const hashIdx = rest.indexOf('#')
  if (hashIdx !== -1) {
    url.hash = rest.slice(hashIdx + 1)
    rest = rest.slice(0, hashIdx)
  }

  const qIdx = rest.indexOf('?')
  let queryString: string | undefined
  if (qIdx !== -1) {
    queryString = rest.slice(qIdx + 1)
    rest = rest.slice(0, qIdx)
  }

  const protoMatch = rest.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//)
  if (protoMatch) {
    url.protocol = protoMatch[1]
    rest = rest.slice(protoMatch[0].length)
  }

  // host[:port] hasta la primera '/' que no esté dentro de {{ }}
  let slashIdx = -1
  let depth = 0
  for (let i = 0; i < rest.length; i++) {
    if (rest.startsWith('{{', i)) {
      depth++
      i++
    } else if (rest.startsWith('}}', i)) {
      depth = Math.max(0, depth - 1)
      i++
    } else if (rest[i] === '/' && depth === 0) {
      slashIdx = i
      break
    }
  }
  let hostPart = slashIdx === -1 ? rest : rest.slice(0, slashIdx)
  const pathPart = slashIdx === -1 ? '' : rest.slice(slashIdx + 1)

  const portMatch = hostPart.match(/:(\d+|\{\{[^}]+\}\})$/)
  if (portMatch && !hostPart.startsWith('[')) {
    url.port = portMatch[1]
    hostPart = hostPart.slice(0, -portMatch[0].length)
  }
  if (hostPart) url.host = hostPart.split('.')
  if (slashIdx !== -1) url.path = pathPart.split('/')

  if (queryString !== undefined) url.query = parseQuery(queryString)

  const vars = (url.path ?? []).filter((s) => s.startsWith(':') && s.length > 1).map((s) => s.slice(1))
  if (vars.length) url.variable = vars.map((key) => ({ key, value: '' }))
  return url
}

export function parseQuery(qs: string): QueryParam[] {
  if (!qs) return []
  return qs.split('&').map((pair) => {
    const eq = pair.indexOf('=')
    if (eq === -1) return { key: pair, value: null }
    return { key: pair.slice(0, eq), value: pair.slice(eq + 1) }
  })
}

/** Reconstruye la URL cruda a partir de su forma estructurada. */
export function urlToString(url: Url | string): string {
  if (typeof url === 'string') return url
  if (url.raw && !url.host && !url.path) return url.raw
  let out = ''
  if (url.protocol) out += `${url.protocol}://`
  if (url.host) out += url.host.join('.')
  if (url.port) out += `:${url.port}`
  if (url.path) out += `/${url.path.join('/')}`
  const q = (url.query ?? []).filter((p) => !p.disabled)
  if (q.length) out += `?${q.map((p) => (p.value === null ? `${p.key}` : `${p.key}=${p.value}`)).join('&')}`
  if (url.hash) out += `#${url.hash}`
  return out || url.raw
}

/** Devuelve la URL cruda de una petición, venga como string o como objeto. */
export function rawUrl(url: Url | string | undefined): string {
  if (!url) return ''
  if (typeof url === 'string') return url
  return url.raw ?? urlToString(url)
}
