#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Collection, Variable } from '@cartero/core'
import { type RunEvent, runCollection } from '@cartero/executor'
import { importAny, importPostmanEnvironment, importPostmanGlobals } from '@cartero/importers'
import { Command, Option } from 'commander'
import Papa from 'papaparse'
import pc from 'picocolors'
import { cliReporter, htmlReport, junitReport } from './reporters.js'

interface RunFlags {
  environment?: string
  globals?: string
  iterationData?: string
  iterationCount?: string
  folder?: string
  delayRequest?: string
  timeoutRequest?: string
  bail?: boolean
  insecure?: boolean
  strictSsl?: boolean
  reporters: string
  reporterJunitExport?: string
  reporterHtmlExport?: string
  reporterJsonExport?: string
  envVar?: string[]
  globalVar?: string[]
  server?: string
  token?: string
  workspace?: string
  report?: boolean
  silent?: boolean
}

function fail(msg: string): never {
  console.error(pc.red(`error: ${msg}`))
  process.exit(2)
}

async function api<T>(server: string, token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${server.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) fail(`${path}: HTTP ${res.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : (undefined as T)
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

async function loadCollection(source: string, f: RunFlags): Promise<{ collection: Collection; remoteId?: string }> {
  if (existsSync(source)) {
    const data = readFileSync(source)
    const r = await importAny(source.endsWith('.zip') ? new Uint8Array(data) : data.toString('utf8'))
    if (!r.collections.length) fail(`${source} no contiene ninguna colección (formato detectado: ${r.format})`)
    if (r.collections.length > 1) console.warn(pc.yellow(`Aviso: ${source} contiene ${r.collections.length} colecciones; se ejecuta la primera.`))
    return { collection: r.collections[0] }
  }
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source)
    if (!res.ok) fail(`No se pudo descargar ${source} (HTTP ${res.status})`)
    const r = await importAny(new Uint8Array(await res.arrayBuffer()))
    return { collection: r.collections[0] }
  }
  if (isUuid(source)) {
    if (!f.server || !f.token) fail('Para ejecutar una colección del servidor usa --server y --token (o CARTERO_SERVER / CARTERO_TOKEN)')
    const exported = await api<any>(f.server, f.token, `/api/collections/${source}/export`)
    const r = await importAny(JSON.stringify(exported))
    return { collection: r.collections[0], remoteId: source }
  }
  fail(`No existe el fichero ${source}`)
}

async function loadEnvironment(ref: string | undefined, f: RunFlags): Promise<Variable[]> {
  if (!ref) return []
  if (existsSync(ref)) {
    const r = await importAny(readFileSync(ref, 'utf8'))
    if (r.environments[0]) return r.environments[0].values
    return importPostmanEnvironment(JSON.parse(readFileSync(ref, 'utf8'))).values
  }
  if (isUuid(ref) && f.server && f.token) {
    const env = await api<any>(f.server, f.token, `/api/environments/${ref}/export`)
    return importPostmanEnvironment(env).values
  }
  fail(`No se encuentra el entorno ${ref}`)
}

async function loadGlobals(ref: string | undefined, f: RunFlags): Promise<Variable[]> {
  if (ref && existsSync(ref)) return importPostmanGlobals(JSON.parse(readFileSync(ref, 'utf8')))
  if (f.workspace && f.server && f.token) return api<Variable[]>(f.server, f.token, `/api/workspaces/${f.workspace}/globals`)
  return []
}

function loadData(path?: string): Record<string, unknown>[] | undefined {
  if (!path) return undefined
  if (!existsSync(path)) fail(`No existe el fichero de datos ${path}`)
  const text = readFileSync(path, 'utf8')
  if (/\.json$/i.test(path) || text.trim().startsWith('[')) {
    const rows = JSON.parse(text)
    if (!Array.isArray(rows)) fail('El fichero de datos JSON debe ser un array de objetos')
    return rows
  }
  const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true })
  // Con una sola columna papaparse no puede detectar el delimitador: no es un error real
  const errors = parsed.errors.filter((e) => e.code !== 'UndetectableDelimiter')
  if (errors.length) fail(`CSV inválido: ${errors[0].message}`)
  return parsed.data
}

function applyOverrides(vars: Variable[], pairs: string[] = []): Variable[] {
  const out = [...vars]
  for (const p of pairs) {
    const i = p.indexOf('=')
    if (i < 1) fail(`Formato inválido "${p}", usa clave=valor`)
    const key = p.slice(0, i)
    const value = p.slice(i + 1)
    const idx = out.findIndex((v) => v.key === key)
    if (idx === -1) out.push({ key, value })
    else out[idx] = { ...out[idx], value, disabled: false }
  }
  return out
}

const collect = (v: string, prev: string[] = []) => [...prev, v]

const program = new Command()
program.name('cartero').description('CLI de Cartero: ejecuta colecciones de Postman, Insomnia u OpenAPI en tu terminal o CI').version('0.1.0')

program
  .command('run')
  .description('Ejecuta una colección (fichero, URL o id de colección en tu servidor Cartero)')
  .argument('<coleccion>', 'Ruta a un fichero (.json/.yaml/.zip), URL, o id de colección del servidor')
  .option('-e, --environment <ruta|id>', 'Entorno (fichero de Postman o id en el servidor)')
  .option('-g, --globals <ruta>', 'Fichero de variables globales')
  .option('-d, --iteration-data <ruta>', 'Datos para iterar (CSV o JSON)')
  .option('-n, --iteration-count <n>', 'Número de iteraciones')
  .option('--folder <nombre|id>', 'Ejecutar solo esta carpeta o petición')
  .option('--delay-request <ms>', 'Pausa entre peticiones (ms)')
  .option('--timeout-request <ms>', 'Tiempo máximo por petición (ms)')
  .option('--bail', 'Parar al primer fallo')
  .option('--strict-ssl', 'Verificar certificados SSL (por defecto no se verifican)')
  .option('--env-var <clave=valor>', 'Sobrescribe una variable de entorno (repetible)', collect)
  .option('--global-var <clave=valor>', 'Sobrescribe una variable global (repetible)', collect)
  .option('-r, --reporters <lista>', 'Reporters: cli, json, junit, html (separados por comas)', 'cli')
  .option('--reporter-junit-export <ruta>', 'Ruta del informe JUnit', 'cartero-junit.xml')
  .option('--reporter-html-export <ruta>', 'Ruta del informe HTML', 'cartero-report.html')
  .option('--reporter-json-export <ruta>', 'Ruta del informe JSON', 'cartero-report.json')
  .addOption(new Option('--server <url>', 'URL de tu servidor Cartero').env('CARTERO_SERVER'))
  .addOption(new Option('--token <token>', 'Token de API (crt_…)').env('CARTERO_TOKEN'))
  .addOption(new Option('--workspace <id>', 'Workspace (para globales y --report)').env('CARTERO_WORKSPACE'))
  .option('--report', 'Sube el resultado al servidor para verlo en «Ejecuciones»')
  .option('--silent', 'Sin salida por consola')
  .action(async (source: string, f: RunFlags) => {
    const { collection, remoteId } = await loadCollection(source, f)
    const environment = applyOverrides(await loadEnvironment(f.environment, f), f.envVar)
    const globals = applyOverrides(await loadGlobals(f.globals, f), f.globalVar)
    const iterationData = loadData(f.iterationData)
    const reporters = f.reporters.split(',').map((s) => s.trim())
    const onEvent = !f.silent && reporters.includes('cli') ? cliReporter(collection.info.name) : (_: RunEvent) => {}

    const result = await runCollection(
      {
        collection,
        environment,
        globals,
        iterationData,
        iterationCount: f.iterationCount ? Number(f.iterationCount) : undefined,
        entrypoint: f.folder,
        delayRequest: f.delayRequest ? Number(f.delayRequest) : undefined,
        timeoutRequest: f.timeoutRequest ? Number(f.timeoutRequest) : undefined,
        bail: f.bail,
        strictSSL: !!f.strictSsl,
        fileResolverBaseDir: process.cwd(),
      },
      onEvent,
    )

    if (reporters.includes('json')) writeFileSync(resolve(f.reporterJsonExport!), JSON.stringify(result, null, 2))
    if (reporters.includes('junit')) writeFileSync(resolve(f.reporterJunitExport!), junitReport(collection.info.name, result))
    if (reporters.includes('html')) writeFileSync(resolve(f.reporterHtmlExport!), htmlReport(collection.info.name, result))
    if (!f.silent) {
      for (const r of ['json', 'junit', 'html'] as const) {
        if (!reporters.includes(r)) continue
        const path = r === 'json' ? f.reporterJsonExport : r === 'junit' ? f.reporterJunitExport : f.reporterHtmlExport
        console.log(pc.dim(`Informe ${r}: ${resolve(path!)}`))
      }
    }

    if (f.report) {
      if (!f.server || !f.token || !f.workspace) fail('--report necesita --server, --token y --workspace')
      const { cookieJar: _, ...clean } = result
      const { runId } = await api<{ runId: string }>(f.server, f.token, `/api/workspaces/${f.workspace}/runs/report`, {
        method: 'POST',
        body: JSON.stringify({ name: collection.info.name, collectionId: remoteId ?? null, result: clean }),
      })
      if (!f.silent) console.log(pc.dim(`Resultado subido: ${f.server.replace(/\/$/, '')}/w/${f.workspace} (run ${runId})`))
    }

    const failed = !!result.error || result.stats.failedAssertions > 0 || result.stats.failedRequests > 0
    process.exit(failed ? 1 : 0)
  })

program.parseAsync().catch((e) => fail(e.message))
