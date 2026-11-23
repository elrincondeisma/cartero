import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgres://cartero:cartero@localhost:5433/cartero_test'
process.env.LOG_LEVEL = 'silent'

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../packages/importers/fixtures/${name}`, import.meta.url), 'utf8'))

/** API de Postman de mentira: dos workspaces, una colección, un entorno y globales. */
const KEY = 'PMAK-test-0123456789'
let collectionName = 'Colección de Postman'
let calls: string[] = []
let rateLimited = false
function fakePostman(): Promise<Server> {
  const routes: Record<string, () => unknown> = {
    '/me': () => ({
      user: { id: 1, username: 'ana', fullName: 'Ana Postman', avatar: null, teamName: null },
      operations: [{ name: 'api_usage', limit: 1000, usage: 12, overage: 0 }],
    }),
    '/workspaces': () => ({
      workspaces: [
        { id: 'w1', name: 'Mi workspace', type: 'personal', visibility: 'personal' },
        { id: 'w2', name: 'Equipo', type: 'team', visibility: 'team' },
      ],
    }),
    '/workspaces/w1': () => ({
      workspace: {
        id: 'w1',
        name: 'Mi workspace',
        type: 'personal',
        collections: [{ id: 'c1', uid: '1-c1', name: 'API' }],
        environments: [{ id: 'e1', uid: '1-e1', name: 'Producción' }],
        mocks: [{ id: 'm1', uid: '1-m1', name: 'Mock' }],
      },
    }),
    '/collections/1-c1': () => {
      const c = fixture('postman-v21.json')
      c.info.name = collectionName
      return { collection: c }
    },
    '/collections/1-nul': () => ({
      collection: {
        info: {
          name: 'Binaria',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [
          {
            name: 'Descarga\u0000',
            request: { method: 'GET', url: 'https://example.com/doc' },
            response: [{ name: 'docx', code: 200, body: 'PK\u0003\u0004\u0000\u0000binario' }],
          },
        ],
      },
    }),
    '/environments/1-e1': () => ({
      environment: {
        id: 'e1',
        name: 'Producción',
        values: [
          { key: 'baseUrl', value: 'https://api.example.com', enabled: true, type: 'default' },
          { key: 'token', value: '', enabled: true, type: 'secret' },
        ],
      },
    }),
    '/workspaces/w1/global-variables': () => ({
      values: [{ key: 'region', value: 'eu', enabled: true, type: 'default' }],
    }),
  }
  const server = createServer((req, res) => {
    calls.push(req.url ?? '')
    if (req.headers['x-api-key'] !== KEY) {
      res.writeHead(401, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: { name: 'AuthenticationError', message: 'Invalid API Key.' } }))
    }
    if (rateLimited && req.url?.startsWith('/collections')) {
      rateLimited = false
      res.writeHead(429, { 'retry-after': '1', 'content-type': 'application/json' })
      return res.end('{}')
    }
    const route = routes[req.url ?? '']
    res.writeHead(route ? 200 : 404, { 'content-type': 'application/json' })
    res.end(JSON.stringify(route ? route() : { error: { message: 'not found' } }))
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)))
}

let pm: Server
const { buildApp } = await import('./app.js')
const { runMigrations } = await import('./db/migrate.js')
const { sqlClient } = await import('./db/index.js')
const { clearSettingsCache } = await import('./lib/settings.js')

let app: FastifyInstance
let cookie = ''

async function api(method: string, url: string, body?: unknown) {
  const res = await app.inject({ method: method as any, url, headers: { cookie }, payload: body as any })
  return { status: res.statusCode, body: res.json() as any }
}

async function runImport(body: unknown) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/postman/import',
    headers: { cookie },
    payload: body as any,
  })
  return res.body
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
}

beforeAll(async () => {
  pm = await fakePostman()
  process.env.POSTMAN_API_URL = `http://127.0.0.1:${(pm.address() as AddressInfo).port}`
  await sqlClient.unsafe(
    'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
  )
  await runMigrations()
  clearSettingsCache()
  app = await buildApp({ logger: false })
  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'pm@test.dev', name: 'PM', password: 'password123' },
  })
  cookie = String(reg.headers['set-cookie']).split(';')[0]
})

afterAll(async () => {
  await app?.close()
  await sqlClient.end()
  pm?.close()
})

