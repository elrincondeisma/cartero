import { createCarteroMcpServer } from '@cartero/mcp'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../config.js'
import { publicUrl } from '../lib/settings.js'
import { resolveUser } from '../lib/auth.js'

/**
 * Endpoint MCP remoto (Streamable HTTP, sin estado). Autenticación con token de API:
 *   Authorization: Bearer crt_…
 * Cada petición crea un servidor MCP efímero que llama a la API interna con ese token.
 */
export async function mcpRoutes(app: FastifyInstance) {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : (req.headers['x-api-key'] as string | undefined)
    const user = token?.startsWith('crt_') ? await resolveUser(req) : undefined
    if (!user || !token) {
      return reply
        .code(401)
        .header('www-authenticate', 'Bearer realm="cartero"')
        .send({ jsonrpc: '2.0', error: { code: -32001, message: 'Falta un token de API válido (Authorization: Bearer crt_…). Créalo en Ajustes → Tokens de API.' }, id: null })
    }
    if (req.method !== 'POST') {
      // Modo sin estado: no hay stream de notificaciones del servidor ni sesiones que cerrar
      return reply.code(405).header('allow', 'POST').send({ jsonrpc: '2.0', error: { code: -32000, message: 'Usa POST' }, id: null })
    }

    const server = createCarteroMcpServer({ baseUrl: `http://127.0.0.1:${config.port}`, token, publicUrl: await publicUrl() })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    reply.hijack()
    reply.raw.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req.raw, reply.raw, req.body)
  }

  app.post('/mcp', handler)
  app.get('/mcp', handler)
  app.delete('/mcp', handler)
}
