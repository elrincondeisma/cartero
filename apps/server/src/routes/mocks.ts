import { type Collection, toScope } from '@cartero/core'
import { and, desc, eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { db, schema } from '../db/index.js'
import { assertCollection, assertRole, getRole } from '../lib/access.js'
import { requireUser, resolveUser } from '../lib/auth.js'
import { openVariables, randomToken } from '../lib/crypto.js'
import { notFound } from '../lib/errors.js'
import { mockResponse } from '../lib/mock.js'
import { loadCollection } from '../lib/tree.js'

const mockBody = z.object({
  collectionId: z.string().uuid(),
  name: z.string().min(1).max(200),
  environmentId: z.string().uuid().nullable().optional(),
  delayMs: z.number().int().min(0).max(60_000).optional(),
  isPrivate: z.boolean().optional(),
})

// Caché corta para no reconstruir la colección en cada llamada al mock
const cache = new Map<string, { at: number; collection: Collection; vars: Record<string, string>[] }>()
const CACHE_MS = 3000

export function invalidateMockCache(collectionId?: string) {
  if (!collectionId) cache.clear()
  else for (const [k] of cache) if (k.startsWith(collectionId)) cache.delete(k)
}

async function mockData(collectionId: string, environmentId: string | null, workspaceId: string) {
  const key = `${collectionId}:${environmentId ?? ''}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit
  const { collection } = await loadCollection(collectionId)
  const [ws] = await db.select({ globals: schema.workspaces.globals }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId))
  const vars = [toScope(openVariables(ws?.globals ?? [])), toScope(collection.variable)]
  if (environmentId) {
    const [env] = await db.select().from(schema.environments).where(eq(schema.environments.id, environmentId))
    if (env) vars.push(toScope(openVariables(env.values)))
  }
  const entry = { at: Date.now(), collection, vars }
  cache.set(key, entry)
  return entry
}

async function handleMock(req: FastifyRequest, reply: FastifyReply) {
  const { slug } = req.params as { slug: string; '*': string }
  const path = `/${(req.params as any)['*'] ?? ''}`
  reply.header('access-control-allow-origin', '*')
  reply.header('access-control-allow-headers', '*')
  reply.header('access-control-allow-methods', '*')
  reply.header('access-control-expose-headers', '*')
  if (req.method === 'OPTIONS') return reply.code(204).send()

  const [mock] = await db.select().from(schema.mocks).where(eq(schema.mocks.slug, slug))
  if (!mock) return reply.code(404).send({ error: 'mockNotFound', message: 'Este mock no existe' })

  if (mock.isPrivate) {
    const user = await resolveUser(req)
    if (!user || !(await getRole(mock.workspaceId, user.id)))
      return reply.code(401).send({ error: 'unauthorized', message: 'Mock privado: envía una API key en x-api-key' })
  }

  const { collection, vars } = await mockData(mock.collectionId, mock.environmentId, mock.workspaceId)
  const body = typeof req.body === 'string' ? req.body : req.body ? JSON.stringify(req.body) : undefined
  const res = mockResponse(collection, { method: req.method, path, query: req.query as any, headers: req.headers, body }, vars)

  await db
    .insert(schema.mockLogs)
    .values({
      mockId: mock.id,
      method: req.method,
      path: req.url.replace(`/mock/${slug}`, '') || '/',
      status: res.status,
      matchedItemId: res.match?.item.id && /^[0-9a-f-]{36}$/.test(res.match.item.id) ? res.match.item.id : null,
      matchedExample: res.match?.example.name ?? null,
      request: { headers: req.headers, body: body?.slice(0, 10_000) },
    })
    .catch((e) => req.log.warn(`No se pudo guardar el log del mock: ${e.message}`))

  if (mock.delayMs) await new Promise((r) => setTimeout(r, mock.delayMs))
  for (const h of res.headers) reply.header(h.key, h.value)
  reply.header('x-cartero-mock-match', res.match ? encodeURIComponent(`${res.match.item.name} / ${res.match.example.name}`) : 'none')
  return reply.code(res.status).send(res.body)
}

export async function mockRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:ws/mocks', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id)
    return db
      .select({
        id: schema.mocks.id,
        name: schema.mocks.name,
        slug: schema.mocks.slug,
        collectionId: schema.mocks.collectionId,
        collection: schema.collections.name,
        environmentId: schema.mocks.environmentId,
        delayMs: schema.mocks.delayMs,
        isPrivate: schema.mocks.isPrivate,
        createdAt: schema.mocks.createdAt,
      })
      .from(schema.mocks)
      .innerJoin(schema.collections, eq(schema.collections.id, schema.mocks.collectionId))
      .where(eq(schema.mocks.workspaceId, ws))
      .orderBy(desc(schema.mocks.createdAt))
  })

  app.post('/api/workspaces/:ws/mocks', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id, 'editor')
    const body = mockBody.parse(req.body)
    const cws = await assertCollection(body.collectionId, user.id)
    if (cws !== ws) throw notFound('Colección')
    const [row] = await db
      .insert(schema.mocks)
      .values({
        workspaceId: ws,
        collectionId: body.collectionId,
        name: body.name,
        environmentId: body.environmentId ?? null,
        delayMs: body.delayMs ?? 0,
        isPrivate: body.isPrivate ?? false,
        slug: randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, 'x'),
      })
      .returning()
    return row
  })

  app.patch('/api/mocks/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const [mock] = await db.select().from(schema.mocks).where(eq(schema.mocks.id, id))
    if (!mock) throw notFound('Mock')
    await assertRole(mock.workspaceId, user.id, 'editor')
    const body = mockBody.partial().omit({ collectionId: true }).parse(req.body)
    const [row] = await db.update(schema.mocks).set(body).where(eq(schema.mocks.id, id)).returning()
    invalidateMockCache(mock.collectionId)
    return row
  })

  app.delete('/api/mocks/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const [mock] = await db.select().from(schema.mocks).where(eq(schema.mocks.id, id))
    if (!mock) throw notFound('Mock')
    await assertRole(mock.workspaceId, user.id, 'editor')
    await db.delete(schema.mocks).where(eq(schema.mocks.id, id))
    return { ok: true }
  })

  app.get('/api/mocks/:id/logs', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const [mock] = await db.select().from(schema.mocks).where(eq(schema.mocks.id, id))
    if (!mock) throw notFound('Mock')
    await assertRole(mock.workspaceId, user.id)
    return db
      .select()
      .from(schema.mockLogs)
      .where(and(eq(schema.mockLogs.mockId, id)))
      .orderBy(desc(schema.mockLogs.createdAt))
      .limit(200)
  })

  // Endpoint público del mock: acepta cualquier método y ruta
  app.register(async (pub) => {
    pub.removeAllContentTypeParsers()
    pub.addContentTypeParser('*', { parseAs: 'string', bodyLimit: 5 * 1024 * 1024 }, (_req, body, done) => done(null, body))
    pub.all('/mock/:slug', handleMock)
    pub.all('/mock/:slug/*', handleMock)
  })
}
