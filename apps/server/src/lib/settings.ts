import { asc, eq, inArray, sql } from 'drizzle-orm'
import { config } from '../config.js'
import { db, schema } from '../db/index.js'
import type { OAuthProvider } from '../db/schema.js'
import { decrypt, encrypt } from './crypto.js'

export const PROVIDERS: OAuthProvider[] = ['google', 'github']

export interface ProviderSettings {
  enabled: boolean
  clientId: string
  /** Cifrado con la clave del servidor (enc:v1:…) */
  clientSecret: string
}

export interface InstanceSettings {
  allowRegistration: boolean
  /** Si hay dominios, las cuentas nuevas (con email o social) solo pueden ser de ellos */
  allowedDomains: string[]
  providers: Record<OAuthProvider, ProviderSettings>
}

function defaults(): InstanceSettings {
  const fromEnv = (p: OAuthProvider): ProviderSettings => {
    const { clientId, clientSecret } = config.oauth[p]
    return { enabled: !!(clientId && clientSecret), clientId: clientId ?? '', clientSecret: clientSecret ? encrypt(clientSecret) : '' }
  }
  return { allowRegistration: config.allowRegistration, allowedDomains: [], providers: { google: fromEnv('google'), github: fromEnv('github') } }
}

let cache: InstanceSettings | undefined

export async function getSettings(): Promise<InstanceSettings> {
  if (cache) return cache
  const rows = await db.select().from(schema.instanceSettings)
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<InstanceSettings>
  const base = defaults()
  cache = {
    allowRegistration: stored.allowRegistration ?? base.allowRegistration,
    allowedDomains: stored.allowedDomains ?? base.allowedDomains,
    providers: {
      google: { ...base.providers.google, ...stored.providers?.google },
      github: { ...base.providers.github, ...stored.providers?.github },
    },
  }
  return cache
}

export async function saveSettings(patch: Partial<InstanceSettings>) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    await db
      .insert(schema.instanceSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.instanceSettings.key, set: { value, updatedAt: new Date() } })
  }
  cache = undefined
  return getSettings()
}

/** Para los tests */
export function clearSettingsCache() {
  cache = undefined
}

/** Proveedor listo para usarse: activado y con credenciales. */
export async function providerCredentials(p: OAuthProvider) {
  const s = (await getSettings()).providers[p]
  if (!s.enabled || !s.clientId || !s.clientSecret) return undefined
  return { clientId: s.clientId, clientSecret: decrypt(s.clientSecret) }
}

export async function enabledProviders(): Promise<OAuthProvider[]> {
  const out: OAuthProvider[] = []
  for (const p of PROVIDERS) if (await providerCredentials(p)) out.push(p)
  return out
}

export function emailDomainAllowed(email: string, domains: string[]) {
  if (!domains.length) return true
  const domain = email.split('@').pop()?.toLowerCase() ?? ''
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`))
}

export const callbackUrl = (p: OAuthProvider) => `${config.publicUrl}/api/auth/oauth/${p}/callback`

/** Garantiza que hay al menos un admin: los de ADMIN_EMAILS y, si no hay ninguno, la cuenta más antigua. */
export async function ensureAdmin() {
  if (config.adminEmails.length)
    await db.update(schema.users).set({ role: 'admin' }).where(inArray(schema.users.email, config.adminEmails))
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users).where(eq(schema.users.role, 'admin'))
  if (count > 0) return
  const [oldest] = await db.select({ id: schema.users.id }).from(schema.users).orderBy(asc(schema.users.createdAt)).limit(1)
  if (oldest) await db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, oldest.id))
}
