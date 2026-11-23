import { hasContract, sampleFromSchema } from '@cartero/contracts'
import {
  type Collection,
  isFolder,
  type KeyValue,
  type RequestItem,
  type ResponseExample,
  rawUrl,
  resolveVariables,
  type VariableScope,
  walkItems,
} from '@cartero/core'
// Solo el locale inglés: el paquete completo trae todos y pesa varios MB (importa para la app de escritorio)
import { faker } from '@faker-js/faker/locale/en'

export interface MockRequest {
  method: string
  path: string
  query: Record<string, string | string[] | undefined>
  headers: Record<string, string | string[] | undefined>
  body?: string
}

export interface MockMatch {
  item: RequestItem
  example: ResponseExample
  score: number
  /** La respuesta sale del contrato de la petición, no de un ejemplo guardado */
  fromContract?: boolean
}

export interface MockResponse {
  status: number
  headers: KeyValue[]
  body: string
  match?: MockMatch
}

/** Variables dinámicas de Postman ({{$randomEmail}}, {{$guid}}...) generadas con faker. */
const DYNAMIC: Record<string, () => string> = {
  $guid: () => faker.string.uuid(),
  $randomUUID: () => faker.string.uuid(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(faker.number.int({ min: 0, max: 1000 })),
  $randomBoolean: () => String(faker.datatype.boolean()),
  $randomAlphaNumeric: () => faker.string.alphanumeric(1),
  $randomFirstName: () => faker.person.firstName(),
  $randomLastName: () => faker.person.lastName(),
  $randomFullName: () => faker.person.fullName(),
  $randomNamePrefix: () => faker.person.prefix(),
  $randomJobTitle: () => faker.person.jobTitle(),
  $randomEmail: () => faker.internet.email(),
  $randomExampleEmail: () => faker.internet.exampleEmail(),
  $randomUserName: () => faker.internet.username(),
  $randomPassword: () => faker.internet.password(),
  $randomUrl: () => faker.internet.url(),
  $randomDomainName: () => faker.internet.domainName(),
  $randomIP: () => faker.internet.ipv4(),
  $randomIPV6: () => faker.internet.ipv6(),
  $randomMACAddress: () => faker.internet.mac(),
  $randomUserAgent: () => faker.internet.userAgent(),
  $randomPhoneNumber: () => faker.phone.number(),
  $randomCity: () => faker.location.city(),
  $randomCountry: () => faker.location.country(),
  $randomCountryCode: () => faker.location.countryCode(),
  $randomStreetAddress: () => faker.location.streetAddress(),
  $randomStreetName: () => faker.location.street(),
  $randomLatitude: () => String(faker.location.latitude()),
  $randomLongitude: () => String(faker.location.longitude()),
  $randomCompanyName: () => faker.company.name(),
  $randomCatchPhrase: () => faker.company.catchPhrase(),
  $randomProduct: () => faker.commerce.product(),
  $randomProductName: () => faker.commerce.productName(),
  $randomPrice: () => faker.commerce.price(),
  $randomDepartment: () => faker.commerce.department(),
  $randomColor: () => faker.color.human(),
  $randomHexColor: () => faker.color.rgb(),
  $randomCurrencyCode: () => faker.finance.currencyCode(),
  $randomCurrencyName: () => faker.finance.currencyName(),
  $randomBankAccount: () => faker.finance.accountNumber(),
  $randomCreditCardMask: () => faker.finance.creditCardNumber().slice(-4),
  $randomWord: () => faker.lorem.word(),
  $randomWords: () => faker.lorem.words(),
  $randomLoremWord: () => faker.lorem.word(),
  $randomLoremWords: () => faker.lorem.words(),
  $randomLoremSentence: () => faker.lorem.sentence(),
  $randomLoremSentences: () => faker.lorem.sentences(),
  $randomLoremParagraph: () => faker.lorem.paragraph(),
  $randomLoremSlug: () => faker.lorem.slug(),
  $randomLoremText: () => faker.lorem.text(),
  $randomDateFuture: () => faker.date.future().toString(),
  $randomDatePast: () => faker.date.past().toString(),
  $randomDateRecent: () => faker.date.recent().toString(),
  $randomWeekday: () => faker.date.weekday(),
  $randomMonth: () => faker.date.month(),
  $randomFileName: () => faker.system.fileName(),
  $randomFileExt: () => faker.system.fileExt(),
  $randomMimeType: () => faker.system.mimeType(),
  $randomSemver: () => faker.system.semver(),
  $randomAvatarImage: () => faker.image.avatar(),
  $randomImageUrl: () => faker.image.url(),
  $randomAbbreviation: () => faker.hacker.abbreviation(),
  $randomPhrase: () => faker.hacker.phrase(),
  $randomNoun: () => faker.hacker.noun(),
  $randomVerb: () => faker.hacker.verb(),
}

export const DYNAMIC_VARIABLES = Object.keys(DYNAMIC)

export function resolveDynamic(text: string): string {
  return text.replace(/\{\{\s*(\$[A-Za-z0-9]+)\s*\}\}/g, (m, name: string) =>
    DYNAMIC[name] ? DYNAMIC[name]() : m,
  )
}

/** Extrae los segmentos de ruta de una URL de ejemplo, ignorando protocolo, host o variable base. */
export function examplePath(url: string): string[] {
  let u = url.split('#')[0].split('?')[0].trim()
  // Una variable al principio ({{baseUrl}}) hace de host, aunque su valor incluya una ruta
  if (/^\{\{[^}]+\}\}/.test(u))
    return u
      .replace(/^\{\{[^}]+\}\}/, '')
      .split('/')
      .filter(Boolean)
  u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  // Quitar el host (o la variable {{baseUrl}}) hasta la primera "/"
  const slash = u.indexOf('/')
  u = slash === -1 ? '' : u.slice(slash + 1)
  return u.split('/').filter(Boolean)
}

