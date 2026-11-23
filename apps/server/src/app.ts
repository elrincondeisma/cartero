import { existsSync } from 'node:fs'
import path from 'node:path'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import Fastify, { type FastifyError } from 'fastify'
import { ZodError } from 'zod'
import { config } from './config.js'
import { assertRole } from './lib/access.js'
import { registerAuth, resolveUser } from './lib/auth.js'
import { HttpError } from './lib/errors.js'
import { join } from './lib/realtime.js'
import { adminRoutes } from './routes/admin.js'
import { authRoutes } from './routes/auth.js'
import { collectionRoutes } from './routes/collections.js'
import { demoRoutes } from './routes/demo.js'
import { docsRoutes } from './routes/docs.js'
import { environmentRoutes } from './routes/environments.js'
import { executeRoutes } from './routes/execute.js'
import { mcpRoutes } from './routes/mcp.js'
import { mockRoutes } from './routes/mocks.js'
import { monitorRoutes } from './routes/monitors.js'
import { oauthRoutes } from './routes/oauth.js'
import { postmanRoutes } from './routes/postman.js'
import { setupRoutes } from './routes/setup.js'
import { syncRoutes } from './routes/sync.js'
import { toolRoutes } from './routes/tools.js'
import { workspaceRoutes } from './routes/workspaces.js'
import { countEvent } from './lib/telemetry.js'

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 50 * 1024 * 1024,
    trustProxy: true,
  })

  await app.register(cookie)
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } })
  await app.register(websocket)
  await app.register(rateLimit, { global: false })
  registerAuth(app)

  app.setErrorHandler((err: FastifyError | HttpError | ZodError, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation',
        message: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
      })
    }
    if (err instanceof HttpError)
      return reply.code(err.statusCode).send({ error: err.code, message: err.message })
    const status = (err as FastifyError).statusCode ?? 500
    if (status >= 500) {
      req.log.error(err)
      // Telemetría: solo método, ruta-patrón (/api/workspaces/:ws/…) y código; nunca el mensaje
      countEvent(`error.${req.method} ${req.routeOptions?.url ?? 'unknown'} ${status}`)
    }
    return reply
      .code(status)
      .send({ error: 'error', message: status >= 500 ? 'Error interno del servidor' : err.message })
  })

  app.get('/api/health', async () => ({ ok: true, version: config.version }))

  await app.register(authRoutes)
  await app.register(oauthRoutes)
  await app.register(adminRoutes)
  await app.register(setupRoutes)
  await app.register(workspaceRoutes)
  await app.register(collectionRoutes)
  await app.register(environmentRoutes)
  await app.register(syncRoutes)
  await app.register(postmanRoutes)
  await app.register(executeRoutes)
  await app.register(mockRoutes)
  await app.register(monitorRoutes)
  await app.register(docsRoutes)
  await app.register(toolRoutes)
  await app.register(mcpRoutes)
  await app.register(demoRoutes)

  // Tiempo real: presencia y avisos de cambios
  app.get('/api/ws', { websocket: true }, async (socket, req) => {
    const user = await resolveUser(req)
    const workspaceId = (req.query as { workspace?: string }).workspace
    if (!user || !workspaceId) return socket.close(4401, 'unauthorized')
    try {
      await assertRole(workspaceId, user.id)
    } catch {
      return socket.close(4403, 'forbidden')
    }
    join(socket, user, workspaceId)
  })

  // Frontend compilado (producción)
  const webDist = config.webDist ? path.resolve(config.webDist) : undefined
  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/mock/') || req.url.startsWith('/mcp'))
        return reply.code(404).send({ error: 'not_found', message: 'Ruta no encontrada' })
      return reply.sendFile('index.html')
    })
  }

  return app
}
