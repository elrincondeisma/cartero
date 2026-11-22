import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgres://cartero:cartero@localhost:5433/cartero_test'
process.env.LOG_LEVEL = 'silent'

const { buildApp } = await import('./app.js')
const { runMigrations } = await import('./db/migrate.js')
const { sqlClient } = await import('./db/index.js')
const { clearSettingsCache, ensureAdmin } = await import('./lib/settings.js')

let app: FastifyInstance

/** Cliente con tarro de cookies (el flujo OAuth usa dos: estado y sesión). */
class Client {
  jar = new Map<string, string>()
  async req(method: string, url: string, body?: unknown) {
    const res = await app.inject({
      method: method as any,
      url,
      headers: this.jar.size ? { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {},
      payload: body as any,
    })
    const set = res.headers['set-cookie']
    for (const c of Array.isArray(set) ? set : set ? [set] : []) {
      const [pair, ...attrs] = c.split(';')
      const i = pair.indexOf('=')
      const k = pair.slice(0, i)
      const v = pair.slice(i + 1)
      if (!v || attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a))) this.jar.delete(k)
      else this.jar.set(k, v)
    }
    let json: any
    try {
      json = JSON.parse(res.body)
    } catch {
      json = res.body
    }
    return { status: res.statusCode, body: json, headers: res.headers }
  }
}

const register = async (email: string, name = email.split('@')[0]) => {
  const c = new Client()
  const r = await c.req('POST', '/api/auth/register', { email, name, password: 'password123' })
  return { c, r }
}

