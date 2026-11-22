import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Collection } from '@cartero/core'
import { runCollection, runIsolated } from './index.js'

let server: http.Server
let base = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      if (req.url?.startsWith('/png')) {
        res.setHeader('content-type', 'image/png')
        return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      }
      if (req.url?.startsWith('/cookie')) res.setHeader('set-cookie', 'sid=abc; Path=/')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

function col(): Collection {
  return {
    info: { name: 'Test' },
    variable: [{ key: 'base', value: base }],
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
    item: [
      {
        id: 'login',
        name: 'Login',
        request: { method: 'POST', url: '{{base}}/login', body: { mode: 'raw', raw: '{"u":"{{user}}"}', options: { raw: { language: 'json' } } } },
        event: [
          {
            listen: 'test',
            script: {
              exec: [
                'pm.test("status 200", () => pm.response.to.have.status(200))',
                'pm.test("body con user", () => pm.expect(pm.response.json().body).to.include(pm.iterationData.get("user") || "ana"))',
                'pm.environment.set("token", "tok-" + pm.info.iteration)',
                'console.log("login ok")',
              ],
            },
          },
        ],
      },
      {
        id: 'folder',
        name: 'Carpeta',
        item: [
          {
            id: 'me',
            name: 'Me',
            request: { method: 'GET', url: '{{base}}/me' },
            event: [{ listen: 'test', script: { exec: ['pm.test("bearer heredado", () => pm.expect(pm.response.json().headers.authorization).to.eql("Bearer " + pm.environment.get("token")))', 'pm.test("falla", () => pm.expect(1).to.eql(2))'] } }],
          },
          { id: 'png', name: 'PNG', request: { method: 'GET', url: '{{base}}/png' } },
        ],
      },
    ],
  }
}

describe('runCollection', () => {
  it('ejecuta colección completa con scripts, auth heredada y variables', async () => {
    const events: string[] = []
    const r = await runCollection({ collection: col(), environment: [{ key: 'user', value: 'ana' }] }, (e) => events.push(e.type))
    expect(r.error).toBeUndefined()
    expect(r.executions.map((e) => e.name)).toEqual(['Login', 'Me', 'PNG'])
    const [login, me, png] = r.executions
    expect(login.request?.body).toBe('{"u":"ana"}')
    expect(login.response?.code).toBe(200)
    expect(login.tests.every((t) => t.passed)).toBe(true)
    expect(me.tests).toEqual([
      { name: 'bearer heredado', passed: true, skipped: false },
      expect.objectContaining({ name: 'falla', passed: false }),
    ])
    expect(png.response?.bodyBase64).toBe('iVBORw==')
    expect(png.response?.body).toBeUndefined()
    expect(r.environment.find((v) => v.key === 'token')?.value).toBe('tok-0')
    expect(r.console.map((c) => c.messages)).toContainEqual(['login ok'])
    expect(r.stats).toMatchObject({ requests: 3, assertions: 4, failedAssertions: 1 })
    expect(events[0]).toBe('start')
    expect(events.at(-1)).toBe('done')
    expect(login.response?.timings).toBeTruthy()
  })

  it('ejecuta una sola petición por entrypoint e itera con datos', async () => {
    const r = await runCollection({
      collection: col(),
      entrypoint: 'login',
      iterationData: [{ user: 'luis' }, { user: 'eva' }],
    })
    expect(r.executions.map((e) => e.request?.body)).toEqual(['{"u":"luis"}', '{"u":"eva"}'])
    expect(r.stats.iterations).toBe(2)
  })

  it('guarda cookies en el jar', async () => {
    const c: Collection = { info: { name: 'c' }, item: [{ name: 'c', request: { method: 'GET', url: `${base}/cookie` } }] }
    const r = await runCollection({ collection: c })
    expect(r.executions[0].response?.cookies[0]).toMatchObject({ name: 'sid', value: 'abc' })
    expect(JSON.stringify(r.cookieJar)).toContain('sid')
  })

  it('informa errores de red', async () => {
    const c: Collection = { info: { name: 'c' }, item: [{ name: 'x', request: { method: 'GET', url: 'http://127.0.0.1:1/' } }] }
    const r = await runCollection({ collection: c })
    expect(r.executions[0].error).toMatch(/ECONNREFUSED/)
  })
})

describe('runIsolated', () => {
  it('ejecuta en proceso hijo', async () => {
    const r = await runIsolated({ collection: col(), entrypoint: 'login', environment: [{ key: 'user', value: 'ana' }] })
    expect(r.executions[0].response?.code).toBe(200)
    expect(r.environment.find((v) => v.key === 'token')?.value).toBe('tok-0')
  })
  it('mata bucles infinitos por timeout', async () => {
    const c: Collection = {
      info: { name: 'c' },
      item: [{ name: 'x', request: { method: 'GET', url: base }, event: [{ listen: 'prerequest', script: { exec: ['while(true){}'] } }] }],
    }
    const r = await runIsolated({ collection: c }, () => {}, { maxDuration: 1500 })
    expect(r.error).toMatch(/tiempo máximo/)
  }, 10000)
})
