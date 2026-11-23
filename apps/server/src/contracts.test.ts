import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

process.env.DATABASE_URL ??= 'postgres://cartero:cartero@localhost:5433/cartero_test'
process.env.LOG_LEVEL = 'silent'

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

const contractV1 = {
  request: { path: [{ name: 'id', required: true, schema: { type: 'integer' } }] },
  responses: {
    '200': {
      headers: [{ name: 'X-Request-Id', required: true }],
      body: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string', example: 'Ana' },
        },
        required: ['id', 'email', 'name'],
      },
    },
    '404': { body: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] } },
  },
}

let ws = ''
let collectionId = ''
let itemId = ''

beforeAll(async () => {
  await sqlClient.unsafe(
    'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
  )
  await runMigrations()
  clearSettingsCache()
  app = await buildApp({ logger: false })
  const reg = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'contratos@test.dev', name: 'Contratos', password: 'password123' },
  })
  cookie = String(reg.headers['set-cookie']).split(';')[0]
  ws = (await api('GET', '/api/workspaces')).body[0].id
  collectionId = (await api('POST', `/api/workspaces/${ws}/collections`, { name: 'API de usuarios' })).body.id
  const item = await api('POST', `/api/collections/${collectionId}/items`, {
    type: 'request',
    name: 'Ver usuario',
    data: {
      request: { method: 'GET', url: { raw: '{{baseUrl}}/users/:id' }, header: [] },
      response: [],
      contract: contractV1,
    },
  })
  itemId = item.body.id
})

afterAll(async () => {
  await app?.close()
  await sqlClient.end()
})

describe('contratos', () => {
  it('el mock responde con datos que cumplen el contrato si no hay ejemplos', async () => {
    const m = await api('POST', `/api/workspaces/${ws}/mocks`, { collectionId, name: 'Mock contratos' })
    const ok = await app.inject({ method: 'GET', url: `/mock/${m.body.slug}/users/7` })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['x-request-id']).toBeTruthy()
    expect(ok.json()).toEqual({ id: 1, email: 'ana@example.com', name: 'Ana' })
    expect(decodeURIComponent(String(ok.headers['x-cartero-mock-match']))).toBe('Ver usuario / Contrato 200')

    const notFound = await app.inject({
      method: 'GET',
      url: `/mock/${m.body.slug}/users/7`,
      headers: { 'x-mock-response-code': '404' },
    })
    expect(notFound.statusCode).toBe(404)
    expect(notFound.json()).toEqual({ error: 'error' })
  })

  it('el historial registra los cambios del contrato y si rompen', async () => {
    const before = (await api('GET', `/api/items/${itemId}`)).body
    const contractV2 = structuredClone(contractV1) as any
    delete contractV2.responses['200'].body.properties.email
    contractV2.responses['200'].body.required = ['id', 'name']
    contractV2.responses['200'].body.properties.avatar = { type: 'string' }
    const r = await api('PATCH', `/api/items/${itemId}`, {
      data: { ...before.data, contract: contractV2 },
      version: before.version,
    })
    expect(r.status).toBe(200)

    const revs = await api(
      'GET',
      `/api/collections/${collectionId}/revisions?itemId=${itemId}&action=contract`,
    )
    expect(revs.body).toHaveLength(1)
    expect(revs.body[0].summary).toBe('Contrato de «Ver usuario»: 1 cambio que rompe, 1 compatible')
    const rev = await api('GET', `/api/revisions/${revs.body[0].id}`)
    expect(rev.body.before.contract.responses['200'].body.properties.email).toBeTruthy()
    expect(rev.body.after.contract.responses['200'].body.properties.avatar).toBeTruthy()

    // Un cambio que no toca el contrato no aparece en su historial
    const now = (await api('GET', `/api/items/${itemId}`)).body
    await api('PATCH', `/api/items/${itemId}`, { name: 'Ver un usuario', version: now.version })
    const again = await api(
      'GET',
      `/api/collections/${collectionId}/revisions?itemId=${itemId}&action=contract`,
    )
    expect(again.body).toHaveLength(1)
  })

  it('exporta OpenAPI 3.1 y se vuelve a importar con los contratos', async () => {
    const json = await api('GET', `/api/collections/${collectionId}/openapi`)
    expect(json.body.openapi).toBe('3.1.0')
    const op = json.body.paths['/users/{id}'].get
    expect(op.parameters[0]).toMatchObject({ name: 'id', in: 'path', schema: { type: 'integer' } })
    expect(op.responses['200'].content['application/json'].schema.properties.avatar).toEqual({
      type: 'string',
    })

    const yaml = await app.inject({
      method: 'GET',
      url: `/api/collections/${collectionId}/openapi?format=yaml`,
      headers: { cookie },
    })
    expect(yaml.headers['content-type']).toMatch(/yaml/)
    expect(parseYaml(yaml.body).paths['/users/{id}']).toBeTruthy()

    const imported = await api('POST', `/api/workspaces/${ws}/import`, { text: yaml.body })
    expect(imported.status).toBe(200)
    const newId = imported.body.collections[0].id
    const col = await api('GET', `/api/collections/${newId}`)
    const req = col.body.items.find((i: any) => i.type === 'request')
    expect(req.data.contract.responses['200'].body.required).toEqual(['id', 'name'])
    expect(req.data.contract.responses['404']).toBeTruthy()
  })
})
