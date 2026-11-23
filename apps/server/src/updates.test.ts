import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgres://cartero:cartero@localhost:5433/cartero_test'
process.env.LOG_LEVEL = 'silent'

// ECS simulado: lo que la app pide a AWS en Fargate
const ecsCalls: { name: string; input: any }[] = []
const ecsState = { rolloutState: 'COMPLETED' as string }
vi.mock('@aws-sdk/client-ecs', () => {
  const cmd = (name: string) =>
    class {
      name = name
      constructor(public input: any) {}
    }
  return {
    ECSClient: class {
      async send(c: { name: string; input: any }) {
        ecsCalls.push({ name: c.name, input: c.input })
        if (c.name === 'DescribeTasks') return { tasks: [{ group: 'service:CarteroService' }] }
        if (c.name === 'DescribeServices')
          return {
            services: [
              {
                deployments: [
                  { status: 'PRIMARY', rolloutState: ecsState.rolloutState, updatedAt: new Date() },
                ],
              },
            ],
          }
        return {}
      }
    },
    DescribeTasksCommand: cmd('DescribeTasks'),
    DescribeServicesCommand: cmd('DescribeServices'),
    UpdateServiceCommand: cmd('UpdateService'),
  }
})

const { buildApp } = await import('./app.js')
const { runMigrations } = await import('./db/migrate.js')
const { sqlClient } = await import('./db/index.js')
const { clearSettingsCache, saveSettings } = await import('./lib/settings.js')
const { config } = await import('./config.js')
const updates = await import('./lib/updates.js')

let app: FastifyInstance
let dir: string
let cookie = ''

const RELEASES = [
  { tag_name: 'desktop-v9.0.0', draft: false, prerelease: false, html_url: 'd' },
  { tag_name: 'v0.3.0-rc.1', draft: false, prerelease: true, html_url: 'rc' },
  { tag_name: 'v0.4.0', draft: true, prerelease: false, html_url: 'draft' },
  {
    tag_name: 'v0.2.1',
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/x/releases/v0.2.1',
    published_at: '2026-11-20',
  },
  { tag_name: 'v0.2.0', draft: false, prerelease: false, html_url: 'old' },
]

function fakeGitHub(releases: unknown = RELEASES, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
    const url = String(input)
    if (url === config.releasesUrl) return new Response(JSON.stringify(releases), { status })
    if (url === 'http://metadata/task')
      return new Response(JSON.stringify({ Cluster: 'arn:cluster', TaskARN: 'arn:task' }))
    throw new Error(`fetch inesperado: ${url}`)
  })
}

const req = (method: string, url: string, body?: unknown) =>
  app.inject({ method: method as any, url, headers: cookie ? { cookie } : {}, payload: body as any })

const heartbeat = (ageMs = 0) => {
  const f = path.join(dir, 'heartbeat')
  writeFileSync(f, '')
  const t = (Date.now() - ageMs) / 1000
  utimesSync(f, t, t)
}

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
    payload: { email: 'admin@example.com', name: 'admin', password: 'password123' },
  })
  cookie = String(r.headers['set-cookie']).split(';')[0]
})

beforeEach(() => {
  vi.restoreAllMocks()
  updates.clearUpdateCache()
  dir = mkdtempSync(path.join(tmpdir(), 'cartero-updater-'))
  Object.assign(config, { version: '0.2.0', updater: 'compose', updaterDir: dir, channel: 'stable' })
  ecsCalls.length = 0
  ecsState.rolloutState = 'COMPLETED'
  delete process.env.ECS_CONTAINER_METADATA_URI_V4
})

afterAll(async () => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
  await app?.close()
  await sqlClient.end()
})

describe('versiones publicadas', () => {
  it('se queda con la versión más alta, sin borradores, prereleases ni la app de escritorio', () => {
    expect(updates.pickLatest(RELEASES)).toEqual({
      version: '0.2.1',
      url: 'https://github.com/x/releases/v0.2.1',
      publishedAt: '2026-11-20',
    })
    expect(updates.pickLatest({ message: 'rate limit' })).toBeNull()
  })

  it('compara versiones y no ofrece nada a una versión de desarrollo', () => {
    expect(updates.isNewer('0.10.0', '0.9.9')).toBe(true)
    expect(updates.isNewer('0.2.0', '0.2.0')).toBe(false)
    expect(updates.isNewer('1.0.0', 'dev-abc1234')).toBe(false)
  })

  it('guarda la respuesta en caché y aguanta que GitHub falle', async () => {
    const f = fakeGitHub()
    await updates.latestRelease()
    await updates.latestRelease()
    expect(f).toHaveBeenCalledTimes(1)
    f.mockRestore()
    fakeGitHub([], 500)
    const again = await updates.latestRelease(true)
    expect(again?.release?.version).toBe('0.2.1')
    expect(again?.error).toMatch(/500/)
  })
})