function exampleQuery(url: string): Record<string, string> {
  const q = url.split('#')[0].split('?')[1]
  const out: Record<string, string> = {}
  if (!q) return out
  for (const pair of q.split('&')) {
    const [k, v = ''] = pair.split('=')
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v)
  }
  return out
}

function header(h: MockRequest['headers'], name: string): string | undefined {
  const v = h[name.toLowerCase()]
  return Array.isArray(v) ? v[0] : v
}

/**
 * Elige el ejemplo que mejor encaja con la petición, imitando a los mocks de Postman:
 * método, ruta (con :params y {{vars}} como comodines), query y cabeceras x-mock-*.
 */
/** Puntuación de una URL guardada frente a los segmentos pedidos; undefined si no encaja. */
function scorePath(raw: string, reqSegs: string[], vars: VariableScope[]): number | undefined {
  const exSegs = examplePath(raw).map((seg) => (seg.startsWith(':') ? seg : resolveVariables(seg, vars)))
  if (exSegs.length !== reqSegs.length) return undefined
  let score = 100
  for (let i = 0; i < exSegs.length; i++) {
    const e = exSegs[i]
    if (e === reqSegs[i]) score += 10
    else if (e.startsWith(':') || /^\{\{.+\}\}$/.test(e)) score += 1
    else return undefined
  }
  return score
}

/** Código que responde el mock con un contrato: el pedido con x-mock-response-code o el primer 2xx. */
function contractCode(codes: string[], wanted?: string): string | undefined {
  if (wanted) return codes.find((c) => c === wanted || c.toUpperCase() === `${wanted[0]}XX`) ?? undefined
  const sorted = [...codes].sort()
  return sorted.find((c) => /^2/.test(c)) ?? sorted.find((c) => c !== 'default') ?? sorted[0]
}

/**
 * Busca la petición con contrato que encaja con la llamada. Se usa cuando ningún ejemplo
 * guardado coincide: el mock responde con datos que cumplen el contrato.
 */
export function matchContract(
  collection: Collection,
  req: MockRequest,
  vars: VariableScope[] = [],
): MockMatch | undefined {
  const reqSegs = req.path
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s))
  const wantCode = header(req.headers, 'x-mock-response-code')
  let best: MockMatch | undefined
  for (const { item } of walkItems(collection.item)) {
    if (isFolder(item) || !hasContract(item.contract)) continue
    if ((item.request.method ?? 'GET').toUpperCase() !== req.method.toUpperCase()) continue
    const score = scorePath(rawUrl(item.request.url), reqSegs, vars)
    if (score === undefined) continue
    const code = contractCode(Object.keys(item.contract?.responses ?? {}), wantCode)
    if (!code) continue
    if (!best || score > best.score) {
      const status = /^\d{3}$/.test(code) ? Number(code) : /^\dXX$/i.test(code) ? Number(code[0]) * 100 : 200
      best = { item, example: { name: `Contrato ${code}`, code: status }, score, fromContract: true }
    }
  }
  return best
}

