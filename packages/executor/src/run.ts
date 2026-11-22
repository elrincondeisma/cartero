import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { KeyValue, Variable } from '@cartero/core'
import sdk from 'postman-collection'
import runtime from 'postman-runtime'
import { CookieJar } from 'tough-cookie'
import type { ConsoleEntry, Execution, ResponseData, RunEvent, RunOptions, RunResult, SentRequest } from './types.js'

const MAX_BODY = 20 * 1024 * 1024

const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|ld\+json|problem\+json|problem\+xml|hal\+json|vnd\.[^;]*\+(json|xml)|x-ndjson|yaml|x-yaml|soap\+xml|xhtml\+xml)|image\/svg\+xml)/i

function headersOf(list: any): KeyValue[] {
  const out: KeyValue[] = []
  list?.each?.((h: any) => {
    if (!h.disabled) out.push({ key: h.key, value: h.value })
  })
  return out
}

function varsOf(scope: any): Variable[] {
  if (!scope?.values) return []
  const out: Variable[] = []
  scope.values.each((v: any) => {
    const item: Variable = { key: v.key, value: v.value == null ? '' : typeof v.value === 'string' ? v.value : JSON.stringify(v.value) }
    if (v.type && v.type !== 'any' && v.type !== 'default') item.type = v.type
    if (v.disabled) item.disabled = true
    out.push(item)
  })
  return out
}

