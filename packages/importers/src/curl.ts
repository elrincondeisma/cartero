import { parse } from 'shell-quote'
import { type Body, type Collection, type KeyValue, POSTMAN_SCHEMA_V21, type Request, ensureIds, parseUrl } from '@cartero/core'

export function isCurl(text: string): boolean {
  return /^\s*curl(\.exe)?\s/i.test(text)
}

function tokenize(cmd: string): string[] {
  const cleaned = cmd
    .replace(/\\\r?\n/g, ' ') // continuaciones de línea de bash
    .replace(/\^\r?\n/g, ' ') // continuaciones de cmd.exe
    .replace(/`\r?\n/g, ' ') // continuaciones de PowerShell
    .trim()
  return parse(cleaned, (key) => `$${key}`).map((t) => {
    if (typeof t === 'string') return t
    if ('op' in t && t.op === 'glob') return (t as any).pattern
    if ('op' in t) return t.op
    return String(t)
  })
}

const NO_VALUE_FLAGS = new Set([
  '-G', '--get', '-I', '--head', '-k', '--insecure', '-L', '--location', '-s', '--silent', '-S', '--show-error',
  '-v', '--verbose', '-i', '--include', '--compressed', '-f', '--fail', '-#', '--progress-bar', '--http1.1',
  '--http2', '--globoff', '-g', '-N', '--no-buffer',
])

/** Convierte un comando cURL en una colección con una sola petición. */
export function importCurl(text: string): Collection {
  const tokens = tokenize(text)
  if (!/^curl(\.exe)?$/i.test(tokens[0] ?? '')) throw new Error('No es un comando cURL')

  let method: string | undefined
  let url = ''
  const headers: KeyValue[] = []
  const data: string[] = []
  const urlencoded: string[] = []
  const form: { key: string; value: string; file: boolean }[] = []
  let user: string | undefined
  let get = false
  let head = false
  let json = false

  for (let i = 1; i < tokens.length; i++) {
    let tok = tokens[i]
    let val: string | undefined
    const eq = tok.startsWith('--') ? tok.indexOf('=') : -1
    if (eq > 0) {
      val = tok.slice(eq + 1)
      tok = tok.slice(0, eq)
    }
    const next = () => val ?? tokens[++i] ?? ''

    // flags cortas pegadas: -XPOST, -HAccept:x
    if (/^-[XHdFuAbe][^-]/.test(tok) && tok.length > 2 && val === undefined) {
      val = tok.slice(2)
      tok = tok.slice(0, 2)
    }

    switch (tok) {
      case '-X':
      case '--request':
        method = next().toUpperCase()
        break
      case '-H':
      case '--header': {
        const h = next()
        const c = h.indexOf(':')
        if (c > 0) headers.push({ key: h.slice(0, c).trim(), value: h.slice(c + 1).trim() })
        break
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
        data.push(next())
        break
      case '--json':
        data.push(next())
        json = true
        break
      case '--data-urlencode':
        urlencoded.push(next())
        break
      case '-F':
      case '--form':
      case '--form-string': {
        const f = next()
        const e = f.indexOf('=')
        const key = f.slice(0, e)
        let value = f.slice(e + 1)
        const isFile = tok !== '--form-string' && value.startsWith('@')
        if (isFile) value = value.slice(1).split(';')[0]
        form.push({ key, value, file: isFile })
        break
      }
      case '-u':
      case '--user':
        user = next()
        break
      case '-A':
      case '--user-agent':
        headers.push({ key: 'User-Agent', value: next() })
        break
      case '-e':
      case '--referer':
        headers.push({ key: 'Referer', value: next() })
        break
      case '-b':
      case '--cookie':
        headers.push({ key: 'Cookie', value: next() })
        break
      case '--url':
        url = next()
        break
      case '-G':
      case '--get':
        get = true
        break
      case '-I':
      case '--head':
        head = true
        break
      default:
        if (tok.startsWith('-')) {
          if (!NO_VALUE_FLAGS.has(tok) && val === undefined && tok.startsWith('--') === false && tok.length === 2) {
            // flag corta desconocida con valor: la saltamos
            i++
          } else if (!NO_VALUE_FLAGS.has(tok) && val === undefined && /^--(max-time|connect-timeout|retry|output|proxy|cert|key|cacert|resolve|interface|limit-rate|write-out|config)$/.test(tok)) {
            i++
          }
        } else if (!url) {
          url = tok
        }
    }
  }

  if (!url) throw new Error('El comando cURL no tiene URL')
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !url.startsWith('{{')) url = `http://${url}`

  if (json) {
    if (!headers.some((h) => h.key.toLowerCase() === 'content-type')) headers.push({ key: 'Content-Type', value: 'application/json' })
    if (!headers.some((h) => h.key.toLowerCase() === 'accept')) headers.push({ key: 'Accept', value: 'application/json' })
  }

  let body: Body | undefined
  if (get && (data.length || urlencoded.length)) {
    const qs = [...data, ...urlencoded].join('&')
    url += (url.includes('?') ? '&' : '?') + qs
  } else if (form.length) {
    body = {
      mode: 'formdata',
      formdata: form.map((f) => (f.file ? { key: f.key, type: 'file' as const, src: f.value } : { key: f.key, value: f.value, type: 'text' as const })),
    }
  } else if (urlencoded.length && !data.length) {
    body = {
      mode: 'urlencoded',
      urlencoded: urlencoded.map((p) => {
        const e = p.indexOf('=')
        return e === -1 ? { key: p, value: '' } : { key: p.slice(0, e), value: decodeURIComponent(p.slice(e + 1)) }
      }),
    }
  } else if (data.length || urlencoded.length) {
    const raw = [...data, ...urlencoded].join('&')
    const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''
    if (!ct || ct.includes('x-www-form-urlencoded')) {
      if (/^[^=&\s{[<]+=/.test(raw) && !ct.includes('json')) {
        body = {
          mode: 'urlencoded',
          urlencoded: raw.split('&').map((p) => {
            const e = p.indexOf('=')
            return e === -1 ? { key: p, value: '' } : { key: p.slice(0, e), value: safeDecode(p.slice(e + 1)) }
          }),
        }
      } else {
        body = { mode: 'raw', raw, options: { raw: { language: looksJson(raw) ? 'json' : 'text' } } }
      }
    } else {
      const language = ct.includes('json') ? 'json' : ct.includes('xml') ? 'xml' : ct.includes('html') ? 'html' : 'text'
      body = { mode: 'raw', raw, options: { raw: { language } } }
    }
  }

  const finalMethod = method ?? (head ? 'HEAD' : body ? 'POST' : 'GET')
  const request: Request = { method: finalMethod, url: parseUrl(url), header: headers }
  if (body) request.body = body
  if (user) {
    const c = user.indexOf(':')
    request.auth = {
      type: 'basic',
      basic: [
        { key: 'username', value: c === -1 ? user : user.slice(0, c), type: 'string' },
        { key: 'password', value: c === -1 ? '' : user.slice(c + 1), type: 'string' },
      ],
    }
  }

  let name = url
  try {
    const u = new URL(url)
    name = `${finalMethod} ${u.pathname}`
  } catch {}

  return ensureIds({
    info: { name: 'Importado desde cURL', schema: POSTMAN_SCHEMA_V21 },
    item: [{ name, request }],
  })
}

function looksJson(s: string) {
  const t = s.trim()
  if (!(t.startsWith('{') || t.startsWith('['))) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}
