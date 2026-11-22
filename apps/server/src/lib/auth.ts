import { and, eq, gt } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../config.js'
import { db, schema } from '../db/index.js'
import { randomToken, sha256 } from './crypto.js'
import { unauthorized } from './errors.js'

export interface AuthUser {
  id: string
  email: string
  name: string
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser
  }
}

export const SESSION_COOKIE = 'cartero_session'
const SESSION_MS = 30 * 24 * 60 * 60 * 1000

export async function createSession(reply: FastifyReply, userId: string) {
  const token = randomToken()
  const expiresAt = new Date(Date.now() + SESSION_MS)
  await db.insert(schema.sessions).values({ id: sha256(token), userId, expiresAt })
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    expires: expiresAt,
  })
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE]
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)))
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
}

async function userFromSession(token: string): Promise<AuthUser | undefined> {
  const rows = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1)
  return rows[0]
}

async function userFromApiToken(token: string): Promise<AuthUser | undefined> {
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      tokenId: schema.apiTokens.id,
    })
    .from(schema.apiTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.apiTokens.userId))
    .where(eq(schema.apiTokens.tokenHash, sha256(token)))
    .limit(1)
  const row = rows[0]
  if (!row) return undefined
  void db
    .update(schema.apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiTokens.id, row.tokenId))
    .execute()
  return { id: row.id, email: row.email, name: row.name }
}

export async function resolveUser(req: FastifyRequest): Promise<AuthUser | undefined> {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer crt_')) return userFromApiToken(header.slice(7))
  const apiKey = req.headers['x-api-key']
  if (typeof apiKey === 'string' && apiKey.startsWith('crt_')) return userFromApiToken(apiKey)
  const token = req.cookies[SESSION_COOKIE]
  if (token) return userFromSession(token)
  return undefined
}

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('user', undefined)
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return
    req.user = await resolveUser(req)
  })
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized()
  return req.user
}
