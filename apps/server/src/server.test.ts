import { readFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgres://cartero:cartero@localhost:5433/cartero_test'
process.env.LOG_LEVEL = 'silent'

const { buildApp } = await import('./app.js')
const { runMigrations } = await import('./db/migrate.js')
const { sqlClient } = await import('./db/index.js')

let app: FastifyInstance
let target: http.Server
let targetUrl = ''

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '..', '..', '..', 'packages', 'importers', 'fixtures', name), 'utf8')

class Client {
  cookie = ''
  constructor(public app: FastifyInstance) {}
  async req(method: string, url: string, body?: unknown) {
    const res = await this.app.inject({
      method: method as any,
      url,
      headers: this.cookie ? { cookie: this.cookie } : {},
      payload: body as any,
    })
    const set = res.headers['set-cookie']
    if (set) this.cookie = (Array.isArray(set) ? set[0] : set).split(';')[0]
    const json = res.body ? safeJson(res.body) : undefined
    return { status: res.statusCode, body: json as any, headers: res.headers }
  }
}

function safeJson(s: string) {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

let alice: Client
let bob: Client
let ws = ''

beforeAll(async () => {
  await sqlClient.unsafe('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;')
  await runMigrations()
  app = await buildApp({ logger: false })
  target = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, body }))
    })
  })
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', () => r()))
  targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`
  alice = new Client(app)
  bob = new Client(app)
})

afterAll(async () => {
  await app?.close()
  target?.close()
  await sqlClient.end()
})

describe('auth y workspaces', () => {
  it('registra, crea workspace personal y hace login', async () => {
    const r = await alice.req('POST', '/api/auth/register', { email: 'alice@test.dev', name: 'Alice', password: 'password123' })
    expect(r.status).toBe(200)
    const me = await alice.req('GET', '/api/auth/me')
    expect(me.body.email).toBe('alice@test.dev')
    const list = await alice.req('GET', '/api/workspaces')
    expect(list.body).toHaveLength(1)
    expect(list.body[0]).toMatchObject({ type: 'personal', role: 'owner' })
    const team = await alice.req('POST', '/api/workspaces', { name: 'Equipo' })
    ws = team.body.id

    const bad = await new Client(app).req('POST', '/api/auth/login', { email: 'alice@test.dev', password: 'nope' })
    expect(bad.status).toBe(401)
    expect((await new Client(app).req('GET', '/api/workspaces')).status).toBe(401)
  })

  it('invita a Bob como viewer y respeta permisos', async () => {
    const inv = await alice.req('POST', `/api/workspaces/${ws}/invitations`, { email: 'bob@test.dev', role: 'viewer' })
    expect(inv.status).toBe(200)
    const token = inv.body.link.split('/').pop()
    const reg = await bob.req('POST', '/api/auth/register', { email: 'bob@test.dev', name: 'Bob', password: 'password123', invitation: token })
    expect(reg.status).toBe(200)
    const members = await alice.req('GET', `/api/workspaces/${ws}/members`)
    expect(members.body.members.map((m: any) => m.role)).toEqual(['owner', 'viewer'])
    const denied = await bob.req('POST', `/api/workspaces/${ws}/collections`, { name: 'x' })
    expect(denied.status).toBe(403)
  })
})

let collectionId = ''

describe('colecciones', () => {
  it('importa una colección de Postman con entorno', async () => {
    const r = await alice.req('POST', `/api/workspaces/${ws}/import`, { text: fixture('postman-v21.json') })
    expect(r.status).toBe(200)
    expect(r.body.format).toBe('postman-collection')
    collectionId = r.body.collections[0].id
    const env = await alice.req('POST', `/api/workspaces/${ws}/import`, { text: fixture('postman-env.json') })
    expect(env.body.environments).toHaveLength(1)

    const col = await alice.req('GET', `/api/collections/${collectionId}`)
    expect(col.body.name).toBe('Demo API')
    expect(col.body.items.map((i: any) => i.name)).toEqual(expect.arrayContaining(['Users', 'List users', 'Create user', 'Upload']))
    expect(col.body.data.auth.type).toBe('bearer')
  })

  it('exporta igual que el original (ida y vuelta por la BD)', async () => {
    const r = await alice.req('GET', `/api/collections/${collectionId}/export`)
    const original = JSON.parse(fixture('postman-v21.json'))
    const strip = (v: any): any =>
      Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'id' && k !== '_postman_id').map(([k, x]) => [k, strip(x)])) : v
    expect(strip(r.body)).toEqual(strip(original))
  })

  it('cifra secretos en reposo y los devuelve en claro', async () => {
    const envs = await alice.req('GET', `/api/workspaces/${ws}/environments`)
    expect(envs.body[0].values.find((v: any) => v.key === 'token').value).toBe('abc')
    const raw = await sqlClient`select values from environments`
    const token = (raw[0].values as any[]).find((v) => v.key === 'token')
    expect(token.value).toMatch(/^enc:v1:/)
  })

  it('crea, mueve, edita con control de versión y restaura', async () => {
    const folder = await alice.req('POST', `/api/collections/${collectionId}/items`, { type: 'folder', name: 'Nueva' })
    const req = await alice.req('POST', `/api/collections/${collectionId}/items`, { type: 'request', name: 'Ping', index: 0 })
    expect(req.body.version).toBe(1)
    const moved = await alice.req('POST', `/api/items/${req.body.id}/move`, { parentId: folder.body.id, index: 0 })
    expect(moved.body.parentId).toBe(folder.body.id)
    const loop = await alice.req('POST', `/api/items/${folder.body.id}/move`, { parentId: folder.body.id, index: 0 })
    expect(loop.status).toBe(400)

    const upd = await alice.req('PATCH', `/api/items/${req.body.id}`, { name: 'Ping 2', version: 1 })
    expect(upd.body.version).toBe(2)
    const stale = await alice.req('PATCH', `/api/items/${req.body.id}`, { name: 'Ping 3', version: 1 })
    expect(stale.status).toBe(409)

    await alice.req('DELETE', `/api/items/${folder.body.id}`)
    const revs = await alice.req('GET', `/api/collections/${collectionId}/revisions`)
    const del = revs.body.find((r: any) => r.action === 'delete')
    expect(del.restorable).toBe(true)
    await alice.req('POST', `/api/revisions/${del.id}/restore`)
    const col = await alice.req('GET', `/api/collections/${collectionId}`)
    expect(col.body.items.map((i: any) => i.name)).toEqual(expect.arrayContaining(['Nueva', 'Ping 2']))
  })
})

describe('ejecución', () => {
  it('envía una petición con auth heredada, scripts y guarda variables', async () => {
    const envs = await alice.req('GET', `/api/workspaces/${ws}/environments`)
    const env = envs.body[0]
    await alice.req('PUT', `/api/environments/${env.id}`, {
      values: [...env.values.filter((v: any) => v.key !== 'baseUrl'), { key: 'baseUrl', value: targetUrl }],
    })
    const col = await alice.req('GET', `/api/collections/${collectionId}`)
    const row = col.body.items.find((i: any) => i.name === 'List users')
    const item = {
      id: row.id,
      name: row.name,
      ...row.data,
      event: [{ listen: 'test', script: { exec: ['pm.test("ok", () => pm.response.to.have.status(200))', 'pm.environment.set("last", pm.response.json().url)'] } }],
    }
    const r = await alice.req('POST', `/api/workspaces/${ws}/execute`, { collectionId, item, environmentId: env.id })
    expect(r.status).toBe(200)
    expect(r.body.execution.response.code).toBe(200)
    const echoed = JSON.parse(r.body.execution.response.body)
    expect(echoed.url).toBe('/users?page=1')
    expect(echoed.auth).toBe('Bearer abc')
    expect(r.body.execution.tests).toEqual([{ name: 'ok', passed: true, skipped: false }])
    expect(r.body.variablesChanged).toContain('environment')
    const after = await alice.req('GET', `/api/workspaces/${ws}/environments`)
    expect(after.body[0].values.find((v: any) => v.key === 'last').value).toBe('/users?page=1')
    const hist = await alice.req('GET', `/api/workspaces/${ws}/history`)
    expect(hist.body[0]).toMatchObject({ method: 'GET', status: 200 })
  })

  it('ejecuta el runner y emite eventos', async () => {
    const envs = await alice.req('GET', `/api/workspaces/${ws}/environments`)
    const r = await alice.req('POST', `/api/collections/${collectionId}/runs`, { environmentId: envs.body[0].id, iterations: 2 })
    expect(r.status).toBe(200)
    let run: any
    for (let i = 0; i < 100; i++) {
      run = (await alice.req('GET', `/api/runs/${r.body.runId}`)).body
      if (run.status !== 'running') break
      await new Promise((res) => setTimeout(res, 100))
    }
    expect(['passed', 'failed']).toContain(run.status)
    expect(run.stats.iterations).toBe(2)
    expect(run.result.executions.length).toBeGreaterThanOrEqual(6)
  })

  it('genera snippets resolviendo variables', async () => {
    const r = await alice.req('POST', `/api/workspaces/${ws}/snippet`, {
      request: { method: 'GET', url: '{{baseUrl}}/x' },
      language: 'curl',
      variant: 'cURL',
      collectionId,
    })
    expect(r.body.snippet).toContain('https://api.example.com/x')
  })
})

describe('mocks', () => {
  it('responde con el ejemplo guardado', async () => {
    const m = await alice.req('POST', `/api/workspaces/${ws}/mocks`, { collectionId, name: 'Mock demo' })
    expect(m.status).toBe(200)
    const res = await app.inject({ method: 'GET', url: `/mock/${m.body.slug}/users` })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('[{"id":1}]')
    expect(res.headers['content-type']).toContain('application/json')
    const miss = await app.inject({ method: 'POST', url: `/mock/${m.body.slug}/nada` })
    expect(miss.statusCode).toBe(404)
    const logs = await alice.req('GET', `/api/mocks/${m.body.id}/logs`)
    expect(logs.body).toHaveLength(2)
  })
})

describe('documentación pública', () => {
  it('publica sin credenciales y con contraseña', async () => {
    const put = await alice.req('PUT', `/api/collections/${collectionId}/docs`, { slug: 'demo-api', published: true, password: 'clave' })
    expect(put.status).toBe(200)
    const anon = new Client(app)
    expect((await anon.req('GET', '/api/public/docs/demo-api')).status).toBe(401)
    const ok = await app.inject({ method: 'GET', url: '/api/public/docs/demo-api', headers: { 'x-docs-password': 'clave' } })
    const doc = JSON.parse(ok.body)
    expect(doc.collection.info.name).toBe('Demo API')
    const create = doc.collection.item[0].item.find((i: any) => i.name === 'Create user')
    expect(create.request.auth.basic.find((a: any) => a.key === 'password').value).toBe('<oculto>')
  })
})