/** Simula a Google: token y perfil. */
function fakeGoogle(profile: { sub: string; email: string; email_verified?: boolean; name?: string }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = String(input)
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(String(init?.body))
      expect(body.get('code')).toBe('the-code')
      expect(body.get('client_secret')).toBe('g-secret')
      expect(body.get('code_verifier')).toBeTruthy()
      return new Response(JSON.stringify({ access_token: 'at-123' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo')
      return new Response(JSON.stringify({ email_verified: true, ...profile }), { status: 200, headers: { 'content-type': 'application/json' } })
    throw new Error(`fetch inesperado: ${url}`)
  })
}

/** Recorre el flujo: /oauth/google → (Google) → /callback. Devuelve la redirección final. */
async function googleLogin(c: Client, query = '') {
  const start = await c.req('GET', `/api/auth/oauth/google${query}`)
  expect(start.status).toBe(302)
  const auth = new URL(start.headers.location as string)
  const state = auth.searchParams.get('state')
  const cb = await c.req('GET', `/api/auth/oauth/google/callback?code=the-code&state=${state}`)
  expect(cb.status).toBe(302)
  return { start: auth, location: cb.headers.location as string }
}

let admin: Client
let bob: Client
let bobId = ''

beforeAll(async () => {
  await sqlClient.unsafe('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;')
  await runMigrations()
  clearSettingsCache()
  app = await buildApp({ logger: false })
})

afterAll(async () => {
  vi.restoreAllMocks()
  await app?.close()
  await sqlClient.end()
})

describe('roles de la instancia', () => {
  it('la primera cuenta es admin y las siguientes usuarios', async () => {
    ;({ c: admin } = await register('root@cartero.dev', 'Root'))
    const me = await admin.req('GET', '/api/auth/me')
    expect(me.body.role).toBe('admin')
    expect(me.body.hasPassword).toBe(true)
    ;({ c: bob } = await register('bob@cartero.dev', 'Bob'))
    const bm = await bob.req('GET', '/api/auth/me')
    expect(bm.body.role).toBe('user')
    bobId = bm.body.id
  })

  it('un usuario normal no entra en la administración', async () => {
    for (const url of ['/api/admin/settings', '/api/admin/users', '/api/admin/stats']) expect((await bob.req('GET', url)).status).toBe(403)
    expect((await bob.req('PATCH', '/api/admin/settings', { allowRegistration: false })).status).toBe(403)
    expect((await new Client().req('GET', '/api/admin/users')).status).toBe(401)
  })

  it('el admin lista usuarios y estadísticas', async () => {
    const users = await admin.req('GET', '/api/admin/users')
    expect(users.body.map((u: any) => u.email).sort()).toEqual(['bob@cartero.dev', 'root@cartero.dev'])
    expect((await admin.req('GET', '/api/admin/users?q=bob')).body).toHaveLength(1)
    const stats = await admin.req('GET', '/api/admin/stats')
    expect(stats.body).toMatchObject({ users: 2, admins: 1, workspaces: 2 })
  })

  it('protege contra quedarse sin admins', async () => {
    const meId = (await admin.req('GET', '/api/auth/me')).body.id
    expect((await admin.req('PATCH', `/api/admin/users/${meId}`, { role: 'user' })).status).toBe(400)
    expect((await admin.req('PATCH', `/api/admin/users/${meId}`, { disabled: true })).status).toBe(400)
    expect((await admin.req('DELETE', `/api/admin/users/${meId}`)).status).toBe(400)
    // Promociona a Bob y le quita el rol otra vez
    expect((await admin.req('PATCH', `/api/admin/users/${bobId}`, { role: 'admin' })).status).toBe(200)
    expect((await bob.req('GET', '/api/admin/stats')).status).toBe(200)
    expect((await admin.req('PATCH', `/api/admin/users/${bobId}`, { role: 'user' })).status).toBe(200)
    expect((await bob.req('GET', '/api/admin/stats')).status).toBe(403)
  })

  it('desactivar cierra sus sesiones e impide entrar; reactivar lo deja entrar', async () => {
    expect((await admin.req('PATCH', `/api/admin/users/${bobId}`, { disabled: true })).status).toBe(200)
    expect((await bob.req('GET', '/api/auth/me')).status).toBe(401)
    const login = await new Client().req('POST', '/api/auth/login', { email: 'bob@cartero.dev', password: 'password123' })
    expect(login.status).toBe(403)
    await admin.req('PATCH', `/api/admin/users/${bobId}`, { disabled: false })
    expect((await bob.req('POST', '/api/auth/login', { email: 'bob@cartero.dev', password: 'password123' })).status).toBe(200)
  })

  it('ensureAdmin nombra admin a la cuenta más antigua si no queda ninguno', async () => {
    await sqlClient.unsafe(`update users set role = 'user'`)
    await ensureAdmin()
    const rows = await sqlClient.unsafe(`select email from users where role = 'admin'`)
    expect(rows.map((r: any) => r.email)).toEqual(['root@cartero.dev'])
  })
})

describe('ajustes de registro', () => {
  it('cerrar el registro bloquea cuentas nuevas', async () => {
    expect((await admin.req('PATCH', '/api/admin/settings', { allowRegistration: false })).status).toBe(200)
    expect((await new Client().req('GET', '/api/auth/config')).body.allowRegistration).toBe(false)
    expect((await register('carol@cartero.dev')).r.status).toBe(403)
    await admin.req('PATCH', '/api/admin/settings', { allowRegistration: true })
  })

  it('limita el registro a dominios permitidos', async () => {
    expect((await admin.req('PATCH', '/api/admin/settings', { allowedDomains: ['no dominio'] })).status).toBe(400)
    expect((await admin.req('PATCH', '/api/admin/settings', { allowedDomains: ['empresa.com'] })).status).toBe(200)
    expect((await register('dan@otra.com')).r.status).toBe(403)
    expect((await register('dan@empresa.com')).r.status).toBe(200)
    expect((await register('eva@eu.empresa.com')).r.status).toBe(200)
    await admin.req('PATCH', '/api/admin/settings', { allowedDomains: [] })
  })
})

describe('login social', () => {
  it('no deja activar un proveedor sin credenciales y nunca devuelve el secreto', async () => {
    expect((await admin.req('PATCH', '/api/admin/settings', { providers: { google: { enabled: true } } })).status).toBe(400)
    const r = await admin.req('PATCH', '/api/admin/settings', { providers: { google: { enabled: true, clientId: 'g-id', clientSecret: 'g-secret' } } })
    expect(r.status).toBe(200)
    expect(r.body.providers.google).toMatchObject({ enabled: true, clientId: 'g-id', hasSecret: true })
    expect(r.body.providers.google.callbackUrl).toMatch(/\/api\/auth\/oauth\/google\/callback$/)
    expect(JSON.stringify(r.body)).not.toContain('g-secret')
    const rows = await sqlClient.unsafe(`select value::text as v from instance_settings where key = 'providers'`)
    expect(rows[0].v).not.toContain('g-secret')
    expect((await new Client().req('GET', '/api/auth/config')).body.providers).toEqual(['google'])
  })

  it('redirige a Google con state y PKCE', async () => {
    const c = new Client()
    const r = await c.req('GET', '/api/auth/oauth/google?next=/w/abc')
    expect(r.status).toBe(302)
    const u = new URL(r.headers.location as string)
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(u.searchParams.get('client_id')).toBe('g-id')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('state')).toBeTruthy()
    expect(c.jar.has('cartero_oauth')).toBe(true)
    // GitHub sigue desactivado
    expect((await c.req('GET', '/api/auth/oauth/github')).headers.location).toBe('/login?oauth_error=provider_disabled')
  })

  it('crea la cuenta la primera vez y entra con ella después', async () => {
    const spy = fakeGoogle({ sub: 'g-1', email: 'Frank@Gmail.com', name: 'Frank' })
    const c = new Client()
    const { location } = await googleLogin(c, '?next=/w/abc')
    expect(location).toBe('/w/abc')
    const me = await c.req('GET', '/api/auth/me')
    expect(me.body).toMatchObject({ email: 'frank@gmail.com', name: 'Frank', role: 'user', hasPassword: false })
    expect(me.body.identities).toEqual([{ provider: 'google', email: 'frank@gmail.com' }])
    // Segunda vez: misma cuenta
    const c2 = new Client()
    await googleLogin(c2)
    expect((await c2.req('GET', '/api/auth/me')).body.id).toBe(me.body.id)
    spy.mockRestore()
  })

  it('vincula con una cuenta existente si el email está verificado', async () => {
    const spy = fakeGoogle({ sub: 'g-bob', email: 'bob@cartero.dev' })
    const c = new Client()
    await googleLogin(c)
    const me = await c.req('GET', '/api/auth/me')
    expect(me.body.id).toBe(bobId)
    expect(me.body.hasPassword).toBe(true)
    spy.mockRestore()
  })

  it('vincula Google a la cuenta con la sesión abierta desde Ajustes', async () => {
    const spy = fakeGoogle({ sub: 'g-link', email: 'otro-email@gmail.com' })
    const { location } = await googleLogin(bob, '?link=1')
    expect(location).toBe('/?oauth_linked=google')
    const me = await bob.req('GET', '/api/auth/me')
    expect(me.body.identities.map((i: any) => i.email)).toContain('otro-email@gmail.com')
    // Esa cuenta de Google ya no puede vincularse a otro usuario
    const { location: again } = await googleLogin(admin, '?link=1')
    expect(again).toBe('/?oauth_error=already_linked')
    spy.mockRestore()
  })

  it('rechaza emails sin verificar, state falso y registro cerrado', async () => {
    let spy = fakeGoogle({ sub: 'g-2', email: 'x@gmail.com', email_verified: false })
    expect((await googleLogin(new Client())).location).toBe('/login?oauth_error=email_unverified')
    spy.mockRestore()

    const c = new Client()
    await c.req('GET', '/api/auth/oauth/google')
    const bad = await c.req('GET', '/api/auth/oauth/google/callback?code=the-code&state=falso')
    expect(bad.headers.location).toBe('/login?oauth_error=invalid_state')

    await admin.req('PATCH', '/api/admin/settings', { allowRegistration: false })
    spy = fakeGoogle({ sub: 'g-3', email: 'nueva@gmail.com' })
    expect((await googleLogin(new Client())).location).toBe('/login?oauth_error=registration_closed')
    // Una cuenta ya vinculada sí puede entrar con el registro cerrado
    spy.mockRestore()
    spy = fakeGoogle({ sub: 'g-1', email: 'frank@gmail.com' })
    expect((await googleLogin(new Client())).location).toBe('/')
    spy.mockRestore()
    await admin.req('PATCH', '/api/admin/settings', { allowRegistration: true })
  })

  it('una cuenta solo social puede poner contraseña y no puede desvincular su única forma de entrar', async () => {
    const spy = fakeGoogle({ sub: 'g-1', email: 'frank@gmail.com' })
    const c = new Client()
    await googleLogin(c)
    spy.mockRestore()
    expect((await c.req('DELETE', '/api/auth/identities/google')).status).toBe(400)
    expect((await c.req('PATCH', '/api/auth/me', { newPassword: 'nueva-clave-1' })).status).toBe(200)
    expect((await c.req('DELETE', '/api/auth/identities/google')).status).toBe(200)
    expect((await new Client().req('POST', '/api/auth/login', { email: 'frank@gmail.com', password: 'nueva-clave-1' })).status).toBe(200)
  })

  it('el admin borra un usuario y su workspace personal', async () => {
    const users = (await admin.req('GET', '/api/admin/users')).body
    const frank = users.find((u: any) => u.email === 'frank@gmail.com')
    const before = (await admin.req('GET', '/api/admin/stats')).body.workspaces
    expect((await admin.req('DELETE', `/api/admin/users/${frank.id}`)).status).toBe(200)
    const after = await admin.req('GET', '/api/admin/stats')
    expect(after.body.workspaces).toBe(before - 1)
    expect((await admin.req('GET', '/api/admin/users')).body.find((u: any) => u.email === 'frank@gmail.com')).toBeUndefined()
  })
})
