import { and, desc, eq, gt, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../config.js'
import { db, schema } from '../db/index.js'
import { createSession, destroySession, requireUser } from '../lib/auth.js'
import { enabledProviders, getSettings } from '../lib/settings.js'
import { assertCanSignUp, createUser } from '../lib/users.js'
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

export async function acceptInvitation(token: string, userId: string, email: string) {
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
  app.get('/api/auth/config', async () => {
    const s = await getSettings()
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users)
    return { allowRegistration: s.allowRegistration, providers: await enabledProviders(), instanceName: s.instanceName, needsSetup: count === 0 }
  })

  app.post('/api/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = registerBody.parse(req.body)
    const email = body.email.toLowerCase()
    const { firstUser } = await assertCanSignUp(email, body.invitation)
    const exists = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email))
    if (exists.length) throw new HttpError(409, 'Ya existe una cuenta con ese email', 'email_taken')

    const user = await createUser({ email, name: body.name, passwordHash: await hashPassword(body.password), lang: body.lang, firstUser })
    if (body.invitation) await acceptInvitation(body.invitation, user.id, email)
    await createSession(reply, user.id)
    return { id: user.id, email: user.email, name: user.name }
  })

  app.post('/api/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = loginBody.parse(req.body)
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, body.email.toLowerCase())).limit(1)
    if (!user || !user.passwordHash || !(await verifyPassword(body.password, user.passwordHash)))
      throw new HttpError(401, 'Email o contraseña incorrectos', 'invalid_credentials')
    if (user.disabled) throw forbidden('Tu cuenta está desactivada. Habla con un administrador.')
    await createSession(reply, user.id)
    return { id: user.id, email: user.email, name: user.name }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply)
    return { ok: true }
  })

  app.get('/api/auth/me', async (req) => {
    const user = requireUser(req)
    const [u] = await db
      .select({ settings: schema.users.settings, passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
    const ids = await db
      .select({ provider: schema.identities.provider, email: schema.identities.email })
      .from(schema.identities)
      .where(eq(schema.identities.userId, user.id))
    return { ...user, settings: u?.settings ?? {}, hasPassword: !!u?.passwordHash, identities: ids }
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
      // Las cuentas creadas con Google o GitHub pueden poner su primera contraseña sin la actual
      if (u.passwordHash && (!body.currentPassword || !(await verifyPassword(body.currentPassword, u.passwordHash))))
        throw badRequest('La contraseña actual no es correcta')
      patch.passwordHash = await hashPassword(body.newPassword)
    }
    if (Object.keys(patch).length) await db.update(schema.users).set(patch).where(eq(schema.users.id, user.id))
    return { ok: true }
  })

  // Desvincular una cuenta de Google o GitHub (sin quedarse sin forma de entrar)
  app.delete('/api/auth/identities/:provider', async (req) => {
    const user = requireUser(req)
    const { provider } = req.params as { provider: string }
    const [u] = await db.select({ passwordHash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, user.id))
    const ids = await db.select({ provider: schema.identities.provider }).from(schema.identities).where(eq(schema.identities.userId, user.id))
    if (!u?.passwordHash && ids.filter((i) => i.provider !== provider).length === 0)
      throw badRequest('Pon una contraseña antes de desvincular tu única forma de entrar')
    await db.delete(schema.identities).where(and(eq(schema.identities.userId, user.id), eq(schema.identities.provider, provider as 'google' | 'github')))
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
