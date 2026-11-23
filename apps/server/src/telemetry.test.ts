import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgres://cartero:cartero@localhost:5433/cartero_test'
process.env.LOG_LEVEL = 'silent'

const { buildApp } = await import('./app.js')
const { runMigrations } = await import('./db/migrate.js')
const { db, schema, sqlClient } = await import('./db/index.js')
const { clearSettingsCache, saveSettings } = await import('./lib/settings.js')
const { config } = await import('./config.js')
const telemetry = await import('./lib/telemetry.js')

let app: FastifyInstance
let cookie = ''
let ws = ''

// Valores trampa: nada de esto puede aparecer en el informe
const TRAP = {
  email: 'secreta.persona@empresa-trampa.example',
  name: 'Nombre Trampa Persona',
  url: 'https://api-interna-trampa.example/v1/clientes',
  header: 'X-Cabecera-Trampa',
  secret: 'token-supersecreto-trampa',
}

const req = (method: string, url: string, body?: unknown) =>
  app.inject({ method: method as any, url, headers: cookie ? { cookie } : {}, payload: body as any })

/** Espera a que terminen los contadores (se escriben sin bloquear la respuesta). */
const flush = () => new Promise((r) => setTimeout(r, 150))

beforeAll(async () => {
  await sqlClient.unsafe(
    'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
  )
  await runMigrations()
  clearSettingsCache()
  app = await buildApp({ logger: false })
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: TRAP.email, name: TRAP.name, password: 'password123' },
  })
  cookie = String(r.headers['set-cookie']).split(';')[0]
  ws = (await req('GET', '/api/workspaces')).json()[0].id
  // Una colección importada desde un cURL con URL, cabecera y secreto
  const imp = await req('POST', `/api/workspaces/${ws}/import`, {
    text: `curl -X POST '${TRAP.url}' -H '${TRAP.header}: ${TRAP.secret}' -d '{"cliente":"${TRAP.name}"}'`,
  })
  expect(imp.statusCode).toBe(200)
  await req('POST', '/api/tools/curl', { text: `curl ${TRAP.url}` })
  await flush()
})

beforeEach(async () => {
  vi.restoreAllMocks()
  config.telemetryDisabledByEnv = false
  await saveSettings({ telemetry: { enabled: true } })
  clearSettingsCache()
})

afterAll(async () => {
  vi.restoreAllMocks()
  await app?.close()
  await sqlClient.end()
})

describe('informe', () => {
  it('solo lleva recuentos y datos técnicos: ni emails, ni nombres, ni URLs, ni secretos', async () => {
    const report = await telemetry.buildReport()
    const json = JSON.stringify(report)
    for (const v of Object.values(TRAP)) expect(json).not.toContain(v)
    expect(json).not.toContain('empresa-trampa')
    expect(json).not.toContain('api-interna')
    expect(json).not.toMatch(/@/)
    // Lo que sí cuenta
    expect(report.size).toMatchObject({
      users: 1,
      admins: 1,
      collections: 1,
      savedRequests: 1,
      personalWorkspaces: 1,
    })
    expect(report.usage).toMatchObject({ 'import.curl': 1, 'curl.paste': 1 })
    expect(report.install).toMatchObject({ version: config.version, mode: 'dev' })
    expect(report.instanceId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('el identificador de la instancia es estable', async () => {
    const a = await telemetry.buildReport()
    const b = await telemetry.buildReport()
    expect(a.instanceId).toBe(b.instanceId)
  })

  it('cuenta los errores 5xx por ruta-patrón, sin el mensaje', async () => {
    // Una app aparte para poder añadirle una ruta que falla
    const other = await buildApp({ logger: false })
    other.get('/api/telemetry-test/:id/boom', async () => {
      throw new Error(`fallo con ${TRAP.secret}`)
    })
    const r = await other.inject({ method: 'GET', url: '/api/telemetry-test/123/boom' })
    expect(r.statusCode).toBe(500)
    await other.close()
    await flush()
    const report = await telemetry.buildReport()
    expect(report.errors['GET /api/telemetry-test/:id/boom 500']).toBe(1)
    expect(JSON.stringify(report)).not.toContain(TRAP.secret)
  })

  it('rechaza claves de contador con texto arbitrario', async () => {
    telemetry.countEvent(`import.${TRAP.email}`)
    telemetry.countEvent('x'.repeat(500))
    await flush()
    const json = JSON.stringify(await telemetry.buildReport())
    expect(json).not.toContain(TRAP.email)
    expect(json).not.toContain('x'.repeat(200))
  })

  it('normaliza el formato de importación', () => {
    expect(telemetry.importKey('openapi-3.1.0')).toBe('import.openapi-3')
    expect(telemetry.importKey('postman-collection')).toBe('import.postman-collection')
  })
})

describe('envío', () => {
  it('envía una vez al día, guarda el informe y vacía los contadores', async () => {
    const sent: any[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
      expect(String(url)).toBe(config.telemetryUrl)
      sent.push(JSON.parse(String(init?.body)))
      return new Response('{}', { status: 202 })
    })
    const t0 = new Date('2026-11-24T10:00:00Z')
    expect(await telemetry.sendReport({ now: t0, force: true })).toEqual({ sent: true })
    expect(sent).toHaveLength(1)
    // Al rato no toca
    expect(await telemetry.sendReport({ now: new Date('2026-11-24T16:00:00Z') })).toMatchObject({
      sent: false,
      reason: 'not-due',
    })
    // Al día siguiente sí, y los contadores ya enviados no se repiten
    expect(await telemetry.sendReport({ now: new Date('2026-11-25T10:01:00Z') })).toEqual({ sent: true })
    expect(sent[1].usage['import.curl']).toBeUndefined()
    const counters = await db.select().from(schema.telemetryCounters)
    expect(counters).toHaveLength(0)
    const status = await telemetry.telemetryStatus()
    expect(status.lastReport?.sentAt).toBe('2026-11-25T10:01:00.000Z')
  })

  it('si el colector falla, no marca el informe como enviado', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 500 }))
    expect(await telemetry.sendReport({ force: true })).toEqual({ sent: false, reason: 'http-500' })
  })

  it('apagada en el panel o por variable de entorno, no envía nada', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
    await saveSettings({ telemetry: { enabled: false } })
    clearSettingsCache()
    expect(await telemetry.sendReport({ force: true })).toEqual({ sent: false, reason: 'disabled' })
    await saveSettings({ telemetry: { enabled: true } })
    clearSettingsCache()
    config.telemetryDisabledByEnv = true
    expect(await telemetry.sendReport({ force: true })).toEqual({ sent: false, reason: 'disabled' })
    expect(f).not.toHaveBeenCalled()
  })
})

describe('Administración', () => {
  it('enseña el estado y el informe, y deja apagarla', async () => {
    const r = await req('GET', '/api/admin/telemetry')
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ enabled: true, disabledByEnv: false })
    expect(r.json().preview.size.users).toBe(1)
    const p = await req('PATCH', '/api/admin/settings', { telemetry: { enabled: false } })
    expect(p.json().telemetry).toEqual({ enabled: false, disabledByEnv: false })
    expect((await app.inject({ method: 'GET', url: '/api/admin/telemetry' })).statusCode).toBe(401)
  })
})
