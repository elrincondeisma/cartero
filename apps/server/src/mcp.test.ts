import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// El MCP llama a la API interna en config.port: usamos un puerto propio para el test
process.env.PORT = '3997'
process.env.DATABASE_URL ??= 'postgres://cartero:cartero@localhost:5433/cartero_test'
process.env.LOG_LEVEL = 'silent'

const { buildApp } = await import('./app.js')
const { runMigrations } = await import('./db/migrate.js')
const { sqlClient } = await import('./db/index.js')

let app: FastifyInstance
let target: http.Server
let targetUrl = ''
let client: Client
let ws = ''
let token = ''

const text = (r: any) => r.content[0].text as string
const json = (r: any) => JSON.parse(text(r))

beforeAll(async () => {
  await sqlClient.unsafe('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;')
  await runMigrations()
  app = await buildApp({ logger: false })
  await app.listen({ port: 3997, host: '127.0.0.1' })
  target = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, path: req.url }))
  })
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', () => r()))
  targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`

  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'mcp@test.dev', name: 'MCP', password: 'password123' } })
  const cookie = String(reg.headers['set-cookie']).split(';')[0]
  token = JSON.parse((await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie }, payload: { name: 'mcp' } })).body).token
  ws = JSON.parse((await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie } })).body)[0].id

  client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3997/mcp'), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
})

afterAll(async () => {
  await client?.close()
  await app?.close()
  target?.close()
  await sqlClient.end()
})

describe('MCP', () => {
  it('rechaza sin token', async () => {
    const res = await fetch('http://127.0.0.1:3997/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(401)
  })

  it('lista herramientas y prompts', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['listar_workspaces', 'enviar_peticion', 'crear_peticion', 'ejecutar_coleccion', 'importar', 'generar_codigo']))
    const { prompts } = await client.listPrompts()
    expect(prompts.map((p) => p.name)).toContain('probar_api')
  })

  it('flujo: crear colección y petición con tests, enviarla, ejecutar la colección', async () => {
    const wss = json(await client.callTool({ name: 'listar_workspaces', arguments: {} }))
    expect(wss[0].id).toBe(ws)
    const col = json(await client.callTool({ name: 'crear_coleccion', arguments: { workspaceId: ws, nombre: 'Desde MCP' } }))
    const req = json(
      await client.callTool({
        name: 'crear_peticion',
        arguments: { collectionId: col.id, nombre: 'Hola', url: `${targetUrl}/hola`, scriptTests: 'pm.test("ok", () => pm.response.to.have.status(200))' },
      }),
    )
    const sent = json(await client.callTool({ name: 'enviar_peticion', arguments: { requestId: req.id } }))
    expect(sent.status).toBe('200 OK')
    expect(sent.body).toEqual({ ok: true, path: '/hola' })
    expect(sent.tests).toEqual(['✓ ok'])

    const view = json(await client.callTool({ name: 'ver_coleccion', arguments: { collectionId: col.id } }))
    expect(view.items[0]).toMatchObject({ peticion: 'Hola', method: 'GET' })

    const run = json(await client.callTool({ name: 'ejecutar_coleccion', arguments: { collectionId: col.id, iteraciones: 2 } }))
    expect(run.estado).toBe('passed')
    expect(run.resumen.assertions).toBe(2)

    const code = text(await client.callTool({ name: 'generar_codigo', arguments: { requestId: req.id, lenguaje: 'python', variante: 'Requests' } }))
    expect(code).toContain('requests')
  })

  it('importa cURL y oculta secretos', async () => {
    const r = json(await client.callTool({ name: 'importar', arguments: { workspaceId: ws, texto: `curl ${targetUrl}/x -H 'X-A: 1'` } }))
    expect(r.format).toBe('curl')
    await app.inject({
      method: 'POST',
      url: `/api/workspaces/${ws}/environments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Prod', values: [{ key: 'token', value: 'super-secreto', type: 'secret' }, { key: 'url', value: 'https://x' }] },
    })
    const envs = text(await client.callTool({ name: 'listar_entornos', arguments: { workspaceId: ws } }))
    expect(envs).not.toContain('super-secreto')
    expect(envs).toContain('https://x')
  })

  it('devuelve errores legibles', async () => {
    const r: any = await client.callTool({ name: 'ver_peticion', arguments: { requestId: '00000000-0000-0000-0000-000000000000' } })
    expect(r.isError).toBe(true)
    expect(text(r)).toMatch(/404/)
  })
})