describe('importar desde la API de Postman', () => {
  it('rechaza una API key incorrecta con un mensaje claro', async () => {
    const r = await api('POST', '/api/postman/connect', { apiKey: 'PMAK-mala-0123456789' })
    expect(r.status).toBe(400)
    expect(r.body.message).toMatch(/no acepta esta API key/)
  })

  it('conecta y lista usuario, cupo y workspaces', async () => {
    const r = await api('POST', '/api/postman/connect', { apiKey: KEY })
    expect(r.status).toBe(200)
    expect(r.body.user.name).toBe('Ana Postman')
    expect(r.body.usage).toEqual({ limit: 1000, usage: 12 })
    expect(r.body.workspaces.map((w: any) => w.name)).toEqual(['Mi workspace', 'Equipo'])
    expect(r.body.targets.length).toBe(1)
  })

  it('enseña el contenido de un workspace', async () => {
    const r = await api('POST', '/api/postman/workspaces/w1', { apiKey: KEY })
    expect(r.body.collections).toEqual([{ uid: '1-c1', name: 'API', imported: null }])
    expect(r.body.environments[0].name).toBe('Producción')
    expect(r.body.mocks).toBe(1)
  })

  let newWs = ''
  let colId = ''
  it('importa a un workspace nuevo, con progreso y aviso de secretos', async () => {
    rateLimited = true // el primer GET de la colección recibe un 429 y se reintenta
    const events = await runImport({
      apiKey: KEY,
      workspaces: [
        {
          postmanId: 'w1',
          name: 'Mi workspace',
          targetId: null,
          newName: 'Desde Postman',
          collections: [{ uid: '1-c1', name: 'API' }],
          environments: [{ uid: '1-e1', name: 'Producción' }],
          globals: true,
        },
      ],
    })
    expect(events[0]).toEqual({ type: 'start', total: 3 })
    const done = events.at(-1)
    expect(done).toMatchObject({ type: 'done', created: 2, updated: 0, failed: 0 })
    expect(events.filter((e) => e.type === 'progress').map((e) => e.done)).toEqual([1, 2, 3])
    expect(events.some((e) => e.type === 'warning' && /1 variable\(s\) secreta/.test(e.message))).toBe(true)
    newWs = events.find((e) => e.kind === 'workspace').workspaceId
    colId = events.find((e) => e.kind === 'collection').id

    const cols = await api('GET', `/api/workspaces/${newWs}/collections`)
    expect(cols.body.map((c: any) => c.name)).toEqual(['Colección de Postman'])
    const envs = await api('GET', `/api/workspaces/${newWs}/environments`)
    expect(envs.body[0].name).toBe('Producción')
    const globals = await api('GET', `/api/workspaces/${newWs}/globals`)
    expect(JSON.stringify(globals.body)).toContain('region')
  })

  it('la segunda vez actualiza en su sitio en lugar de duplicar', async () => {
    const preview = await api('POST', '/api/postman/workspaces/w1', { apiKey: KEY })
    expect(preview.body.collections[0].imported).toEqual({ workspaceId: newWs, id: colId })

    collectionName = 'Colección renombrada'
    const events = await runImport({
      apiKey: KEY,
      workspaces: [
        {
          postmanId: 'w1',
          name: 'Mi workspace',
          targetId: newWs,
          collections: [{ uid: '1-c1', name: 'API' }],
          environments: [{ uid: '1-e1', name: 'Producción' }],
          globals: false,
        },
      ],
    })
    expect(events.at(-1)).toMatchObject({ type: 'done', created: 0, updated: 2, failed: 0 })
    const cols = await api('GET', `/api/workspaces/${newWs}/collections`)
    expect(cols.body.map((c: any) => [c.id, c.name])).toEqual([[colId, 'Colección renombrada']])
    const envs = await api('GET', `/api/workspaces/${newWs}/environments`)
    expect(envs.body.length).toBe(1)
  })

  it('un fallo en un elemento no para el resto', async () => {
    calls = []
    const events = await runImport({
      apiKey: KEY,
      workspaces: [
        {
          postmanId: 'w1',
          name: 'Mi workspace',
          targetId: newWs,
          collections: [{ uid: '1-no-existe', name: 'Borrada' }],
          environments: [{ uid: '1-e1', name: 'Producción' }],
          globals: false,
        },
      ],
    })
    expect(events.find((e) => e.type === 'error')).toMatchObject({ name: 'Borrada' })
    expect(events.at(-1)).toMatchObject({ type: 'done', updated: 1, failed: 1 })
  })

  it('guarda colecciones con respuestas binarias (carácter NUL)', async () => {
    const events = await runImport({
      apiKey: KEY,
      workspaces: [
        {
          postmanId: 'w1',
          name: 'Mi workspace',
          targetId: newWs,
          collections: [{ uid: '1-nul', name: 'Binaria' }],
          environments: [],
          globals: false,
        },
      ],
    })
    expect(events.find((e) => e.type === 'error')).toBeUndefined()
    expect(events.at(-1)).toMatchObject({ type: 'done', created: 1, failed: 0 })
  })

  it('no deja importar a un workspace ajeno', async () => {
    const other = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'otro@test.dev', name: 'Otro', password: 'password123' },
    })
    const otherCookie = String(other.headers['set-cookie']).split(';')[0]
    const res = await app.inject({
      method: 'POST',
      url: '/api/postman/import',
      headers: { cookie: otherCookie },
      payload: {
        apiKey: KEY,
        workspaces: [
          { postmanId: 'w1', name: 'x', targetId: newWs, collections: [], environments: [], globals: true },
        ],
      },
    })
    expect(res.statusCode).toBe(404)
  })
})