function sentRequest(req: any): SentRequest | undefined {
  if (!req) return undefined
  const out: SentRequest = { method: req.method, url: req.url.toString(), headers: headersOf(req.headers) }
  const body = req.body
  if (body && !body.isEmpty?.()) {
    switch (body.mode) {
      case 'raw':
        out.body = typeof body.raw === 'string' ? body.raw : String(body.raw ?? '')
        break
      case 'urlencoded':
        out.body = body.urlencoded
          .all()
          .filter((p: any) => !p.disabled)
          .map((p: any) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value ?? '')}`)
          .join('&')
        break
      case 'formdata':
        out.body = body.formdata
          .all()
          .filter((p: any) => !p.disabled)
          .map((p: any) => `${p.key}: ${p.type === 'file' ? `<fichero ${p.src}>` : p.value}`)
          .join('\n')
        break
      case 'graphql':
        out.body = JSON.stringify(body.graphql)
        break
      case 'file':
        out.body = `<fichero ${body.file?.src ?? ''}>`
        break
    }
  }
  return out
}

function responseData(res: any, request: any): ResponseData | undefined {
  if (!res) return undefined
  const headers = headersOf(res.headers)
  const contentType = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value
  const buf: Buffer = res.stream ?? Buffer.alloc(0)
  const truncated = buf.length > MAX_BODY
  const slice = truncated ? buf.subarray(0, MAX_BODY) : buf
  const isText = !contentType || TEXT_TYPES.test(contentType)
  const size = res.size?.() ?? { body: buf.length, header: 0, total: buf.length }
  const out: ResponseData = {
    code: res.code,
    status: res.status ?? res.reason?.() ?? '',
    headers,
    size: { body: size.body ?? buf.length, header: size.header ?? 0, total: size.total ?? buf.length },
    time: res.responseTime ?? 0,
    cookies: [],
    contentType,
  }
  if (isText) out.body = slice.toString('utf8')
  else out.bodyBase64 = slice.toString('base64')
  if (truncated) out.truncated = true
  if (res.timings) {
    try {
      out.timings = sdk.Response.timingPhases(res.timings) as Record<string, number>
    } catch {}
  }
  res.cookies?.each?.((c: any) =>
    out.cookies.push({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires ? new Date(c.expires).toISOString() : undefined,
      httpOnly: c.httpOnly,
      secure: c.secure,
    }),
  )
  void request
  return out
}

function errMsg(e: any): string | undefined {
  if (!e) return undefined
  return e.message ?? String(e)
}

/**
 * Ejecuta una colección (o parte) con postman-runtime y emite eventos serializables.
 * Corre en el mismo proceso: para aislar scripts de usuario, usar runIsolated().
 */
export function runCollection(opts: RunOptions, onEvent: (e: RunEvent) => void = () => {}, signal?: AbortSignal): Promise<RunResult> {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const collection = new sdk.Collection(opts.collection as any)
  const jar = opts.cookieJar ? CookieJar.fromJSON(opts.cookieJar as any) : new CookieJar()

  const executions: Execution[] = []
  const consoleEntries: ConsoleEntry[] = []
  const current = new Map<string, Execution>()
  const keyOf = (cursor: any) => `${cursor.iteration}:${cursor.ref}`

  return new Promise((resolve) => {
    const runner = new runtime.Runner()
    const runOpts: any = {
      iterationCount: opts.iterationCount ?? (opts.iterationData?.length || 1),
      data: opts.iterationData,
      environment: new sdk.VariableScope({ values: (opts.environment ?? []) as any }),
      globals: new sdk.VariableScope({ values: (opts.globals ?? []) as any }),
      timeout: { request: opts.timeoutRequest ?? 0, script: opts.timeoutScript ?? 0 },
      delay: { item: opts.delayRequest ?? 0 },
      stopOnError: opts.stopOnError ?? false,
      abortOnFailure: opts.bail ?? false,
      requester: {
        followRedirects: opts.followRedirects ?? true,
        strictSSL: opts.strictSSL ?? false,
        cookieJar: jar,
        timings: true,
        verbose: true,
      },
      fileResolver: opts.fileResolverBaseDir ? fileResolver(opts.fileResolverBaseDir) : undefined,
      script: { serializeLogs: false },
    }
    if (opts.entrypoint) runOpts.entrypoint = { execute: opts.entrypoint, lookupStrategy: 'idOrName' }

    runner.run(collection, runOpts, (err: any, run: any) => {
      if (err) {
        return resolve(emptyResult(startedAt, errMsg(err), jar))
      }
      const abort = () => run.abort()
      signal?.addEventListener('abort', abort, { once: true })

      onEvent({ type: 'start', startedAt })
      run.start({
        iteration(_e: any, cursor: any) {
          onEvent({ type: 'iteration', iteration: cursor.iteration })
        },
        beforeItem(_e: any, cursor: any, item: any) {
          const ex: Execution = { id: randomUUID(), itemId: item.id, name: item.name, iteration: cursor.iteration, tests: [] }
          current.set(keyOf(cursor), ex)
          onEvent({ type: 'beforeItem', itemId: item.id, name: item.name, iteration: cursor.iteration })
        },
        prerequest(_e: any, cursor: any, results: any[]) {
          const ex = current.get(keyOf(cursor))
          const failed = results?.find((r) => r.error)
          if (ex && failed) ex.prerequestError = errMsg(failed.error)
        },
        request(e: any, cursor: any, response: any, request: any, _item: any, cookies: any[], history: any) {
          const ex = current.get(keyOf(cursor))
          if (!ex) return
          ex.request = sentRequest(request)
          ex.response = responseData(response, request)
          if (ex.response) {
            const data = history?.execution?.data
            const timings = Array.isArray(data) ? data.at(-1)?.timings : undefined
            if (timings?.offset) {
              try {
                ex.response.timings = sdk.Response.timingPhases(timings) as Record<string, number>
              } catch {}
            }
            const host = request?.url?.getHost?.()
            ex.response.cookies = (cookies ?? [])
              .filter((c: any) => !host || !c.domain || host.endsWith(String(c.domain).replace(/^\./, '')))
              .map((c: any) => ({
                name: c.name ?? c.key,
                value: c.value,
                domain: c.domain,
                path: c.path,
                expires: c.expires ? new Date(c.expires).toISOString() : undefined,
                httpOnly: c.httpOnly,
                secure: c.secure,
              }))
          }
          if (e) ex.error = errMsg(e)
        },
        assertion(cursor: any, assertions: any[]) {
          const ex = current.get(keyOf(cursor))
          if (!ex) return
          for (const a of assertions ?? []) {
            ex.tests.push({ name: a.name, passed: !!a.passed, skipped: !!a.skipped, error: a.error ? errMsg(a.error) : undefined })
          }
        },
        test(_e: any, cursor: any, results: any[]) {
          const ex = current.get(keyOf(cursor))
          const failed = results?.find((r) => r.error)
          if (ex && failed) ex.testScriptError = errMsg(failed.error)
        },
        item(_e: any, cursor: any) {
          const key = keyOf(cursor)
          const ex = current.get(key)
          if (!ex) return
          current.delete(key)
          executions.push(ex)
          onEvent({ type: 'execution', execution: ex })
        },
        console(cursor: any, level: string, ...messages: unknown[]) {
          const entry: ConsoleEntry = { level, messages: messages.map(safe), itemId: current.get(keyOf(cursor))?.itemId }
          consoleEntries.push(entry)
          onEvent({ type: 'console', entry })
        },
        exception(_cursor: any, e: any) {
          consoleEntries.push({ level: 'error', messages: [errMsg(e)] })
        },
        done(e: any) {
          signal?.removeEventListener('abort', abort)
          const tests = executions.flatMap((x) => x.tests)
          const result: RunResult = {
            executions,
            console: consoleEntries,
            stats: {
              requests: executions.length,
              failedRequests: executions.filter((x) => x.error).length,
              assertions: tests.length,
              failedAssertions: tests.filter((t) => !t.passed && !t.skipped).length,
              iterations: runOpts.iterationCount,
              totalTime: Date.now() - t0,
            },
            environment: varsOf(run.state?.environment),
            globals: varsOf(run.state?.globals),
            collectionVariables: varsOf(run.state?.collectionVariables),
            cookieJar: jar.toJSON(),
            startedAt,
            finishedAt: new Date().toISOString(),
            error: errMsg(e),
          }
          onEvent({ type: 'done', result })
          resolve(result)
        },
      })
    })
  })
}

function emptyResult(startedAt: string, error: string | undefined, jar: CookieJar): RunResult {
  return {
    executions: [],
    console: [],
    stats: { requests: 0, failedRequests: 0, assertions: 0, failedAssertions: 0, iterations: 0, totalTime: 0 },
    environment: [],
    globals: [],
    collectionVariables: [],
    cookieJar: jar.toJSON(),
    startedAt,
    finishedAt: new Date().toISOString(),
    error,
  }
}

function safe(v: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)))
  } catch {
    return String(v)
  }
}

function fileResolver(baseDir: string) {
  const resolveSafe = (p: string) => {
    const full = path.resolve(baseDir, p.replace(/^\/+/, ''))
    if (!full.startsWith(path.resolve(baseDir))) throw new Error('Ruta de fichero no permitida')
    return full
  }
  return {
    stat: (p: string, cb: any) => fs.stat(resolveSafe(p), cb),
    createReadStream: (p: string) => fs.createReadStream(resolveSafe(p)),
  }
}
