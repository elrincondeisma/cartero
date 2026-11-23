import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgres://cartero:cartero@localhost:5433/cartero_test'
process.env.LOG_LEVEL = 'silent'

const { buildApp } = await import('./app.js')
const { runMigrations } = await import('./db/migrate.js')
const { sqlClient } = await import('./db/index.js')
const { clearSettingsCache } = await import('./lib/settings.js')

let app: FastifyInstance
let token = ''
let ws = ''

/** La app de escritorio usa un token Bearer, sin cookies. */
async function api(method: string, url: string, body?: unknown, bearer = token) {
  const res = await app.inject({
    method: method as any,
    url,
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    payload: body as any,
  })
  return { status: res.statusCode, body: res.json() as any }
}

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
    payload: { email: 'desk@test.dev', name: 'Desk', password: 'password123' },
  })
  const cookie = String(reg.headers['set-cookie']).split(';')[0]
  const t = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    headers: { cookie },
    payload: { name: 'Cartero de escritorio' },
  })
  token = t.json().token
  const list = await api('GET', '/api/workspaces')
  ws = list.body[0].id
})

afterAll(async () => {
  await app?.close()
  await sqlClient.end()
})

describe('sincronización con la app de escritorio', () => {
  const collectionId = randomUUID()
  const folderId = randomUUID()
  const itemId = randomUUID()
  const envId = randomUUID()
  let cursor = ''

  it('sube colección, carpeta, petición y entorno con los ids de la app', async () => {
    const r = await api('POST', `/api/workspaces/${ws}/sync`, {
      ops: [
        {
          entity: 'item',
          op: 'upsert',
          id: itemId,
          base: null,
          data: {
            collectionId,
            parentId: folderId,
            type: 'request',
            name: 'Get',
            sort: 'a0',
            data: { request: { method: 'GET', url: 'https://x.io' } },
          },
        },
        {
          entity: 'item',
          op: 'upsert',
          id: folderId,
          base: null,
          data: { collectionId, parentId: null, type: 'folder', name: 'F', sort: 'a0', data: {} },
        },
        {
          entity: 'collection',
          op: 'upsert',
          id: collectionId,
          base: null,
          data: { name: 'Desde el escritorio', data: { variable: [{ key: 'a', value: '1' }] } },
        },
        {
          entity: 'environment',
          op: 'upsert',
          id: envId,
          base: null,
          data: { name: 'Local', values: [{ key: 'token', value: 's3cr3t', type: 'secret' }] },
        },
      ],
    })
    expect(r.status).toBe(200)
    // el orden no importa: la colección se crea antes que sus ítems
    expect(r.body.results.every((x: any) => x.status === 'ok')).toBe(true)
    const web = await api('GET', `/api/collections/${collectionId}`)
    expect(web.body.items.map((i: any) => i.id).sort()).toEqual([folderId, itemId].sort())
    const list = await api('GET', `/api/workspaces/${ws}/collections`)
    expect(list.body.find((c: any) => c.id === collectionId).requests).toBe(1)
  })

  it('cambios completos y desde un cursor, con los secretos legibles', async () => {
    const full = await api('GET', `/api/workspaces/${ws}/changes`)
    expect(full.body.full).toBe(true)
    expect(full.body.collections.find((c: any) => c.id === collectionId).name).toBe('Desde el escritorio')
    expect(full.body.environments[0].values[0].value).toBe('s3cr3t')
    expect(full.body.globals.values).toEqual([])
    cursor = full.body.cursor
    // la web edita la petición: la app lo ve en los cambios
    await new Promise((r) => setTimeout(r, 20))
    await api('PATCH', `/api/items/${itemId}`, { name: 'Get (web)' })
    const delta = await api('GET', `/api/workspaces/${ws}/changes?since=${encodeURIComponent(cursor)}`)
    expect(delta.body.full).toBe(false)
    expect(delta.body.items.find((i: any) => i.id === itemId).name).toBe('Get (web)')
  })

  it('detecta conflictos comparando con lo último que vio la app', async () => {
    const stale = { collectionId, parentId: folderId, type: 'request', name: 'Get', sort: 'a0', data: {} }
    const r = await api('POST', `/api/workspaces/${ws}/sync`, {
      ops: [
        {
          entity: 'item',
          op: 'upsert',
          id: itemId,
          base: stale,
          data: { ...stale, name: 'Get (escritorio)' },
        },
      ],
    })
    expect(r.body.results[0].status).toBe('conflict')
    expect(r.body.results[0].remote.name).toBe('Get (web)')
    // quedarse con la suya: forzar
    const forced = await api('POST', `/api/workspaces/${ws}/sync`, {
      ops: [
        {
          entity: 'item',
          op: 'upsert',
          id: itemId,
          base: stale,
          force: true,
          data: { ...stale, name: 'Get (escritorio)' },
        },
      ],
    })
    expect(forced.body.results[0].status).toBe('ok')
    // una colección cuyo único cambio son sus ítems no da conflicto (la base es el contenido)
    const base = { name: 'Desde el escritorio', data: { variable: [{ key: 'a', value: '1' }] } }
    const meta = await api('POST', `/api/workspaces/${ws}/sync`, {
      ops: [
        { entity: 'collection', op: 'upsert', id: collectionId, base, data: { ...base, name: 'Renombrada' } },
      ],
    })
    expect(meta.body.results[0].status).toBe('ok')
  })

  it('los borrados (también desde la web) llegan como eliminados', async () => {
    const before = new Date(Date.now() - 1000).toISOString()
    await api('DELETE', `/api/environments/${envId}`)
    const r = await api('POST', `/api/workspaces/${ws}/sync`, {
      ops: [
        {
          entity: 'item',
          op: 'delete',
          id: folderId,
          base: { collectionId, parentId: null, type: 'folder', name: 'F', sort: 'a0', data: {} },
        },
      ],
    })
    expect(r.body.results[0].status).toBe('ok')
    const delta = await api('GET', `/api/workspaces/${ws}/changes?since=${encodeURIComponent(before)}`)
    const deleted = delta.body.deleted.map((d: any) => `${d.entity}:${d.id}`)
    expect(deleted).toEqual(
      expect.arrayContaining([`environment:${envId}`, `item:${folderId}`, `item:${itemId}`]),
    )
  })

  it('globales con versión, historial y ejecuciones del escritorio', async () => {
    const g = await api('POST', `/api/workspaces/${ws}/sync`, {
      ops: [
        {
          entity: 'globals',
          op: 'upsert',
          base: { values: [] },
          data: { values: [{ key: 'g', value: '1' }] },
        },
      ],
    })
    expect(g.body.results[0]).toMatchObject({ status: 'ok', version: 2 })
    const h = await api('POST', `/api/workspaces/${ws}/history`, {
      entries: [
        {
          method: 'GET',
          url: 'https://x.io',
          status: 200,
          time: 12,
          request: { name: 'x' },
          createdAt: new Date().toISOString(),
        },
      ],
    })
    expect(h.body.count).toBe(1)
    const list = await api('GET', `/api/workspaces/${ws}/history`)
    expect(list.body[0].url).toBe('https://x.io')
    const run = await api('POST', `/api/workspaces/${ws}/runs/report`, {
      name: 'Run',
      source: 'desktop',
      result: {
        stats: {
          requests: 1,
          failedRequests: 0,
          assertions: 1,
          failedAssertions: 0,
          iterations: 1,
          totalTime: 5,
        },
        executions: [],
      },
    })
    expect(run.status).toBe(200)
    const runs = await api('GET', `/api/workspaces/${ws}/runs`)
    expect(runs.body[0].source).toBe('desktop')
  })

  it('los cambios de contrato desde la app quedan en el historial', async () => {
    const id = randomUUID()
    const v1 = {
      responses: {
        '200': {
          body: {
            type: 'object',
            properties: { id: { type: 'integer' }, email: { type: 'string' } },
            required: ['id', 'email'],
          },
        },
      },
    }
    const v2 = {
      responses: {
        '200': { body: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
      },
    }
    const item = (contract: unknown) => ({
      collectionId,
      parentId: null,
      type: 'request',
      name: 'Ver usuario',
      sort: 'b0',
      data: { request: { method: 'GET', url: 'https://x.io/users/:id' }, contract },
    })
    let r = await api('POST', `/api/workspaces/${ws}/sync`, {
      ops: [{ entity: 'item', op: 'upsert', id, base: null, data: item(v1) }],
    })
    expect(r.body.results[0].status).toBe('ok')
    r = await api('POST', `/api/workspaces/${ws}/sync`, {
      ops: [{ entity: 'item', op: 'upsert', id, base: item(v1), data: item(v2) }],
    })
    expect(r.body.results[0].status).toBe('ok')
    const revs = await api('GET', `/api/collections/${collectionId}/revisions?itemId=${id}&action=contract`)
    expect(revs.body.map((x: any) => x.summary)).toEqual([
      'Contrato de «Ver usuario»: 1 cambio que rompe',
      'Contrato de «Ver usuario»: creado',
    ])
  })

  it('sin token no hay nada', async () => {
    const r = await api('GET', `/api/workspaces/${ws}/changes`, undefined, '')
    expect(r.status).toBe(401)
  })
})
