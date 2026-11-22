import { createHash, randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { config } from '../config.js'
import { db, schema } from '../db/index.js'
import type { OAuthProvider } from '../db/schema.js'
import { createSession, resolveUser } from '../lib/auth.js'
import { decrypt, encrypt } from '../lib/crypto.js'
import { HttpError } from '../lib/errors.js'
import { PROVIDERS, callbackUrl, providerCredentials } from '../lib/settings.js'
import { assertCanSignUp, createUser } from '../lib/users.js'
import { acceptInvitation } from './auth.js'

const STATE_COOKIE = 'cartero_oauth'
const STATE_MS = 10 * 60 * 1000

interface OAuthState {
  provider: OAuthProvider
  state: string
  verifier: string
  next: string
  invitation?: string
  lang?: 'es' | 'en'
  /** Vincular a la cuenta con la sesión abierta en lugar de iniciar sesión */
  linkTo?: string
  exp: number
}

export interface Profile {
  id: string
  email: string
  emailVerified: boolean
  name: string
}

const b64url = (b: Buffer) => b.toString('base64url')

/** Endpoints de cada proveedor. */
const PROVIDER = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    async profile(accessToken: string): Promise<Profile> {
      const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}` } })
      if (!r.ok) throw new Error(`userinfo ${r.status}`)
      const u = (await r.json()) as { sub: string; email?: string; email_verified?: boolean; name?: string }
      return { id: u.sub, email: (u.email ?? '').toLowerCase(), emailVerified: !!u.email_verified, name: u.name || u.email?.split('@')[0] || 'Google' }
    },
  },
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    async profile(accessToken: string): Promise<Profile> {
      const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json', 'user-agent': 'Cartero' }
      const r = await fetch('https://api.github.com/user', { headers })
      if (!r.ok) throw new Error(`user ${r.status}`)
      const u = (await r.json()) as { id: number; login: string; name?: string | null }
      // El email del perfil puede ser privado: el primario verificado sale de /user/emails
      const er = await fetch('https://api.github.com/user/emails', { headers })
      const emails = er.ok ? ((await er.json()) as { email: string; primary: boolean; verified: boolean }[]) : []
      const best = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified)
      return { id: String(u.id), email: (best?.email ?? '').toLowerCase(), emailVerified: !!best, name: u.name || u.login }
    },
  },
} satisfies Record<OAuthProvider, unknown>

/** Vuelve a la app con el motivo; al vincular desde Ajustes se vuelve a la app, si no, al login. */
function fail(reply: FastifyReply, code: string, linking = false) {
  reply.clearCookie(STATE_COOKIE, { path: '/api/auth/oauth' })
  return reply.redirect(`${linking ? '/' : '/login'}?oauth_error=${code}`)
}

const safeNext = (n?: string) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/')

export async function oauthRoutes(app: FastifyInstance) {
  app.get('/api/auth/oauth/:provider', async (req, reply) => {
    const { provider } = z.object({ provider: z.enum(PROVIDERS as [OAuthProvider, ...OAuthProvider[]]) }).parse(req.params)
    const q = z
      .object({ next: z.string().optional(), invitation: z.string().optional(), lang: z.enum(['es', 'en']).optional(), link: z.string().optional() })
      .parse(req.query)
    const creds = await providerCredentials(provider)
    if (!creds) return fail(reply, 'provider_disabled')
    const current = q.link ? await resolveUser(req) : undefined

    const st: OAuthState = {
      provider,
      state: b64url(randomBytes(24)),
      verifier: b64url(randomBytes(32)),
      next: safeNext(q.next),
      invitation: q.invitation,
      lang: q.lang,
      linkTo: current?.id,
      exp: Date.now() + STATE_MS,
    }
    reply.setCookie(STATE_COOKIE, encrypt(JSON.stringify(st)), {
      path: '/api/auth/oauth',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      maxAge: STATE_MS / 1000,
    })
    const p = PROVIDER[provider]
    const url = new URL(p.authorize)
    url.searchParams.set('client_id', creds.clientId)
    url.searchParams.set('redirect_uri', callbackUrl(provider))
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', p.scope)
    url.searchParams.set('state', st.state)
    url.searchParams.set('code_challenge', b64url(createHash('sha256').update(st.verifier).digest()))
    url.searchParams.set('code_challenge_method', 'S256')
    if (provider === 'google') url.searchParams.set('prompt', 'select_account')
    return reply.redirect(url.toString())
  })

  app.get('/api/auth/oauth/:provider/callback', async (req, reply) => {
    const { provider } = z.object({ provider: z.enum(PROVIDERS as [OAuthProvider, ...OAuthProvider[]]) }).parse(req.params)
    const q = req.query as { code?: string; state?: string; error?: string }

    let st: OAuthState | undefined
    try {
      const raw = req.cookies[STATE_COOKIE]
      if (raw) st = JSON.parse(decrypt(raw)) as OAuthState
    } catch {
      st = undefined
    }
    if (!st || st.provider !== provider || st.exp < Date.now() || !q.state || q.state !== st.state) return fail(reply, 'invalid_state')
    const linking = !!st.linkTo
    if (q.error || !q.code) return fail(reply, q.error === 'access_denied' ? 'cancelled' : 'provider_error', linking)
    const creds = await providerCredentials(provider)
    if (!creds) return fail(reply, 'provider_disabled', linking)

    let profile: Profile
    try {
      const body = new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code: q.code,
        redirect_uri: callbackUrl(provider),
        grant_type: 'authorization_code',
        code_verifier: st.verifier,
      })
      const tr = await fetch(PROVIDER[provider].token, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body,
      })
      const tok = (await tr.json().catch(() => ({}))) as { access_token?: string; error?: string }
      if (!tr.ok || !tok.access_token) throw new Error(tok.error ?? `token ${tr.status}`)
      profile = await PROVIDER[provider].profile(tok.access_token)
    } catch (e) {
      req.log.warn({ err: (e as Error).message, provider }, 'OAuth: fallo al hablar con el proveedor')
      return fail(reply, 'provider_error', linking)
    }
    if (!profile.email || !profile.emailVerified) return fail(reply, 'email_unverified', linking)

    try {
      const userId = await resolveOAuthUser(provider, profile, st)
      reply.clearCookie(STATE_COOKIE, { path: '/api/auth/oauth' })
      if (linking) return reply.redirect(`/?oauth_linked=${provider}`)
      await createSession(reply, userId)
      return reply.redirect(st.next)
    } catch (e) {
      if (e instanceof HttpError) return fail(reply, e.code ?? 'forbidden', linking)
      throw e
    }
  })
}

/**
 * Decide a qué usuario corresponde el perfil:
 * 1. Cuenta ya vinculada → esa.
 * 2. Vincular desde Ajustes → al usuario con la sesión abierta.
 * 3. Email verificado de una cuenta existente → se vincula a ella.
 * 4. Si no, cuenta nueva (si el registro, el dominio o una invitación lo permiten).
 */
export async function resolveOAuthUser(provider: OAuthProvider, profile: Profile, st: Pick<OAuthState, 'linkTo' | 'invitation' | 'lang'>) {
  const [linked] = await db
    .select({ userId: schema.identities.userId, disabled: schema.users.disabled })
    .from(schema.identities)
    .innerJoin(schema.users, eq(schema.users.id, schema.identities.userId))
    .where(and(eq(schema.identities.provider, provider), eq(schema.identities.providerUserId, profile.id)))
    .limit(1)
  if (st.linkTo) {
    if (linked && linked.userId !== st.linkTo) throw new HttpError(409, 'Esa cuenta ya está vinculada a otro usuario', 'already_linked')
    await db.insert(schema.identities).values({ provider, providerUserId: profile.id, userId: st.linkTo, email: profile.email }).onConflictDoNothing()
    return st.linkTo
  }
  if (linked) {
    if (linked.disabled) throw new HttpError(403, 'Tu cuenta está desactivada', 'account_disabled')
    return linked.userId
  }

  const [byEmail] = await db.select().from(schema.users).where(eq(schema.users.email, profile.email)).limit(1)
  let userId: string
  if (byEmail) {
    if (byEmail.disabled) throw new HttpError(403, 'Tu cuenta está desactivada', 'account_disabled')
    userId = byEmail.id
  } else {
    let firstUser: boolean
    try {
      ;({ firstUser } = await assertCanSignUp(profile.email, st.invitation))
    } catch (e) {
      const msg = (e as Error).message
      throw new HttpError(403, msg, msg.includes('dominio') ? 'domain_not_allowed' : 'registration_closed')
    }
    const u = await createUser({ email: profile.email, name: profile.name, passwordHash: null, lang: st.lang, admin: firstUser })
    userId = u.id
  }
  await db.insert(schema.identities).values({ provider, providerUserId: profile.id, userId, email: profile.email }).onConflictDoNothing()
  if (st.invitation) await acceptInvitation(st.invitation, userId, profile.email).catch(() => undefined)
  return userId
}
