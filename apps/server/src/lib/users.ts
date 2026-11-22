import { and, eq, gt, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { forbidden } from './errors.js'
import { emailDomainAllowed, getSettings, saveSettings } from './settings.js'

/** ¿Puede crearse una cuenta nueva con este email? Lanza 403 con el motivo si no. */
export async function assertCanSignUp(email: string, invitation?: string) {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users)
  if (count === 0) return { firstUser: true }
  const s = await getSettings()
  const invited = await hasInvitation(email, invitation)
  if (!s.allowRegistration && !invited) throw forbidden('El registro está desactivado')
  if (!invited && !emailDomainAllowed(email, s.allowedDomains)) throw forbidden('Tu dominio de email no puede registrarse en esta instancia')
  return { firstUser: false }
}

async function hasInvitation(email: string, token?: string) {
  const conds = [eq(sql`lower(${schema.invitations.email})`, email.toLowerCase()), gt(schema.invitations.expiresAt, new Date())]
  if (token) conds.push(eq(schema.invitations.token, token))
  const rows = await db.select({ id: schema.invitations.id }).from(schema.invitations).where(and(...conds)).limit(1)
  return rows.length > 0
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Crea el usuario con su workspace personal. La primera cuenta de la instancia es admin
 * y deja pendiente el asistente de instalación.
 */
export async function createUser(
  opts: { email: string; name: string; passwordHash: string | null; lang?: 'es' | 'en'; admin?: boolean; firstUser?: boolean },
  outer?: Tx,
) {
  if (opts.firstUser) {
    opts.admin = true
    await saveSettings({ setupCompleted: false })
  }
  const run = async (tx: Tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({
        email: opts.email.toLowerCase(),
        name: opts.name,
        passwordHash: opts.passwordHash,
        role: opts.admin ? 'admin' : 'user',
        settings: opts.lang ? { lang: opts.lang } : {},
      })
      .returning()
    const [ws] = await tx
      .insert(schema.workspaces)
      .values({ name: opts.lang === 'en' ? 'My workspace' : 'Mi workspace', type: 'personal' })
      .returning()
    await tx.insert(schema.members).values({ workspaceId: ws.id, userId: u.id, role: 'owner' })
    return u
  }
  return outer ? run(outer) : db.transaction(run)
}
