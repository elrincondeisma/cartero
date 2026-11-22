import { randomUUID } from 'node:crypto'
import { type Collection, type RequestItem, rawUrl, toScope } from '@cartero/core'
import { runIsolated } from '@cartero/executor'
import { generateSnippet, snippetLanguages } from '@cartero/exporters'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, schema } from '../db/index.js'
import { assertCollection, assertRole, roleAtLeast } from '../lib/access.js'
import { requireUser } from '../lib/auth.js'
import { badRequest, notFound } from '../lib/errors.js'
import {
  baseRunOptions,
  compactResult,
  getLiveRun,
  loadContext,
  persistResult,
  startRun,
} from '../lib/runner.js'
import { findItem, loadCollection, replaceItem } from '../lib/tree.js'

const executeBody = z.object({
  collectionId: z.string().uuid().nullable().optional(),
  item: z.record(z.string(), z.any()),
  environmentId: z.string().uuid().nullable().optional(),
  persistVariables: z.boolean().optional(),
})

const runBody = z.object({
  environmentId: z.string().uuid().nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
  /** Ids de peticiones a ejecutar (en orden). Si se omite, todas. */
  itemIds: z.array(z.string().uuid()).optional(),
  iterations: z.number().int().min(1).max(10_000).optional(),
  data: z.array(z.record(z.string(), z.any())).max(100_000).optional(),
  delay: z.number().int().min(0).max(600_000).optional(),
  bail: z.boolean().optional(),
  persistVariables: z.boolean().optional(),
  timeoutRequest: z.number().int().min(0).optional(),
})

/** Filtra el árbol para dejar sólo las peticiones elegidas (manteniendo carpetas padre por auth/scripts). */
function filterTree(items: any[], keep: Set<string>): any[] {
  const out: any[] = []
  for (const it of items) {
    if (Array.isArray(it.item)) {
      const children = filterTree(it.item, keep)
      if (children.length) out.push({ ...it, item: children })
    } else if (keep.has(it.id)) out.push(it)
  }
  return out
}