describe('Docker Compose', () => {
  it('con el updater vivo, avisa y deja la petición', async () => {
    fakeGitHub()
    heartbeat()
    const s = await req('GET', '/api/admin/updates')
    expect(s.json()).toMatchObject({
      current: '0.2.0',
      updateAvailable: true,
      blocked: null,
      updater: 'compose',
      state: 'idle',
    })
    expect(s.json().latest.version).toBe('0.2.1')

    const r = await req('POST', '/api/admin/updates/apply')
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(readFileSync(path.join(dir, 'request'), 'utf8')).from).toBe('0.2.0')
    expect(r.json().state).toBe('running')

    // Una segunda petición mientras tanto no se acepta
    expect((await req('POST', '/api/admin/updates/apply')).statusCode).toBe(400)
  })

  it('lee el resultado que escribe el updater', async () => {
    fakeGitHub()
    heartbeat()
    writeFileSync(
      path.join(dir, 'status.json'),
      JSON.stringify({ state: 'failed', message: 'pull falló', at: '2026-11-23T03:00:00Z' }),
    )
    expect((await updates.updateStatus()).state).toBe('failed')
    expect((await updates.updateStatus()).message).toBe('pull falló')
  })

  it('sin updater, con versión fijada o de desarrollo no hay botón', async () => {
    fakeGitHub()
    heartbeat(5 * 60_000)
    expect((await updates.updateStatus()).blocked).toBe('updater-offline')
    heartbeat()
    config.channel = '0.2.0'
    expect((await updates.updateStatus()).blocked).toBe('pinned')
    config.channel = 'stable'
    config.updater = undefined
    expect((await updates.updateStatus()).blocked).toBe('no-updater')
    config.version = '0.2.0-dev'
    expect((await updates.updateStatus()).blocked).toBe('dev')
    expect((await req('POST', '/api/admin/updates/apply')).statusCode).toBe(400)
    expect(existsSync(path.join(dir, 'request'))).toBe(false)
  })

  it('con la última versión no pide nada', async () => {
    fakeGitHub()
    heartbeat()
    config.version = '0.2.1'
    const s = await updates.updateStatus()
    expect(s.updateAvailable).toBe(false)
    await expect(updates.triggerUpdate()).rejects.toThrow(/última versión/)
  })
})

describe('Fargate', () => {
  it('redespliega su propio servicio, que encuentra a partir de su tarea', async () => {
    fakeGitHub()
    config.updater = 'ecs'
    process.env.ECS_CONTAINER_METADATA_URI_V4 = 'http://metadata'
    await updates.triggerUpdate()
    const upd = ecsCalls.find((c) => c.name === 'UpdateService')
    expect(upd?.input).toEqual({
      cluster: 'arn:cluster',
      service: 'CarteroService',
      forceNewDeployment: true,
    })
    expect(ecsCalls.find((c) => c.name === 'DescribeTasks')?.input).toEqual({
      cluster: 'arn:cluster',
      tasks: ['arn:task'],
    })
  })

  it('el estado sale del despliegue principal', async () => {
    fakeGitHub()
    config.updater = 'ecs'
    process.env.ECS_CONTAINER_METADATA_URI_V4 = 'http://metadata'
    ecsState.rolloutState = 'IN_PROGRESS'
    expect((await updates.updateStatus()).state).toBe('running')
    await expect(updates.triggerUpdate()).rejects.toThrow(/en marcha/)
  })
})

describe('ajustes y automática', () => {
  it('solo actualiza sola dentro de la ventana de noche y si está activada', async () => {
    fakeGitHub()
    heartbeat()
    const night = new Date('2026-11-24T03:30:00Z')
    expect(await updates.autoUpdateTick(night)).toBe(false)
    const patch = await req('PATCH', '/api/admin/settings', { updates: { auto: true } })
    expect(patch.json().updates).toEqual({ check: true, auto: true })
    clearSettingsCache()
    expect(await updates.autoUpdateTick(new Date('2026-11-24T12:00:00Z'))).toBe(false)
    expect(await updates.autoUpdateTick(night)).toBe(true)
    expect(existsSync(path.join(dir, 'request'))).toBe(true)
  })

  it('sin buscar actualizaciones no habla con GitHub', async () => {
    const f = fakeGitHub()
    await saveSettings({ updates: { check: false, auto: true } })
    clearSettingsCache()
    const s = await updates.updateStatus({ refresh: true })
    expect(f).not.toHaveBeenCalled()
    expect(s.latest).toBeNull()
    await saveSettings({ updates: { check: true, auto: false } })
    clearSettingsCache()
  })

  it('las rutas son solo para admins', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/admin/updates' })
    expect(r.statusCode).toBe(401)
    const p = await app.inject({ method: 'POST', url: '/api/admin/updates/apply' })
    expect(p.statusCode).toBe(401)
  })
})
