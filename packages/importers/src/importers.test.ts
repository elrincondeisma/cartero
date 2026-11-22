import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type FolderItem, type RequestItem, isFolder, rawUrl } from '@cartero/core'
import { importAny, importCurl } from './index.js'

const fx = (name: string) => readFileSync(join(import.meta.dirname, '..', 'fixtures', name), 'utf8')

describe('Postman', () => {
  it('importa v2.1 conservando todo', async () => {
    const original = JSON.parse(fx('postman-v21.json'))
    const r = await importAny(fx('postman-v21.json'))
    expect(r.format).toBe('postman-collection')
    const c = r.collections[0]
    expect(c.info.name).toBe('Demo API')
    expect(c.auth).toEqual(original.auth)
    expect(c.event).toEqual(original.event)
    const users = c.item[0] as FolderItem
    expect(isFolder(users)).toBe(true)
    const list = users.item[0] as RequestItem
    expect(list.response?.[0].body).toBe('[{"id":1}]')
    expect(list.event?.[0].listen).toBe('test')
    expect(list.id).toBeTruthy()
    expect((users.item[1] as RequestItem).request.auth?.type).toBe('basic')
  })

  it('convierte v2.0 a v2.1 (auth a array)', async () => {
    const r = await importAny(fx('postman-v20.json'))
    const req = (r.collections[0].item[0] as RequestItem).request
    expect(r.collections[0].info.schema).toContain('v2.1.0')
    expect(req.auth?.type).toBe('basic')
    expect(Array.isArray(req.auth?.basic)).toBe(true)
    expect(req.auth?.basic).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'username', value: 'u' })]))
  })

  it('convierte v1 con carpetas', async () => {
    const r = await importAny(fx('postman-v1.json'))
    const c = r.collections[0]
    expect(c.info.name).toBe('Legacy v1')
    const names = c.item.map((i) => i.name)
    expect(names).toContain('Carpeta')
    expect(names).toContain('Root req')
    const folder = c.item.find((i) => i.name === 'Carpeta') as FolderItem
    expect((folder.item[0] as RequestItem).request.method).toBe('DELETE')
  })

  it('importa entornos y globales', async () => {
    const env = await importAny(fx('postman-env.json'))
    expect(env.environments[0].name).toBe('Producción')
    expect(env.environments[0].values).toEqual([
      { key: 'baseUrl', value: 'https://api.example.com' },
      { key: 'token', value: 'abc', type: 'secret' },
      { key: 'old', value: 'x', disabled: true },
    ])
    const g = await importAny(fx('postman-globals.json'))
    expect(g.globals).toEqual([{ key: 'g1', value: 'v' }])
  })

  it('importa un ZIP de exportación', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    const zip = zipSync({
      'collection/demo.json': strToU8(fx('postman-v21.json')),
      'environment/prod.json': strToU8(fx('postman-env.json')),
      'readme.txt': strToU8('x'),
    })
    const r = await importAny(zip)
    expect(r.collections).toHaveLength(1)
    expect(r.environments).toHaveLength(1)
  })
})

describe('OpenAPI', () => {
  it('convierte petstore agrupando por tags', async () => {
    const r = await importAny(fx('openapi.yaml'))
    expect(r.format).toBe('openapi-3.0.3')
    const c = r.collections[0]
    expect(c.info.name).toBe('Petstore')
    const pets = c.item.find((i) => i.name === 'pets') as FolderItem
    expect(pets).toBeTruthy()
    const names = pets.item.map((i) => i.name)
    expect(names).toEqual(expect.arrayContaining(['List pets', 'Create pet', 'Get pet']))
    expect(c.variable?.find((v) => v.key === 'baseUrl')?.value).toBe('https://petstore.example.com/v1')
  })
})

describe('Insomnia', () => {
  it('importa v4 con carpetas, entornos y variables', async () => {
    const r = await importAny(fx('insomnia-v4.json'))
    const c = r.collections[0]
    expect(c.info.name).toBe('Mi API')
    expect(c.variable).toEqual([{ key: 'base_url', value: 'https://api.test' }])
    const auth = c.item[0] as FolderItem
    const login = auth.item[0] as RequestItem
    expect(rawUrl(login.request.url)).toBe('{{base_url}}/login')
    expect(login.request.auth).toMatchObject({ type: 'bearer', bearer: [{ key: 'token', value: '{{auth.token}}' }] })
    expect(login.request.body).toMatchObject({ mode: 'raw', options: { raw: { language: 'json' } } })
    const form = c.item[1] as RequestItem
    expect(form.request.body?.urlencoded).toEqual([{ key: 'a', value: '1' }, { key: 'b', value: '2', disabled: true }])
    expect(r.environments).toEqual([{ name: 'Dev', values: [{ key: 'base_url', value: 'http://localhost:3000' }, { key: 'auth.token', value: 't' }] }])
  })
})

describe('cURL', () => {
  it('POST JSON con headers multilínea', () => {
    const c = importCurl(`curl -X POST 'https://api.example.com/v1/items?x=1' \\
  -H 'Content-Type: application/json' \\
  -H "Authorization: Bearer abc" \\
  --data-raw '{"name":"a b"}' --compressed`)
    const req = (c.item[0] as RequestItem).request
    expect(req.method).toBe('POST')
    expect(rawUrl(req.url)).toBe('https://api.example.com/v1/items?x=1')
    expect(req.header).toEqual([
      { key: 'Content-Type', value: 'application/json' },
      { key: 'Authorization', value: 'Bearer abc' },
    ])
    expect(req.body).toEqual({ mode: 'raw', raw: '{"name":"a b"}', options: { raw: { language: 'json' } } })
  })
  it('form-data, basic auth y POST implícito', () => {
    const c = importCurl(`curl https://x.io/up -u user:pass -F file=@/tmp/a.png -F 'title=hola mundo'`)
    const req = (c.item[0] as RequestItem).request
    expect(req.method).toBe('POST')
    expect(req.auth?.type).toBe('basic')
    expect(req.body?.formdata).toEqual([
      { key: 'file', type: 'file', src: '/tmp/a.png' },
      { key: 'title', value: 'hola mundo', type: 'text' },
    ])
  })
  it('urlencoded y -G', () => {
    const a = importCurl(`curl https://x.io/t -d grant_type=client_credentials -d scope=read%20write`)
    expect((a.item[0] as RequestItem).request.body?.urlencoded).toEqual([
      { key: 'grant_type', value: 'client_credentials' },
      { key: 'scope', value: 'read write' },
    ])
    const b = importCurl(`curl -G https://x.io/s -d q=hola`)
    const req = (b.item[0] as RequestItem).request
    expect(req.method).toBe('GET')
    expect(rawUrl(req.url)).toBe('https://x.io/s?q=hola')
  })
  it('--json y URL sin protocolo', () => {
    const c = importCurl(`curl --json '{"a":1}' localhost:8080/api`)
    const req = (c.item[0] as RequestItem).request
    expect(rawUrl(req.url)).toBe('http://localhost:8080/api')
    expect(req.header?.map((h) => h.key)).toEqual(['Content-Type', 'Accept'])
  })
})

describe('detección', () => {
  it('rechaza basura', async () => {
    await expect(importAny('hola que tal')).rejects.toThrow()
    await expect(importAny('{"foo":1}')).rejects.toThrow('Formato no reconocido')
  })
})
