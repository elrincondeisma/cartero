import { and, desc, eq, ilike, inArray, max, ne, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, schema } from '../db/index.js'
import type { OAuthProvider } from '../db/schema.js'
import { requireAdmin } from '../lib/auth.js'
import { decrypt, encrypt } from '../lib/crypto.js'
import { unscheduleMonitor } from '../lib/monitors.js'
import { badRequest, notFound } from '../lib/errors.js'
import { config } from '../config.js'
import { sendTestMail } from '../lib/notify.js'
import { PROVIDERS, callbackUrl, getSettings, saveSettings, smtpConfig } from '../lib/settings.js'
import { pingRedis } from '../lib/monitors.js'
import { triggerUpdate, updateStatus } from '../lib/updates.js'

const providerPatch = z.object({
  enabled: z.boolean().optional(),
  clientId: z.string().trim().max(500).optional(),
  /** undefined: no cambia · '': lo borra · texto: lo sustituye */
  clientSecret: z.string().max(500).optional(),
})

const settingsPatch = z.object({
  instanceName: z.string().trim().min(1).max(60).optional(),
  publicUrl: z
    .string()
    .trim()
    .url('URL no válida')
    .regex(/^https?:\/\//, 'La URL tiene que empezar por http:// o https://')
    .transform((u) => u.replace(/\/+$/, ''))
    .optional(),
  allowRegistration: z.boolean().optional(),
  allowedDomains: z
    .array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'Dominio no válido'))
    .max(50)
    .optional(),
  providers: z.object({ google: providerPatch.optional(), github: providerPatch.optional() }).optional(),
  /** url: undefined no cambia · '' la borra · texto la sustituye */
  smtp: z.object({ url: z.string().trim().max(1000).optional(), from: z.string().trim().max(200).optional() }).optional(),
  blockPrivateNetworks: z.boolean().optional(),
  updates: z.object({ check: z.boolean().optional(), auto: z.boolean().optional() }).optional(),
  setupCompleted: z.boolean().optional(),
})

/** Ajustes para el panel: los secretos nunca salen del servidor. */
export async function publicSettings() {
  const s = await getSettings()
  const providers: Record<string, unknown> = {}
  for (const p of PROVIDERS)
    providers[p] = { enabled: s.providers[p].enabled, clientId: s.providers[p].clientId, hasSecret: !!s.providers[p].clientSecret, callbackUrl: await callbackUrl(p) }
  let smtpHost = ''
  if (s.smtp.url)
    try {
      smtpHost = new URL(decrypt(s.smtp.url)).host
    } catch {
      smtpHost = ''
    }
  return {
    instanceName: s.instanceName,
    publicUrl: s.publicUrl,
    allowRegistration: s.allowRegistration,
    allowedDomains: s.allowedDomains,
    providers,
    smtp: { configured: !!s.smtp.url, host: smtpHost, from: s.smtp.from },
    blockPrivateNetworks: s.blockPrivateNetworks,
    updates: s.updates,
    setupCompleted: s.setupCompleted !== false,
  }
}

