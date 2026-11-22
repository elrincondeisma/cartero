import { and, asc, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../config.js'
import { db, schema } from '../db/index.js'
import { assertRole } from '../lib/access.js'
import { requireUser } from '../lib/auth.js'
import { openVariables, randomToken, sealVariables } from '../lib/crypto.js'
import { badRequest, forbidden } from '../lib/errors.js'
import { unscheduleMonitor } from '../lib/monitors.js'
import { sendMail } from '../lib/notify.js'
import { broadcast } from '../lib/realtime.js'
import { getSettings, publicUrl } from '../lib/settings.js'

const variableSchema = z.object({
  key: z.string(),
  value: z.any().optional(),
  type: z.string().optional(),
  disabled: z.boolean().optional(),
  description: z.string().optional(),
})
export const variablesSchema = z.array(variableSchema).max(5000)
const roleSchema = z.enum(['owner', 'admin', 'editor', 'viewer'])

export async function workspaceRoutes(app: FastifyInstance) {
  app.get('/api/workspaces', async (req) => {
    const user = requireUser(req)
    return db
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        type: schema.workspaces.type,
        role: schema.members.role,
      })
      .from(schema.members)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.members.workspaceId))
      .where(eq(schema.members.userId, user.id))
      .orderBy(asc(schema.workspaces.createdAt))
  })

  app.post('/api/workspaces', async (req) => {
    const user = requireUser(req)
    const { name } = z.object({ name: z.string().min(1).max(100) }).parse(req.body)
    return db.transaction(async (tx) => {
      const [ws] = await tx.insert(schema.workspaces).values({ name, type: 'team' }).returning()
      await tx.insert(schema.members).values({ workspaceId: ws.id, userId: user.id, role: 'owner' })
      return { ...ws, role: 'owner' }
    })
  })

  app.patch('/api/workspaces/:ws', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id, 'admin')
    const { name } = z.object({ name: z.string().min(1).max(100) }).parse(req.body)
    await db.update(schema.workspaces).set({ name }).where(eq(schema.workspaces.id, ws))
    return { ok: true }
  })

  app.delete('/api/workspaces/:ws', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id, 'owner')
    const [row] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, ws))
    if (row?.type === 'personal') throw badRequest('No se puede borrar el workspace personal')
    // Los monitores viven también en Redis: hay que desprogramarlos antes del borrado en cascada
    const mons = await db
      .select({ id: schema.monitors.id })
      .from(schema.monitors)
      .where(eq(schema.monitors.workspaceId, ws))
    for (const m of mons) await unscheduleMonitor(m.id).catch(() => {})
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws))
    return { ok: true }
  })

  // Globales
  app.get('/api/workspaces/:ws/globals', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id)
    const [row] = await db
      .select({ globals: schema.workspaces.globals })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ws))
    return openVariables(row?.globals ?? [])
  })

  app.put('/api/workspaces/:ws/globals', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id, 'editor')
    const values = variablesSchema.parse(req.body)
    await db
      .update(schema.workspaces)
      .set({
        globals: sealVariables(values),
        globalsVersion: sql`${schema.workspaces.globalsVersion} + 1`,
        globalsUpdatedAt: new Date(),
      })
      .where(eq(schema.workspaces.id, ws))
    broadcast(ws, { type: 'environments.changed', environmentId: 'globals', by: user.id })
    return { ok: true }
  })

  // Miembros
  app.get('/api/workspaces/:ws/members', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id)
    const members = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.members.role,
      })
      .from(schema.members)
      .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
      .where(eq(schema.members.workspaceId, ws))
      .orderBy(asc(schema.members.createdAt))
    const invitations = await db
      .select({
        id: schema.invitations.id,
        email: schema.invitations.email,
        role: schema.invitations.role,
        expiresAt: schema.invitations.expiresAt,
      })
      .from(schema.invitations)
      .where(eq(schema.invitations.workspaceId, ws))
    return { members, invitations }
  })

  app.post('/api/workspaces/:ws/invitations', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    const myRole = await assertRole(ws, user.id, 'admin')
    const body = z.object({ email: z.string().email(), role: roleSchema.exclude(['owner']) }).parse(req.body)
    if (body.role === 'admin' && myRole !== 'owner')
      throw forbidden('Solo el propietario puede invitar administradores')
    const token = randomToken(24)
    const [inv] = await db
      .insert(schema.invitations)
      .values({
        workspaceId: ws,
        email: body.email.toLowerCase(),
        role: body.role,
        token,
        invitedBy: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
      })
      .returning()
    const [w] = await db
      .select({ name: schema.workspaces.name })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ws))
    const link = `${await publicUrl()}/invite/${token}`
    const sent = await sendMail(
      body.email,
      `${user.name} te invita a «${w.name}» en ${(await getSettings()).instanceName}`,
      `${user.name} te ha invitado al workspace «${w.name}» como ${body.role}.\n\nAcepta la invitación aquí: ${link}\n\nCaduca en 7 días.`,
    )
    return { id: inv.id, link, emailSent: sent }
  })

  app.delete('/api/workspaces/:ws/invitations/:id', async (req) => {
    const user = requireUser(req)
    const { ws, id } = req.params as { ws: string; id: string }
    await assertRole(ws, user.id, 'admin')
    await db
      .delete(schema.invitations)
      .where(and(eq(schema.invitations.id, id), eq(schema.invitations.workspaceId, ws)))
    return { ok: true }
  })

  app.patch('/api/workspaces/:ws/members/:userId', async (req) => {
    const user = requireUser(req)
    const { ws, userId } = req.params as { ws: string; userId: string }
    const myRole = await assertRole(ws, user.id, 'admin')
    const { role } = z.object({ role: roleSchema }).parse(req.body)
    const target = await assertRole(ws, userId).catch(() => undefined)
    if (!target) throw badRequest('El usuario no es miembro')
    if ((role === 'owner' || target === 'owner' || role === 'admin') && myRole !== 'owner')
      throw forbidden('Solo el propietario puede cambiar ese rol')
    if (target === 'owner' && role !== 'owner') {
      const owners = await db
        .select()
        .from(schema.members)
        .where(and(eq(schema.members.workspaceId, ws), eq(schema.members.role, 'owner')))
      if (owners.length <= 1) throw badRequest('El workspace necesita al menos un propietario')
    }
    await db
      .update(schema.members)
      .set({ role })
      .where(and(eq(schema.members.workspaceId, ws), eq(schema.members.userId, userId)))
    return { ok: true }
  })

  app.delete('/api/workspaces/:ws/members/:userId', async (req) => {
    const user = requireUser(req)
    const { ws, userId } = req.params as { ws: string; userId: string }
    if (userId !== user.id) await assertRole(ws, user.id, 'admin')
    const target = await assertRole(ws, userId).catch(() => undefined)
    if (target === 'owner') {
      const owners = await db
        .select()
        .from(schema.members)
        .where(and(eq(schema.members.workspaceId, ws), eq(schema.members.role, 'owner')))
      if (owners.length <= 1) throw badRequest('El workspace necesita al menos un propietario')
    }
    await db
      .delete(schema.members)
      .where(and(eq(schema.members.workspaceId, ws), eq(schema.members.userId, userId)))
    return { ok: true }
  })
}
