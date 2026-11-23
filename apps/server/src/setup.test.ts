import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgres://cartero:cartero@localhost:5433/cartero_test'
process.env.LOG_LEVEL = 'silent'

const { buildApp } = await import('./app.js')
const { runMigrations } = await import('./db/migrate.js')
const { sqlClient } = await import('./db/index.js')
const { clearSettingsCache } = await import('./lib/settings.js')

let app: FastifyInstance
let target: http.Server
let targetUrl = ''
let cookie = ''

async function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({ method: method as any, url, payload: body as any, headers: { ...(cookie ? { cookie } : {}), ...headers } })
  const set = res.headers['set-cookie']
  const first = Array.isArray(set) ? set[0] : set
  if (first?.startsWith('cartero_session=')) cookie = first.split(';')[0]
  let json: any
  try {
    json = JSON.parse(res.body)
  } catch {
    json = res.body
  }
  return { status: res.statusCode, body: json }
}

beforeAll(async () => {
  await sqlClient.unsafe('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;')
  await runMigrations()
  clearSettingsCache()
  app = await buildApp({ logger: false })
  target = http.createServer((_q, r) => r.end('{"ok":true}'))
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', () => r()))
  targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`
})

afterAll(async () => {
  await app?.close()
  target?.close()
  await sqlClient.end()
})

describe('asistente de instalación', () => {
  it('una instancia vacía pide instalación y detecta la URL', async () => {
    const r = await req('GET', '/api/setup', undefined, { host: 'cartero.example.com', 'x-forwarded-proto': 'https' })
    expect(r.body).toMatchObject({ needsSetup: true, detectedUrl: 'https://cartero.example.com', secretKeyFromEnv: false })
    expect((await req('GET', '/api/auth/config')).body.needsSetup).toBe(true)
  })

  it('detrás de CloudFront y un balanceador, usa el protocolo que vio CloudFront', async () => {
    const r = await req('GET', '/api/setup', undefined, {
      host: 'd123.cloudfront.net',
      'x-forwarded-proto': 'http',
      'cloudfront-forwarded-proto': 'https',
    })
    expect(r.body).toMatchObject({ detectedUrl: 'https://d123.cloudfront.net' })
  })

  it('crea la cuenta admin, guarda la URL y deja el asistente pendiente', async () => {
    const r = await req('POST', '/api/setup/admin', {
      name: 'Root',
      email: 'Root@Example.com',
      password: 'password123',
      lang: 'en',
      instanceName: 'Acme APIs',
      publicUrl: 'https://cartero.example.com/',
    })
    expect(r.status).toBe(200)
    const me = await req('GET', '/api/auth/me')
    expect(me.body).toMatchObject({ email: 'root@example.com', role: 'admin' })
    const s = await req('GET', '/api/admin/settings')
    expect(s.body).toMatchObject({ instanceName: 'Acme APIs', publicUrl: 'https://cartero.example.com', setupCompleted: false })
    expect(s.body.providers.google.callbackUrl).toBe('https://cartero.example.com/api/auth/oauth/google/callback')
  })

  it('no deja instalar dos veces ni enseña las comprobaciones después', async () => {
    const again = await req('POST', '/api/setup/admin', { name: 'X', email: 'x@example.com', password: 'password123' })
    expect(again.status).toBe(409)
    const r = await req('GET', '/api/setup')
    expect(r.body).toEqual({ needsSetup: false, setupCompleted: false })
  })

  it('las invitaciones usan la URL pública guardada', async () => {
    const ws = (await req('GET', '/api/workspaces')).body[0].id
    const inv = await req('POST', `/api/workspaces/${ws}/invitations`, { email: 'ana@example.com', role: 'editor' })
    expect(inv.body.link).toMatch(/^https:\/\/cartero\.example\.com\/invite\//)
  })

  it('valida y guarda nombre, URL y SMTP sin devolver la contraseña', async () => {
    expect((await req('PATCH', '/api/admin/settings', { publicUrl: 'ftp://x' })).status).toBe(400)
    expect((await req('PATCH', '/api/admin/settings', { smtp: { url: 'mail.example.com' } })).status).toBe(400)
    const r = await req('PATCH', '/api/admin/settings', { smtp: { url: 'smtps://user:s3cret@mail.example.com:465', from: 'Acme <apis@example.com>' } })
    expect(r.status).toBe(200)
    expect(r.body.smtp).toEqual({ configured: true, host: 'mail.example.com:465', from: 'Acme <apis@example.com>' })
    expect(JSON.stringify(r.body)).not.toContain('s3cret')
    const rows = await sqlClient.unsafe(`select value::text as v from instance_settings where key = 'smtp'`)
    expect(rows[0].v).not.toContain('s3cret')
  })

  it('el email de prueba devuelve el error del servidor de correo', async () => {
    const r = await req('POST', '/api/admin/test-email', { url: 'smtp://127.0.0.1:1', from: 'a@b.c' })
    expect(r.status).toBe(400)
    expect(r.body.message).toMatch(/servidor de correo/)
  })

  it('la protección SSRF se activa y desactiva al momento', async () => {
    const ws = (await req('GET', '/api/workspaces')).body[0].id
    const item = { name: 'local', request: { method: 'GET', url: targetUrl } }
    await req('PATCH', '/api/admin/settings', { blockPrivateNetworks: true })
    const blocked = await req('POST', `/api/workspaces/${ws}/execute`, { item })
    expect(blocked.body.execution?.response?.code).not.toBe(200)
    await req('PATCH', '/api/admin/settings', { blockPrivateNetworks: false })
    const ok = await req('POST', `/api/workspaces/${ws}/execute`, { item })
    expect(ok.body.execution.response.code).toBe(200)
  })

  it('Sistema informa del estado del servidor y se puede terminar el asistente', async () => {
    const sys = await req('GET', '/api/admin/system')
    expect(sys.body).toMatchObject({ database: true, secretKeyFromEnv: false })
    await req('PATCH', '/api/admin/settings', { setupCompleted: true })
    expect((await req('GET', '/api/setup')).body.setupCompleted).toBe(true)
  })
})