async function adminCount(exceptId?: string) {
  const conds = [eq(schema.users.role, 'admin'), eq(schema.users.disabled, false)]
  if (exceptId) conds.push(ne(schema.users.id, exceptId))
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(and(...conds))
  return n
}

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/stats', async (req) => {
    requireAdmin(req)
    const count = async (t: any, where?: any) => {
      const q = db.select({ n: sql<number>`count(*)::int` }).from(t)
      const [{ n }] = await (where ? q.where(where) : q)
      return n
    }
    return {
      users: await count(schema.users),
      admins: await count(schema.users, eq(schema.users.role, 'admin')),
      workspaces: await count(schema.workspaces),
      collections: await count(schema.collections),
      runs24h: await count(schema.runs, sql`${schema.runs.startedAt} > now() - interval '24 hours'`),
    }
  })

  app.get('/api/admin/settings', async (req) => {
    requireAdmin(req)
    return publicSettings()
  })

  app.patch('/api/admin/settings', async (req) => {
    requireAdmin(req)
    const body = settingsPatch.parse(req.body)
    const current = await getSettings()
    const providers = { ...current.providers }
    for (const p of PROVIDERS) {
      const patch = body.providers?.[p]
      if (!patch) continue
      const next = { ...providers[p] }
      if (patch.clientId !== undefined) next.clientId = patch.clientId
      if (patch.clientSecret !== undefined) next.clientSecret = patch.clientSecret ? encrypt(patch.clientSecret.trim()) : ''
      if (patch.enabled !== undefined) next.enabled = patch.enabled
      if (next.enabled && (!next.clientId || !next.clientSecret)) throw badRequest('Para activar un proveedor necesitas el Client ID y el Client secret')
      providers[p as OAuthProvider] = next
    }
    let smtp: typeof current.smtp | undefined
    if (body.smtp) {
      smtp = { ...current.smtp }
      if (body.smtp.url !== undefined) {
        if (body.smtp.url && !/^smtps?:\/\//.test(body.smtp.url)) throw badRequest('La URL SMTP tiene que empezar por smtp:// o smtps://')
        smtp.url = body.smtp.url ? encrypt(body.smtp.url) : ''
      }
      if (body.smtp.from !== undefined) smtp.from = body.smtp.from
    }
    await saveSettings({
      instanceName: body.instanceName,
      publicUrl: body.publicUrl,
      smtp,
      blockPrivateNetworks: body.blockPrivateNetworks,
      updates: body.updates ? { ...current.updates, ...body.updates } : undefined,
      setupCompleted: body.setupCompleted,
      allowRegistration: body.allowRegistration,
      allowedDomains: body.allowedDomains ? [...new Set(body.allowedDomains)] : undefined,
      providers: body.providers ? providers : undefined,
    })
    return publicSettings()
  })

  // Envía un email de prueba con la configuración guardada o con la que se está escribiendo
  app.post('/api/admin/test-email', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const me = requireAdmin(req)
    const body = z.object({ url: z.string().trim().optional(), from: z.string().trim().optional(), to: z.string().email().optional() }).parse(req.body ?? {})
    const saved = await smtpConfig()
    const url = body.url || saved?.url
    if (!url) throw badRequest('Escribe la URL SMTP antes de probarla')
    const { instanceName } = await getSettings()
    const from = body.from || saved?.from || config.smtpFrom
    try {
      await sendTestMail({ url, from }, body.to ?? me.email, `${instanceName}: email de prueba / test email`, 'Si lees esto, el email de Cartero funciona. / If you can read this, Cartero email works.')
    } catch (e) {
      throw badRequest(`El servidor de correo respondió: ${(e as Error).message}`)
    }
    return { ok: true, to: body.to ?? me.email }
  })

  // Versiones: la instalada, la última publicada y si se puede actualizar desde aquí
  app.get('/api/admin/updates', async (req) => {
    requireAdmin(req)
    const { refresh } = z.object({ refresh: z.string().optional() }).parse(req.query)
    return updateStatus({ refresh: refresh === '1' })
  })

  app.post('/api/admin/updates/apply', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const admin = requireAdmin(req)
    await triggerUpdate()
    req.log.info(`Actualización pedida por ${admin.email}`)
    return updateStatus()
  })

  // Estado del servidor: lo que no se puede cambiar desde el panel (variables de entorno)
  app.get('/api/admin/system', async (req) => {
    requireAdmin(req)
    let database = false
    try {
      await db.execute(sql`select 1`)
      database = true
    } catch {}
    let redis = false
    try {
      redis = await pingRedis()
    } catch {}
    return {
      version: config.version,
      node: process.version,
      database,
      redis,
      inlineWorker: config.inlineWorker,
      secretKeyFromEnv: !!process.env.CARTERO_SECRET_KEY,
      production: process.env.NODE_ENV === 'production',
      secureCookies: config.secureCookies,
      filesDir: config.filesDir,
      envPublicUrl: config.publicUrl,
    }
  })

  app.get('/api/admin/users', async (req) => {
    requireAdmin(req)
    const { q } = z.object({ q: z.string().optional() }).parse(req.query)
    const rows = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.users.role,
        disabled: schema.users.disabled,
        hasPassword: sql<boolean>`${schema.users.passwordHash} is not null`,
        createdAt: schema.users.createdAt,
        lastSeenAt: max(schema.sessions.createdAt),
      })
      .from(schema.users)
      .leftJoin(schema.sessions, eq(schema.sessions.userId, schema.users.id))
      .where(q ? or(ilike(schema.users.email, `%${q}%`), ilike(schema.users.name, `%${q}%`)) : undefined)
      .groupBy(schema.users.id)
      .orderBy(desc(schema.users.createdAt))
      .limit(500)
    const ids = rows.length
      ? await db
          .select({ userId: schema.identities.userId, provider: schema.identities.provider })
          .from(schema.identities)
          .where(inArray(schema.identities.userId, rows.map((r) => r.id)))
      : []
    return rows.map((r) => ({ ...r, providers: ids.filter((i) => i.userId === r.id).map((i) => i.provider) }))
  })

  app.patch('/api/admin/users/:id', async (req) => {
    const me = requireAdmin(req)
    const { id } = req.params as { id: string }
    const body = z.object({ role: z.enum(['admin', 'user']).optional(), disabled: z.boolean().optional() }).parse(req.body)
    const [target] = await db.select({ id: schema.users.id, role: schema.users.role }).from(schema.users).where(eq(schema.users.id, id))
    if (!target) throw notFound('Usuario')
    const losesAdmin = (body.role === 'user' || body.disabled === true) && target.role === 'admin'
    if (id === me.id && losesAdmin) throw badRequest('No puedes quitarte el rol de admin ni desactivar tu propia cuenta')
    if (losesAdmin && (await adminCount(id)) === 0) throw badRequest('Tiene que quedar al menos un administrador')
    await db.update(schema.users).set(body).where(eq(schema.users.id, id))
    // Al desactivar, se cierran sus sesiones
    if (body.disabled) await db.delete(schema.sessions).where(eq(schema.sessions.userId, id))
    return { ok: true }
  })

  app.delete('/api/admin/users/:id', async (req) => {
    const me = requireAdmin(req)
    const { id } = req.params as { id: string }
    if (id === me.id) throw badRequest('No puedes borrar tu propia cuenta desde aquí')
    const [target] = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, id))
    if (!target) throw notFound('Usuario')
    if (target.role === 'admin' && (await adminCount(id)) === 0) throw badRequest('Tiene que quedar al menos un administrador')
    // Sus workspaces personales se van con él; los de equipo se quedan con el resto de miembros
    const personal = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .innerJoin(schema.members, eq(schema.members.workspaceId, schema.workspaces.id))
      .where(and(eq(schema.members.userId, id), eq(schema.workspaces.type, 'personal')))
    const wsIds = personal.map((w) => w.id)
    if (wsIds.length) {
      const mons = await db.select({ id: schema.monitors.id }).from(schema.monitors).where(inArray(schema.monitors.workspaceId, wsIds))
      for (const m of mons) await unscheduleMonitor(m.id).catch(() => {})
    }
    await db.transaction(async (tx) => {
      if (wsIds.length) await tx.delete(schema.workspaces).where(inArray(schema.workspaces.id, wsIds))
      await tx.delete(schema.users).where(eq(schema.users.id, id))
    })
    return { ok: true }
  })
}