export function matchExample(
  collection: Collection,
  req: MockRequest,
  vars: VariableScope[] = [],
): MockMatch | undefined {
  const reqSegs = req.path
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s))
  const wantName = header(req.headers, 'x-mock-response-name')
  const wantId = header(req.headers, 'x-mock-response-id')
  const wantCode = header(req.headers, 'x-mock-response-code')
  const matchBody = header(req.headers, 'x-mock-match-request-body') === 'true'
  const matchHeaders = header(req.headers, 'x-mock-match-request-headers')

  let best: MockMatch | undefined
  for (const { item } of walkItems(collection.item)) {
    if (isFolder(item)) continue
    for (const example of item.response ?? []) {
      if (wantName && example.name !== wantName) continue
      if (wantId && example.id !== wantId) continue
      if (wantCode && String(example.code) !== wantCode) continue

      const original = example.originalRequest ?? item.request
      const method = (original?.method ?? item.request.method ?? 'GET').toUpperCase()
      if (method !== req.method.toUpperCase()) continue

      const raw = rawUrl(original?.url ?? item.request.url)
      const url = resolveVariables(raw, vars)
      const pathScore = scorePath(raw, reqSegs, vars)
      if (pathScore === undefined) continue
      let score = pathScore
      let ok = true

      const exQuery = exampleQuery(url)
      for (const [k, v] of Object.entries(exQuery)) {
        const actual = req.query[k]
        const a = Array.isArray(actual) ? actual[0] : actual
        if (a === v) score += 5
        else if (a !== undefined) score += 1
        else score -= 2
      }

      if (matchHeaders) {
        for (const name of matchHeaders.split(',').map((s) => s.trim().toLowerCase())) {
          const exH = (original?.header ?? []).find((h) => h.key.toLowerCase() === name)
          if (!exH || exH.value !== header(req.headers, name)) ok = false
        }
        if (!ok) continue
      }

      if (matchBody) {
        const exBody = original?.body?.raw ?? ''
        if (normalizeBody(exBody) !== normalizeBody(req.body ?? '')) continue
        score += 20
      }

      // A igualdad, preferir respuestas 2xx (como Postman)
      if (example.code && example.code >= 200 && example.code < 300) score += 1

      if (!best || score > best.score) best = { item, example, score }
    }
  }
  return best
}

function normalizeBody(b: string) {
  try {
    return JSON.stringify(JSON.parse(b))
  } catch {
    return b.trim()
  }
}

export function mockResponse(
  collection: Collection,
  req: MockRequest,
  vars: VariableScope[] = [],
): MockResponse {
  const match = matchExample(collection, req, vars)
  if (!match) {
    const byContract = matchContract(collection, req, vars)
    if (byContract) {
      const code = Object.keys(byContract.item.contract?.responses ?? {}).find(
        (c) => byContract.example.name === `Contrato ${c}`,
      )
      const spec = code ? byContract.item.contract?.responses[code] : undefined
      const headers: KeyValue[] = [{ key: 'Content-Type', value: 'application/json' }]
      for (const h of spec?.headers ?? []) {
        if (h.name.toLowerCase() === 'content-type') continue
        const v = sampleFromSchema(h.schema ?? { type: 'string' }, h.name)
        headers.push({ key: h.name, value: typeof v === 'string' ? v : JSON.stringify(v) })
      }
      const body = spec?.body ? JSON.stringify(sampleFromSchema(spec.body), null, 2) : ''
      return { status: byContract.example.code ?? 200, headers, body, match: byContract }
    }
    return {
      status: 404,
      headers: [{ key: 'Content-Type', value: 'application/json' }],
      body: JSON.stringify({
        error: 'mockRequestNotFoundError',
        message: `Ningún ejemplo guardado coincide con ${req.method.toUpperCase()} ${req.path}. Guarda un ejemplo o un contrato en la petición para que el mock responda.`,
      }),
    }
  }
  const { example } = match
  const headers = (example.header ?? []).filter(
    (h) =>
      !['content-length', 'transfer-encoding', 'content-encoding', 'connection'].includes(
        h.key.toLowerCase(),
      ),
  )
  const body = resolveDynamic(resolveVariables(example.body ?? '', vars))
  return { status: example.code ?? 200, headers, body, match }
}
