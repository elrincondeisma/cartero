import type { Collection, KeyValue, Variable } from '@cartero/core'

export interface RunOptions {
  collection: Collection
  environment?: Variable[]
  globals?: Variable[]
  /** Id (o nombre) de la carpeta o petición desde la que ejecutar. Sin él se ejecuta toda la colección. */
  entrypoint?: string
  iterationCount?: number
  iterationData?: Record<string, unknown>[]
  /** ms entre peticiones */
  delayRequest?: number
  timeoutRequest?: number
  timeoutScript?: number
  followRedirects?: boolean
  strictSSL?: boolean
  stopOnError?: boolean
  bail?: boolean
  /** Cookie jar serializado (tough-cookie toJSON) */
  cookieJar?: unknown
  /** Ficheros para form-data/binary: src → ruta absoluta en disco */
  fileResolverBaseDir?: string
  /** Hosts o rangos CIDR prohibidos (protección SSRF). Ej: ['10.0.0.0/8', 'localhost'] */
  restrictedAddresses?: string[]
}

/** Rangos privados/reservados habituales para bloquear SSRF en despliegues públicos. */
export const PRIVATE_NETWORKS = [
  'localhost',
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
]

export interface SentRequest {
  method: string
  url: string
  headers: KeyValue[]
  body?: string
}

export interface ResponseData {
  code: number
  status: string
  headers: KeyValue[]
  /** Cuerpo como texto UTF-8 si es textual */
  body?: string
  /** Cuerpo en base64 si es binario */
  bodyBase64?: string
  truncated?: boolean
  size: { body: number; header: number; total: number }
  time: number
  timings?: Record<string, number>
  cookies: { name: string; value: string; domain?: string; path?: string; expires?: string; httpOnly?: boolean; secure?: boolean }[]
  contentType?: string
}

export interface TestResult {
  name: string
  passed: boolean
  skipped: boolean
  error?: string
}

export interface ConsoleEntry {
  level: string
  messages: unknown[]
  itemId?: string
}

export interface Execution {
  id: string
  itemId: string
  name: string
  iteration: number
  request?: SentRequest
  response?: ResponseData
  error?: string
  tests: TestResult[]
  prerequestError?: string
  testScriptError?: string
}

export interface RunStats {
  requests: number
  failedRequests: number
  assertions: number
  failedAssertions: number
  iterations: number
  totalTime: number
}

export interface RunResult {
  executions: Execution[]
  console: ConsoleEntry[]
  stats: RunStats
  environment: Variable[]
  globals: Variable[]
  collectionVariables: Variable[]
  cookieJar: unknown
  startedAt: string
  finishedAt: string
  error?: string
}

export type RunEvent =
  | { type: 'start'; startedAt: string }
  | { type: 'beforeItem'; itemId: string; name: string; iteration: number }
  | { type: 'execution'; execution: Execution }
  | { type: 'console'; entry: ConsoleEntry }
  | { type: 'iteration'; iteration: number }
  | { type: 'done'; result: RunResult }
