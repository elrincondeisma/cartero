import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importAny } from '@cartero/importers'
import type { RequestItem } from '@cartero/core'
import { exportPostmanCollection, exportPostmanEnvironment, generateSnippet, snippetLanguages } from './index.js'

const fx = (name: string) => readFileSync(join(import.meta.dirname, '..', '..', 'importers', 'fixtures', name), 'utf8')

function stripIds(v: any): any {
  if (Array.isArray(v)) return v.map(stripIds)
  if (v && typeof v === 'object') {
    const out: any = {}
    for (const [k, x] of Object.entries(v)) if (k !== 'id') out[k] = stripIds(x)
    return out
  }
  return v
}

describe('ida y vuelta Postman', () => {
  it('importar → exportar conserva la colección v2.1', async () => {
    const original = JSON.parse(fx('postman-v21.json'))
    const { collections } = await importAny(fx('postman-v21.json'))
    const exported = exportPostmanCollection(collections[0])
    expect(stripIds(exported)).toEqual(stripIds(original))
  })
  it('exportar → importar es estable', async () => {
    const { collections } = await importAny(fx('postman-v21.json'))
    const once = exportPostmanCollection(collections[0])
    const { collections: again } = await importAny(JSON.stringify(once))
    expect(exportPostmanCollection(again[0])).toEqual(once)
  })
  it('entornos: ida y vuelta', async () => {
    const { environments } = await importAny(fx('postman-env.json'))
    const exported = exportPostmanEnvironment(environments[0])
    const { environments: back } = await importAny(JSON.stringify(exported))
    expect(back[0].values).toEqual(environments[0].values)
    expect(exported.values[2]).toEqual({ key: 'old', value: 'x', type: 'default', enabled: false })
  })
})

describe('snippets', () => {
  it('lista lenguajes', () => {
    const langs = snippetLanguages().map((l) => l.key)
    expect(langs).toEqual(expect.arrayContaining(['curl', 'nodejs', 'python', 'go']))
  })
  it('genera curl resolviendo variables', async () => {
    const { collections } = await importAny(fx('postman-v21.json'))
    const create = (collections[0].item[0] as any).item[1] as RequestItem
    const s = await generateSnippet(create.request, 'curl', 'cURL', [{ baseUrl: 'https://api.x.com' }])
    expect(s).toContain("curl --location 'https://api.x.com/users'")
    expect(s).toContain('{"name":"Ana"}')
  })
})
