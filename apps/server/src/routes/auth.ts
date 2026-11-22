import { and, desc, eq, gt, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../config.js'
import { db, schema } from '../db/index.js'
import { createSession, destroySession, requireUser } from '../lib/auth.js'
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto.js'
import { HttpError, badRequest, forbidden, notFound } from '../lib/errors.js'

const registerBody = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(200),
  invitation: z.string().optional(),
  lang: z.enum(['es', 'en']).optional(),
})

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) })

async function acceptInvitation(token: string, userId: string, email: string) {
  const [inv] = await db
    .select()
    .from(schema.invitations)
    .where(and(eq(schema.invitations.token, token), gt(schema.invitations.expiresAt, new Date())))
    .limit(1)
  if (!inv) throw notFound('Invitación')
  if (inv.email.toLowerCase() !== email.toLowerCase()) throw forbidden('La invitación es para otro email')
  await db
    .insert(schema.members)
    .values({ workspaceId: inv.workspaceId, userId, role: inv.role })
    .onConflictDoNothing()
  await db.delete(schema.invitations).where(eq(schema.invitations.id, inv.id))
  return inv.workspaceId
}

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/config', async () => ({ allowRegistration: config.allowRegistration }))

  app.post('/api/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = registerBody.parse(req.body)
    const email = body.email.toLowerCase()
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users)
    const firstUser = count === 0
    if (!config.allowRegistration && !firstUser && !body.invitation) throw forbidden('El registro está desactivado')
    const exists = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email))
    if (exists.length) throw new HttpError(409, 'Ya existe una cuenta con ese email', 'email_taken')

    const user = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(schema.users)
        .values({ email, name: body.name, passwordHash: await hashPassword(body.password), settings: body.lang ? { lang: body.lang } : {} })
        .returning()
      const [ws] = await tx
        .insert(schema.workspaces)
        .values({ name: body.lang === 'en' ? 'My workspace' : 'Mi workspace', type: 'personal' })
        .returning()
      await tx.insert(schema.members).values({ workspaceId: ws.id, userId: u.id, role: 'owner' })
      return u
    })
    if (body.invitation) await acceptInvitation(body.invitation, user.id, email)
    await createSession(reply, user.id)
    return { id: user.id, email: user.email, name: user.name }
  })

  app.post('/api/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = loginBody.parse(req.body)
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, body.email.toLowerCase())).limit(1)
    if (!user || !(await verifyPassword(body.password, user.passwordHash)))
      throw new HttpError(401, 'Email o contraseña incorrectos', 'invalid_credentials')
    await createSession(reply, user.id)
    return { id: user.id, email: user.email, name: user.name }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply)
    return { ok: true }
  })

  app.get('/api/auth/me', async (req) => {
    const user = requireUser(req)
    const [u] = await db.select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, user.id))
    return { ...user, settings: u?.settings ?? {} }
  })

  app.patch('/api/auth/me', async (req) => {
    const user = requireUser(req)
    const body = z
      .object({
        name: z.string().min(1).max(100).optional(),
        currentPassword: z.string().optional(),
        newPassword: z.string().min(8).max(200).optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(req.body)
    const patch: Partial<typeof schema.users.$inferInsert> = {}
    if (body.name) patch.name = body.name
    if (body.settings) {
      const [u] = await db.select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, user.id))
      patch.settings = { ...(u?.settings ?? {}), ...body.settings }
    }
    if (body.newPassword) {
      const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id))
      if (!body.currentPassword || !(await verifyPassword(body.currentPassword, u.passwordHash)))
        throw badRequest('La contraseña actual no es correcta')
      patch.passwordHash = await hashPassword(body.newPassword)
    }
    if (Object.keys(patch).length) await db.update(schema.users).set(patch).where(eq(schema.users.id, user.id))
    return { ok: true }
  })

  app.post('/api/invitations/:token/accept', async (req) => {
    const user = requireUser(req)
    const { token } = req.params as { token: string }
    const workspaceId = await acceptInvitation(token, user.id, user.email)
    return { workspaceId }
  })

  app.get('/api/invitations/:token', async (req) => {
    const { token } = req.params as { token: string }
    const [row] = await db
      .select({ email: schema.invitations.email, workspace: schema.workspaces.name, role: schema.invitations.role })
      .from(schema.invitations)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.invitations.workspaceId))
      .where(and(eq(schema.invitations.token, token), gt(schema.invitations.expiresAt, new Date())))
      .limit(1)
    if (!row) throw notFound('Invitación')
    return row
  })

  // Tokens de API (CLI, integraciones)
  app.get('/api/tokens', async (req) => {
    const user = requireUser(req)
    return db
      .select({
        id: schema.apiTokens.id,
        name: schema.apiTokens.name,
        prefix: schema.apiTokens.prefix,
        lastUsedAt: schema.apiTokens.lastUsedAt,
        createdAt: schema.apiTokens.createdAt,
      })
      .from(schema.apiTokens)
      .where(eq(schema.apiTokens.userId, user.id))
      .orderBy(desc(schema.apiTokens.createdAt))
  })

  app.post('/api/tokens', async (req) => {
    const user = requireUser(req)
    const { name } = z.object({ name: z.string().min(1).max(100) }).parse(req.body)
    const token = `crt_${randomToken(24)}`
    const [row] = await db
      .insert(schema.apiTokens)
      .values({ userId: user.id, name, tokenHash: sha256(token), prefix: token.slice(0, 10) })
      .returning()
    return { id: row.id, name: row.name, token }
  })

  app.delete('/api/tokens/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    await db.delete(schema.apiTokens).where(and(eq(schema.apiTokens.id, id), eq(schema.apiTokens.userId, user.id)))
    return { ok: true }
  })
}
