import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const run = promisify(execFile)
const bin = join(import.meta.dirname, '..', 'dist', 'index.js')
let server: http.Server
let base = ''
const dir = mkdtempSync(join(tmpdir(), 'cartero-cli-'))

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ url: req.url, user: new URL(req.url!, 'http://x').searchParams.get('user') }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  writeFileSync(
    join(dir, 'col.json'),
    JSON.stringify({
      info: { name: 'CLI test', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [
        {
          name: 'Saludo',
          request: { method: 'GET', url: '{{base}}/hola?user={{user}}' },
          event: [{ listen: 'test', script: { exec: ['pm.test("200", () => pm.response.to.have.status(200))', 'pm.test("user", () => pm.expect(pm.response.json().user).to.eql(pm.iterationData.get("user")))'] } }],
        },
      ],
    }),
  )
  writeFileSync(join(dir, 'env.json'), JSON.stringify({ name: 'Local', values: [{ key: 'base', value: base, enabled: true }] }))
  writeFileSync(join(dir, 'data.csv'), 'user\nana\nluis\n')
})
afterAll(() => server.close())

describe('cartero run', () => {
  it('ejecuta con entorno y CSV, y genera JUnit/HTML/JSON', async () => {
    const { stdout } = await run('node', [bin, 'run', join(dir, 'col.json'), '-e', join(dir, 'env.json'), '-d', join(dir, 'data.csv'), '-r', 'cli,junit,html,json', '--reporter-junit-export', join(dir, 'j.xml'), '--reporter-html-export', join(dir, 'r.html'), '--reporter-json-export', join(dir, 'r.json')], { env: { ...process.env, NO_COLOR: '1' } })
    expect(stdout).toContain('CLI test')
    expect(stdout).toContain('✓ user')
    const junit = readFileSync(join(dir, 'j.xml'), 'utf8')
    expect(junit).toContain('tests="4" failures="0"')
    expect(readFileSync(join(dir, 'r.html'), 'utf8')).toContain('<title>CLI test')
    expect(JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8')).stats.iterations).toBe(2)
  })

  it('sale con código 1 si falla un test', async () => {
    const err: any = await run('node', [bin, 'run', join(dir, 'col.json'), '-e', join(dir, 'env.json'), '--env-var', 'user=x', '--silent']).catch((e) => e)
    expect(err.code).toBe(1)
  })

  it('sale con código 2 si el fichero no existe', async () => {
    const err: any = await run('node', [bin, 'run', join(dir, 'nada.json')]).catch((e) => e)
    expect(err.code).toBe(2)
  })
})