export async function executeRoutes(app: FastifyInstance) {
  /** Envía una petición (la del editor, con cambios sin guardar) dentro del contexto de su colección. */
  app.post('/api/workspaces/:ws/execute', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    const role = await assertRole(ws, user.id)
    const body = executeBody.parse(req.body)
    const item = body.item as RequestItem
    if (!item.request) throw badRequest('La petición no es válida')
    item.id ??= randomUUID()

    let collection: Collection
    if (body.collectionId) {
      const cws = await assertCollection(body.collectionId, user.id)
      if (cws !== ws) throw badRequest('La colección no pertenece a este workspace')
      collection = (await loadCollection(body.collectionId)).collection
      if (!replaceItem(collection.item, item)) collection.item.push(item)
    } else {
      collection = { info: { name: 'Petición suelta' }, item: [item] }
    }
    const runCtx = { workspaceId: ws, userId: user.id, environmentId: body.environmentId }
    const ctx = await loadContext(runCtx)
    const collectionVariables = collection.variable ?? []

    const result = await runIsolated(
      {
        ...(await baseRunOptions()),
        collection,
        entrypoint: item.id,
        environment: ctx.environment,
        globals: ctx.globals,
        cookieJar: ctx.cookieJar,
      },
      () => {},
      { maxDuration: 3 * 60_000 },
    )

    const changed =
      body.persistVariables === false
        ? []
        : await persistResult(
            runCtx,
            {
              environment: ctx.environment,
              globals: ctx.globals,
              collectionVariables,
              collectionId: body.collectionId ?? undefined,
            },
            result,
            roleAtLeast(role, 'editor'),
          )

    const ex = result.executions[0]
    await db.insert(schema.history).values({
      workspaceId: ws,
      userId: user.id,
      itemId: body.collectionId ? item.id : null,
      method: item.request.method ?? 'GET',
      url: rawUrl(item.request.url),
      status: ex?.response?.code ?? null,
      time: ex?.response ? Math.round(ex.response.time) : null,
      request: { ...item, collectionId: body.collectionId ?? null },
    })

    return {
      execution: ex ?? null,
      console: result.console,
      error: result.error,
      variablesChanged: changed,
      environment: result.environment,
      globals: result.globals,
      collectionVariables: result.collectionVariables,
    }
  })

  // Historial
  app.get('/api/workspaces/:ws/history', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id)
    return db
      .select()
      .from(schema.history)
      .where(and(eq(schema.history.workspaceId, ws), eq(schema.history.userId, user.id)))
      .orderBy(desc(schema.history.createdAt))
      .limit(300)
  })

  app.delete('/api/workspaces/:ws/history', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await db
      .delete(schema.history)
      .where(and(eq(schema.history.workspaceId, ws), eq(schema.history.userId, user.id)))
    return { ok: true }
  })

  // Cookies
  app.get('/api/workspaces/:ws/cookies', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id)
    const [jar] = await db
      .select()
      .from(schema.cookieJars)
      .where(and(eq(schema.cookieJars.workspaceId, ws), eq(schema.cookieJars.userId, user.id)))
    return (jar?.jar as any) ?? { cookies: [] }
  })

  app.put('/api/workspaces/:ws/cookies', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id)
    const jar = z
      .object({ cookies: z.array(z.any()) })
      .passthrough()
      .parse(req.body)
    await db
      .insert(schema.cookieJars)
      .values({ workspaceId: ws, userId: user.id, jar })
      .onConflictDoUpdate({
        target: [schema.cookieJars.workspaceId, schema.cookieJars.userId],
        set: { jar, updatedAt: new Date() },
      })
    return { ok: true }
  })

  // Snippets de código
  app.get('/api/snippets/languages', async () => snippetLanguages())

  app.post('/api/workspaces/:ws/snippet', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id)
    const body = z
      .object({
        request: z.record(z.string(), z.any()),
        language: z.string(),
        variant: z.string(),
        environmentId: z.string().uuid().nullable().optional(),
        collectionId: z.string().uuid().nullable().optional(),
        resolve: z.boolean().optional(),
      })
      .parse(req.body)
    const layers = []
    if (body.resolve !== false) {
      const ctx = await loadContext({ workspaceId: ws, environmentId: body.environmentId })
      layers.push(toScope(ctx.globals))
      if (body.collectionId) {
        await assertCollection(body.collectionId, user.id)
        const [c] = await db
          .select({ data: schema.collections.data })
          .from(schema.collections)
          .where(eq(schema.collections.id, body.collectionId))
        layers.push(toScope(c?.data?.variable))
      }
      layers.push(toScope(ctx.environment))
    }
    try {
      return { snippet: await generateSnippet(body.request as any, body.language, body.variant, layers) }
    } catch (e) {
      throw badRequest(`No se pudo generar el snippet: ${(e as Error).message}`)
    }
  })

  // Runner de colecciones
  app.post('/api/collections/:id/runs', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const ws = await assertCollection(id, user.id)
    const role = await assertRole(ws, user.id)
    const body = runBody.parse(req.body ?? {})
    const { row, collection } = await loadCollection(id)
    let entrypoint: string | undefined
    let name = row.name
    if (body.folderId) {
      const folder = findItem(collection.item, body.folderId)
      if (!folder) throw notFound('Carpeta')
      entrypoint = body.folderId
      name = `${row.name} / ${folder.name}`
    }
    if (body.itemIds?.length) collection.item = filterTree(collection.item, new Set(body.itemIds))
    const runId = await startRun({
      workspaceId: ws,
      userId: user.id,
      environmentId: body.environmentId,
      collectionId: id,
      collection,
      name,
      source: 'app',
      canWrite: roleAtLeast(role, 'editor'),
      persistVariables: body.persistVariables,
      options: {
        entrypoint,
        iterationCount: body.iterations ?? (body.data?.length || 1),
        iterationData: body.data,
        delayRequest: body.delay,
        bail: body.bail,
        timeoutRequest: body.timeoutRequest,
      },
    })
    return { runId }
  })

  app.get('/api/workspaces/:ws/runs', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id)
    const { collectionId, monitorId } = req.query as { collectionId?: string; monitorId?: string }
    return db
      .select({
        id: schema.runs.id,
        name: schema.runs.name,
        status: schema.runs.status,
        source: schema.runs.source,
        stats: schema.runs.stats,
        collectionId: schema.runs.collectionId,
        monitorId: schema.runs.monitorId,
        startedAt: schema.runs.startedAt,
        finishedAt: schema.runs.finishedAt,
        user: schema.users.name,
      })
      .from(schema.runs)
      .leftJoin(schema.users, eq(schema.users.id, schema.runs.userId))
      .where(
        and(
          eq(schema.runs.workspaceId, ws),
          collectionId ? eq(schema.runs.collectionId, collectionId) : undefined,
          monitorId ? eq(schema.runs.monitorId, monitorId) : undefined,
        ),
      )
      .orderBy(desc(schema.runs.startedAt))
      .limit(100)
  })

  app.get('/api/runs/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, id))
    if (!run) throw notFound('Run')
    await assertRole(run.workspaceId, user.id)
    return run
  })

  app.delete('/api/workspaces/:ws/runs', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id, 'admin')
    const { ids } = z.object({ ids: z.array(z.string().uuid()) }).parse(req.body)
    await db.delete(schema.runs).where(and(eq(schema.runs.workspaceId, ws), inArray(schema.runs.id, ids)))
    return { ok: true }
  })

  app.post('/api/runs/:id/abort', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, id))
    if (!run) throw notFound('Run')
    await assertRole(run.workspaceId, user.id)
    getLiveRun(id)?.abort.abort()
    return { ok: true }
  })

  /** Eventos en vivo del run (Server-Sent Events). */
  app.get('/api/runs/:id/events', async (req, reply) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, id))
    if (!run) throw notFound('Run')
    await assertRole(run.workspaceId, user.id)

    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

    const state = getLiveRun(id)
    if (!state) {
      send('end', { status: run.status })
      return res.end()
    }
    for (const e of state.events) send('run', e)
    if (state.done) {
      send('end', {})
      return res.end()
    }
    const onEvent = (e: unknown) => send('run', e)
    const onEnd = (status: string) => {
      send('end', { status })
      cleanup()
      res.end()
    }
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
    const cleanup = () => {
      clearInterval(ping)
      state.emitter.off('event', onEvent)
      state.emitter.off('end', onEnd)
    }
    state.emitter.on('event', onEvent)
    state.emitter.on('end', onEnd)
    req.raw.on('close', cleanup)
  })

  /** La CLI puede subir el resultado de una ejecución local. */
  app.post('/api/workspaces/:ws/runs/report', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id, 'editor')
    const body = z
      .object({
        name: z.string(),
        collectionId: z.string().uuid().nullable().optional(),
        result: z.record(z.string(), z.any()),
        source: z.enum(['cli', 'desktop']).optional(),
      })
      .parse(req.body)
    const result = body.result as any
    const failed = result.stats?.failedAssertions > 0 || result.stats?.failedRequests > 0
    const [run] = await db
      .insert(schema.runs)
      .values({
        workspaceId: ws,
        collectionId: body.collectionId ?? null,
        userId: user.id,
        source: body.source ?? 'cli',
        name: body.name,
        status: result.error ? 'error' : failed ? 'failed' : 'passed',
        stats: result.stats,
        result: compactResult(result),
        startedAt: result.startedAt ? new Date(result.startedAt) : new Date(),
        finishedAt: result.finishedAt ? new Date(result.finishedAt) : new Date(),
      })
      .returning({ id: schema.runs.id })
    return { runId: run.id }
  })
}
