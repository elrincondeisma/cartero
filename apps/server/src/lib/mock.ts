import { faker } from '@faker-js/faker'
import {
  type Collection,
  type KeyValue,
  type RequestItem,
  type ResponseExample,
  type VariableScope,
  isFolder,
  rawUrl,
  resolveVariables,
  walkItems,
} from '@cartero/core'

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
  return text.replace(/\{\{\s*(\$[A-Za-z0-9]+)\s*\}\}/g, (m, name: string) => (DYNAMIC[name] ? DYNAMIC[name]() : m))
}

/** Extrae los segmentos de ruta de una URL de ejemplo, ignorando protocolo, host o variable base. */
export function examplePath(url: string): string[] {
  let u = url.split('#')[0].split('?')[0].trim()
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
export function matchExample(collection: Collection, req: MockRequest, vars: VariableScope[] = []): MockMatch | undefined {
  const reqSegs = req.path.split('/').filter(Boolean).map((s) => decodeURIComponent(s))
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

      const url = resolveVariables(rawUrl(original?.url ?? item.request.url), vars)
      const exSegs = examplePath(url)
      if (exSegs.length !== reqSegs.length) continue

      let score = 100
      let ok = true
      for (let i = 0; i < exSegs.length; i++) {
        const e = exSegs[i]
        if (e === reqSegs[i]) score += 10
        else if (e.startsWith(':') || /^\{\{.+\}\}$/.test(e)) score += 1
        else {
          ok = false
          break
        }
      }
      if (!ok) continue

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

export function mockResponse(collection: Collection, req: MockRequest, vars: VariableScope[] = []): MockResponse {
  const match = matchExample(collection, req, vars)
  if (!match) {
    return {
      status: 404,
      headers: [{ key: 'Content-Type', value: 'application/json' }],
      body: JSON.stringify({
        error: 'mockRequestNotFoundError',
        message: `Ningún ejemplo guardado coincide con ${req.method.toUpperCase()} ${req.path}. Guarda un ejemplo en la petición para que el mock responda.`,
      }),
    }
  }
  const { example } = match
  const headers = (example.header ?? []).filter(
    (h) => !['content-length', 'transfer-encoding', 'content-encoding', 'connection'].includes(h.key.toLowerCase()),
  )
  const body = resolveDynamic(resolveVariables(example.body ?? '', vars))
  return { status: example.code ?? 200, headers, body, match }
}
