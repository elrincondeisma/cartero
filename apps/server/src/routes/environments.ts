import { exportPostmanEnvironment } from '@cartero/exporters'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, schema } from '../db/index.js'
import { assertRole } from '../lib/access.js'
import { requireUser } from '../lib/auth.js'
import { openVariables, sealVariables } from '../lib/crypto.js'
import { conflict, notFound } from '../lib/errors.js'
import { broadcast } from '../lib/realtime.js'
import { recordDeletions } from '../lib/sync.js'
import { variablesSchema } from './workspaces.js'

async function envOf(id: string) {
  const [env] = await db.select().from(schema.environments).where(eq(schema.environments.id, id))
  if (!env) throw notFound('Entorno')
  return env
}

export async function environmentRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:ws/environments', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id)
    const rows = await db
      .select()
      .from(schema.environments)
      .where(eq(schema.environments.workspaceId, ws))
      .orderBy(asc(schema.environments.name))
    return rows.map((r) => ({ ...r, values: openVariables(r.values) }))
  })

  app.post('/api/workspaces/:ws/environments', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id, 'editor')
    const body = z
      .object({ name: z.string().min(1).max(200), values: variablesSchema.optional() })
      .parse(req.body)
    const [row] = await db
      .insert(schema.environments)
      .values({ workspaceId: ws, name: body.name, values: sealVariables(body.values ?? []) })
      .returning()
    broadcast(ws, { type: 'environments.changed', environmentId: row.id, by: user.id })
    return { ...row, values: openVariables(row.values) }
  })

  app.put('/api/environments/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const env = await envOf(id)
    await assertRole(env.workspaceId, user.id, 'editor')
    const body = z
      .object({
        name: z.string().min(1).max(200).optional(),
        values: variablesSchema.optional(),
        version: z.number().int().optional(),
      })
      .parse(req.body)
    if (body.version !== undefined && body.version !== env.version)
      throw conflict('Otra persona ha modificado este entorno. Recarga para ver los cambios.')
    const [row] = await db
      .update(schema.environments)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.values ? { values: sealVariables(body.values) } : {}),
        version: sql`${schema.environments.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.environments.id, id))
      .returning()
    broadcast(env.workspaceId, { type: 'environments.changed', environmentId: id, by: user.id })
    return { ...row, values: openVariables(row.values) }
  })

  app.post('/api/environments/:id/duplicate', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const env = await envOf(id)
    await assertRole(env.workspaceId, user.id, 'editor')
    const [row] = await db
      .insert(schema.environments)
      .values({ workspaceId: env.workspaceId, name: `${env.name} (copia)`, values: env.values })
      .returning()
    broadcast(env.workspaceId, { type: 'environments.changed', environmentId: row.id, by: user.id })
    return row
  })

  app.delete('/api/environments/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const env = await envOf(id)
    await assertRole(env.workspaceId, user.id, 'editor')
    await db.delete(schema.environments).where(and(eq(schema.environments.id, id)))
    await recordDeletions(env.workspaceId, 'environment', [id])
    broadcast(env.workspaceId, { type: 'environments.changed', environmentId: id, by: user.id })
    return { ok: true }
  })

  app.get('/api/environments/:id/export', async (req, reply) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const env = await envOf(id)
    await assertRole(env.workspaceId, user.id)
    reply.header(
      'content-disposition',
      `attachment; filename="${encodeURIComponent(env.name)}.postman_environment.json"`,
    )
    return exportPostmanEnvironment({ id: env.id, name: env.name, values: openVariables(env.values) })
  })
}
