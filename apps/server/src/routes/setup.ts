import { sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { db, schema } from '../db/index.js'
import { createSession } from '../lib/auth.js'
import { hashPassword } from '../lib/crypto.js'
import { HttpError } from '../lib/errors.js'
import { getSettings, saveSettings } from '../lib/settings.js'
import { createUser } from '../lib/users.js'

/** URL con la que el navegador ha llegado al servidor (detrás de un proxy, la del proxy). */
function detectedUrl(req: FastifyRequest) {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || req.protocol
  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() || req.headers.host
  return host ? `${proto}://${host}` : undefined
}

const usersCount = async () => {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users)
  return n
}

/** Asistente de instalación: solo sirve mientras la instancia no tiene ninguna cuenta. */
export async function setupRoutes(app: FastifyInstance) {
  app.get('/api/setup', async (req) => {
    const needsSetup = (await usersCount()) === 0
    const s = await getSettings()
    return {
      needsSetup,
      setupCompleted: s.setupCompleted !== false,
      // Comprobaciones del servidor: solo antes de crear la primera cuenta (después, en Administración → Sistema)
      ...(needsSetup
        ? {
            detectedUrl: detectedUrl(req),
            publicUrl: s.publicUrl,
            secretKeyFromEnv: !!process.env.CARTERO_SECRET_KEY,
            production: process.env.NODE_ENV === 'production',
          }
        : {}),
    }
  })

  app.post('/api/setup/admin', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(100),
        email: z.string().trim().toLowerCase().email().max(200),
        password: z.string().min(8).max(200),
        lang: z.enum(['es', 'en']).optional(),
        instanceName: z.string().trim().min(1).max(60).optional(),
        publicUrl: z.string().trim().url().optional(),
      })
      .parse(req.body)
    const passwordHash = await hashPassword(body.password)
    // Bloqueo para que dos personas no creen a la vez «la primera cuenta»
    const user = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(727274)`)
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.users)
      if (n > 0) throw new HttpError(409, 'Esta instancia ya está instalada: inicia sesión', 'already_setup')
      await saveSettings({
        setupCompleted: false,
        instanceName: body.instanceName,
        publicUrl: body.publicUrl?.replace(/\/+$/, ''),
      })
      return createUser({ email: body.email, name: body.name, passwordHash, lang: body.lang, admin: true }, tx)
    })
    await createSession(reply, user.id)
    return { id: user.id, email: user.email, name: user.name }
  })
}
