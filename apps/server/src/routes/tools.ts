import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RequestItem } from '@cartero/core'
import { importCurl } from '@cartero/importers'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../config.js'
import { assertRole } from '../lib/access.js'
import { requireUser } from '../lib/auth.js'
import { badRequest } from '../lib/errors.js'
import { countEvent } from '../lib/telemetry.js'

const tokenBody = z.object({
  grant_type: z.enum(['client_credentials', 'password_credentials', 'authorization_code', 'refresh_token']),
  accessTokenUrl: z.string().url(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  scope: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  code: z.string().optional(),
  redirect_uri: z.string().optional(),
  code_verifier: z.string().optional(),
  refresh_token: z.string().optional(),
  client_authentication: z.enum(['header', 'body']).optional(),
  audience: z.string().optional(),
  resource: z.string().optional(),
})

export async function toolRoutes(app: FastifyInstance) {
  /** Convierte un cURL pegado en la barra de URL en una petición. */
  app.post('/api/tools/curl', async (req) => {
    requireUser(req)
    const { text } = z.object({ text: z.string().min(1).max(1_000_000) }).parse(req.body)
    try {
      const col = importCurl(text)
      countEvent('curl.paste')
      return col.item[0] as RequestItem
    } catch (e) {
      throw badRequest((e as Error).message)
    }
  })

  /**
   * Pide un token OAuth 2.0 desde el servidor (evita CORS y no expone el secreto a otras webs).
   * Las variables ya vienen resueltas por el cliente.
   */
  app.post('/api/workspaces/:ws/oauth2/token', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id)
    const b = tokenBody.parse(req.body)
    const params = new URLSearchParams()
    const grant = b.grant_type === 'password_credentials' ? 'password' : b.grant_type
    params.set('grant_type', grant)
    if (b.scope) params.set('scope', b.scope)
    if (b.audience) params.set('audience', b.audience)
    if (b.resource) params.set('resource', b.resource)
    if (grant === 'password') {
      params.set('username', b.username ?? '')
      params.set('password', b.password ?? '')
    }
    if (grant === 'authorization_code') {
      params.set('code', b.code ?? '')
      if (b.redirect_uri) params.set('redirect_uri', b.redirect_uri)
      if (b.code_verifier) params.set('code_verifier', b.code_verifier)
    }
    if (grant === 'refresh_token') params.set('refresh_token', b.refresh_token ?? '')

    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }
    if ((b.client_authentication ?? 'header') === 'header' && b.clientId) {
      headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(b.clientId)}:${encodeURIComponent(b.clientSecret ?? '')}`).toString('base64')}`
    } else {
      if (b.clientId) params.set('client_id', b.clientId)
      if (b.clientSecret) params.set('client_secret', b.clientSecret)
    }

    let res: Response
    try {
      res = await fetch(b.accessTokenUrl, { method: 'POST', headers, body: params, signal: AbortSignal.timeout(30_000) })
    } catch (e) {
      throw badRequest(`No se pudo contactar con el servidor de tokens: ${(e as Error).message}`)
    }
    const text = await res.text()
    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      data = Object.fromEntries(new URLSearchParams(text))
    }
    if (!res.ok || !data.access_token) {
      throw badRequest(`El servidor de tokens respondió ${res.status}: ${data.error_description ?? data.error ?? text.slice(0, 300)}`)
    }
    return data
  })

  /** Sube un fichero para usarlo en form-data o body binario. */
  app.post('/api/workspaces/:ws/files', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id, 'editor')
    const file = await req.file()
    if (!file) throw badRequest('Falta el fichero')
    const safeName = path.basename(file.filename).replace(/[^\w.\-]+/g, '_') || 'fichero'
    const rel = path.join(ws, randomUUID(), safeName)
    const full = path.resolve(config.filesDir, rel)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, await file.toBuffer())
    return { src: rel, name: safeName, size: file.file.bytesRead }
  })
}
