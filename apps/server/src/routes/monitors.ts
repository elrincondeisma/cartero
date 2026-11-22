import { desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, schema } from '../db/index.js'
import { assertCollection, assertRole } from '../lib/access.js'
import { requireUser } from '../lib/auth.js'
import { badRequest, notFound } from '../lib/errors.js'
import { nextRuns, runMonitor, scheduleMonitor, unscheduleMonitor } from '../lib/monitors.js'
import { notify } from '../lib/notify.js'

const notifySchema = z.array(
  z.object({
    type: z.enum(['email', 'webhook', 'slack', 'discord', 'telegram']),
    target: z.string().min(1).max(500),
    onlyOnFailure: z.boolean().optional(),
  }),
)

const monitorBody = z.object({
  collectionId: z.string().uuid(),
  environmentId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200),
  cron: z.string().min(9).max(100),
  timezone: z.string().max(100).optional(),
  enabled: z.boolean().optional(),
  notify: notifySchema.optional(),
})

function validCron(expr: string) {
  const parts = expr.trim().split(/\s+/)
  return parts.length === 5 || parts.length === 6
}

async function monitorOf(id: string) {
  const [m] = await db.select().from(schema.monitors).where(eq(schema.monitors.id, id))
  if (!m) throw notFound('Monitor')
  return m
}

export async function monitorRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:ws/monitors', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id)
    const rows = await db
      .select({
        id: schema.monitors.id,
        name: schema.monitors.name,
        collectionId: schema.monitors.collectionId,
        collection: schema.collections.name,
        environmentId: schema.monitors.environmentId,
        cron: schema.monitors.cron,
        timezone: schema.monitors.timezone,
        enabled: schema.monitors.enabled,
        notify: schema.monitors.notify,
        lastRunAt: schema.monitors.lastRunAt,
        lastStatus: schema.monitors.lastStatus,
      })
      .from(schema.monitors)
      .innerJoin(schema.collections, eq(schema.collections.id, schema.monitors.collectionId))
      .where(eq(schema.monitors.workspaceId, ws))
      .orderBy(desc(schema.monitors.createdAt))
    return Promise.all(rows.map(async (r) => ({ ...r, nextRunAt: r.enabled ? await nextRuns(r.id).catch(() => undefined) : undefined })))
  })

  app.post('/api/workspaces/:ws/monitors', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id, 'editor')
    const body = monitorBody.parse(req.body)
    if (!validCron(body.cron)) throw badRequest('Expresión cron no válida')
    if ((await assertCollection(body.collectionId, user.id)) !== ws) throw notFound('Colección')
    const [row] = await db
      .insert(schema.monitors)
      .values({
        workspaceId: ws,
        collectionId: body.collectionId,
        environmentId: body.environmentId ?? null,
        name: body.name,
        cron: body.cron,
        timezone: body.timezone ?? 'UTC',
        enabled: body.enabled ?? true,
        notify: body.notify ?? [],
        createdBy: user.id,
      })
      .returning()
    try {
      await scheduleMonitor(row)
    } catch (e) {
      await db.delete(schema.monitors).where(eq(schema.monitors.id, row.id))
      throw badRequest(`No se pudo programar: ${(e as Error).message}`)
    }
    return row
  })

  app.patch('/api/monitors/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const m = await monitorOf(id)
    await assertRole(m.workspaceId, user.id, 'editor')
    const body = monitorBody.partial().omit({ collectionId: true }).parse(req.body)
    if (body.cron && !validCron(body.cron)) throw badRequest('Expresión cron no válida')
    const [row] = await db.update(schema.monitors).set(body).where(eq(schema.monitors.id, id)).returning()
    try {
      await scheduleMonitor(row)
    } catch (e) {
      await db.update(schema.monitors).set({ cron: m.cron, timezone: m.timezone, enabled: m.enabled }).where(eq(schema.monitors.id, id))
      throw badRequest(`No se pudo programar: ${(e as Error).message}`)
    }
    return row
  })

  app.delete('/api/monitors/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const m = await monitorOf(id)
    await assertRole(m.workspaceId, user.id, 'editor')
    await unscheduleMonitor(id).catch(() => {})
    await db.delete(schema.monitors).where(eq(schema.monitors.id, id))
    return { ok: true }
  })

  app.post('/api/monitors/:id/run', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const m = await monitorOf(id)
    await assertRole(m.workspaceId, user.id, 'editor')
    void runMonitor(id)
    return { ok: true }
  })

  app.post('/api/workspaces/:ws/notify/test', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id, 'editor')
    const targets = notifySchema.parse(req.body)
    const errors = await notify(targets, { title: 'Prueba de aviso de Cartero', text: 'Si lees esto, el aviso funciona.', status: 'failed' })
    return { ok: errors.length === 0, errors }
  })
}
