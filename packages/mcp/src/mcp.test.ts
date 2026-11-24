import { readFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCarteroMcpServer } from './index.js'

const contract = {
  request: { path: [{ name: 'id', required: true, schema: { type: 'integer' } }] },
  responses: {
    '200': {
      body: {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'integer' } },
        required: ['a', 'b'],
      },
    },
  },
}
const item = {
  id: 'r1',
  name: 'Ver',
  collectionId: 'c1',
  workspaceId: 'w1',
  version: 2,
  data: { request: { method: 'GET', url: { raw: '{{baseUrl}}/c/:id' } }, contract },
}

let api: http.Server
let base = ''
const seen: { method: string; url: string; auth?: string; body?: any }[] = []

beforeAll(async () => {
  api = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      seen.push({
        method: req.method!,
        url: req.url!,
        auth: req.headers.authorization,
        body: body ? JSON.parse(body) : undefined,
      })
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/workspaces')
        return res.end(JSON.stringify([{ id: 'w1', name: 'Equipo', role: 'editor' }]))
      if (req.url === '/api/workspaces/w1/environments')
        return res.end(
          JSON.stringify([
            {
              id: 'e1',
              name: 'Prod',
              values: [
                { key: 'token', value: 'top-secret', type: 'secret' },
                { key: 'url', value: 'https://x' },
              ],
            },
          ]),
        )
      if (req.url === '/api/items/r1' && req.method === 'GET') return res.end(JSON.stringify(item))
      if (req.url === '/api/items/r1' && req.method === 'PATCH')
        return res.end(JSON.stringify({ id: 'r1', name: 'Ver', version: 3 }))
      if (req.url?.startsWith('/api/collections/c1/openapi')) {
        res.setHeader('content-type', 'application/yaml')
        return res.end('openapi: 3.1.0\n')
      }
      if (req.url === '/api/items/nope') {
        res.statusCode = 404
        return res.end(JSON.stringify({ message: 'Elemento no encontrado' }))
      }
      if (req.url === '/api/workspaces/w1/execute')
        return res.end(
          JSON.stringify({
            execution: {
              request: { method: 'GET', url: 'https://a.b/c' },
              response: {
                code: 200,
                status: 'OK',
                time: 12.3,
                headers: [{ key: 'Content-Type', value: 'application/json' }],
                body: '{"a":1}',
                contentType: 'application/json',
                size: { body: 7 },
              },
              tests: [{ name: 't', passed: true }],
            },
            console: [{ messages: ['hola'] }],
            variablesChanged: [],
          }),
        )
      res.statusCode = 404
      res.end('{}')
    })
  })
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`
})
afterAll(() => api.close())

async function connect() {
  const server = createCarteroMcpServer({ baseUrl: base, token: 'crt_test' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 't', version: '1' })
  await Promise.all([server.connect(a), client.connect(b)])
  return client
}
const text = (r: any) => r.content[0].text as string

describe('createCarteroMcpServer', () => {
  it('anuncia la versión del paquete, o la que le pasa el servidor', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect((await connect()).getServerVersion()?.version).toBe(pkg.version)
    const server = createCarteroMcpServer({ baseUrl: base, token: 'crt_test', version: '9.9.9' })
    const [a, b] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 't', version: '1' })
    await Promise.all([server.connect(a), client.connect(b)])
    expect(client.getServerVersion()?.version).toBe('9.9.9')
  })

  it('expone las herramientas y envía el token', async () => {
    const c = await connect()
    const { tools } = await c.listTools()
    expect(tools).toHaveLength(24)
    expect(tools.find((t) => t.name === 'listar_workspaces')?.annotations?.readOnlyHint).toBe(true)
    const r = await c.callTool({ name: 'listar_workspaces', arguments: {} })
    expect(JSON.parse(text(r))[0].name).toBe('Equipo')
    expect(seen.at(-1)?.auth).toBe('Bearer crt_test')
  })

  it('oculta los valores secretos', async () => {
    const c = await connect()
    const r = text(await c.callTool({ name: 'listar_entornos', arguments: { workspaceId: 'w1' } }))
    expect(r).not.toContain('top-secret')
    expect(r).toContain('https://x')
  })

  it('resume la respuesta de enviar_peticion y parsea JSON', async () => {
    const c = await connect()
    const r = JSON.parse(
      text(
        await c.callTool({
          name: 'enviar_peticion',
          arguments: {
            workspaceId: 'w1',
            url: 'https://a.b/c',
            headers: { 'Content-Type': 'application/json' },
            body: '{"x":1}',
            method: 'post',
          },
        }),
      ),
    )
    expect(r).toMatchObject({
      status: '200 OK',
      timeMs: 12,
      body: { a: 1 },
      tests: ['✓ t'],
      console: ['hola'],
    })
    const sent = seen.at(-1)!.body
    expect(sent.item.request).toMatchObject({
      method: 'POST',
      body: { mode: 'raw', options: { raw: { language: 'json' } } },
    })
  })

  it('valida la respuesta contra el contrato', async () => {
    const c = await connect()
    const r = JSON.parse(text(await c.callTool({ name: 'validar_contrato', arguments: { requestId: 'r1' } })))
    expect(r.cumple).toBe(false)
    expect([...r.respuesta].sort()).toEqual([
      '✗ $.a: Se esperaba string y ha llegado integer',
      '✗ $.b: Es obligatorio y no ha llegado',
    ])
  })

  it('no guarda un cambio que rompe sin confirmación', async () => {
    const c = await connect()
    const sinB = {
      responses: {
        '200': { body: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] } },
      },
    }
    const r: any = await c.callTool({
      name: 'guardar_contrato',
      arguments: { requestId: 'r1', contrato: sinB },
    })
    expect(r.isError).toBe(true)
    expect(text(r)).toContain('Se quita el campo')
    expect(seen.at(-1)?.method).toBe('GET')
    const ok = JSON.parse(
      text(
        await c.callTool({
          name: 'guardar_contrato',
          arguments: { requestId: 'r1', contrato: sinB, aceptarCambiosQueRompen: true },
        }),
      ),
    )
    expect(ok.guardado).toBe(true)
    expect(seen.at(-1)).toMatchObject({ method: 'PATCH', body: { version: 2, data: { contract: sinB } } })
  })

  it('genera el contrato desde la respuesta sin guardarlo', async () => {
    const c = await connect()
    const r = JSON.parse(text(await c.callTool({ name: 'generar_contrato', arguments: { requestId: 'r1' } })))
    expect(r.guardado).toBe(false)
    expect(r.contrato.responses['200'].body.properties.a.type).toBe('integer')
    expect(r.cambios.some((x: string) => x.startsWith('ROMPE'))).toBe(true)
  })

  it('crear un contrato desde cero no cuenta como cambio que rompe', async () => {
    const c = await connect()
    const prev = item.data.contract
    item.data.contract = undefined as any
    try {
      const r = JSON.parse(
        text(await c.callTool({ name: 'generar_contrato', arguments: { requestId: 'r1', guardar: true } })),
      )
      expect(r).toMatchObject({ guardado: true, resumen: 'contrato creado', nuevo: true })
    } finally {
      item.data.contract = prev
    }
  })

  it('exporta OpenAPI en YAML', async () => {
    const c = await connect()
    expect(text(await c.callTool({ name: 'exportar_openapi', arguments: { collectionId: 'c1' } }))).toBe(
      'openapi: 3.1.0\n',
    )
  })

  it('devuelve errores como isError con el mensaje del servidor', async () => {
    const c = await connect()
    const r: any = await c.callTool({ name: 'ver_peticion', arguments: { requestId: 'nope' } })
    expect(r.isError).toBe(true)
    expect(text(r)).toContain('Elemento no encontrado')
  })
})
