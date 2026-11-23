import { describe, expect, it } from 'vitest'
import type { Collection } from '@cartero/core'
import { matchExample, mockResponse, resolveDynamic } from '@cartero/mock'

const col: Collection = {
  info: { name: 'm' },
  item: [
    {
      name: 'Get user',
      request: { method: 'GET', url: '{{baseUrl}}/users/:id' },
      response: [
        { name: 'OK', code: 200, body: '{"id":"x","email":"{{$randomEmail}}"}', originalRequest: { method: 'GET', url: '{{baseUrl}}/users/:id' } },
        { name: 'No existe', code: 404, body: '{"error":"nf"}', originalRequest: { method: 'GET', url: '{{baseUrl}}/users/:id' } },
      ],
    },
    {
      name: 'Me',
      request: { method: 'GET', url: '{{baseUrl}}/users/me' },
      response: [{ name: 'Yo', code: 200, body: 'me', originalRequest: { method: 'GET', url: 'https://api.x.com/users/me' } }],
    },
    {
      name: 'Search',
      request: { method: 'GET', url: 'https://api.x.com/search?q=a' },
      response: [
        { name: 'A', code: 200, body: 'a', originalRequest: { method: 'GET', url: 'https://api.x.com/search?q=a' } },
        { name: 'B', code: 200, body: 'b', originalRequest: { method: 'GET', url: 'https://api.x.com/search?q=b' } },
      ],
    },
  ],
}

const req = (method: string, path: string, query = {}, headers = {}) => ({ method, path, query, headers })

describe('mock matcher', () => {
  it('prefiere ruta exacta sobre parámetro', () => {
    expect(matchExample(col, req('GET', '/users/me'))?.example.name).toBe('Yo')
    expect(matchExample(col, req('GET', '/users/42'))?.example.name).toBe('OK')
  })
  it('respeta x-mock-response-name y code', () => {
    expect(matchExample(col, req('GET', '/users/42', {}, { 'x-mock-response-name': 'No existe' }))?.example.code).toBe(404)
    expect(matchExample(col, req('GET', '/users/42', {}, { 'x-mock-response-code': '404' }))?.example.name).toBe('No existe')
  })
  it('usa la query para desempatar', () => {
    expect(matchExample(col, req('GET', '/search', { q: 'b' }))?.example.name).toBe('B')
  })
  it('{{baseUrl}} inicial hace de host aunque incluya ruta', () => {
    expect(matchExample(col, req('GET', '/users/7'), [{ baseUrl: 'http://x.com/api/v2' }])?.example.name).toBe('OK')
  })
  it('método distinto no encaja y devuelve 404', () => {
    expect(mockResponse(col, req('DELETE', '/users/1')).status).toBe(404)
  })
  it('resuelve variables dinámicas', () => {
    const r = mockResponse(col, req('GET', '/users/1'))
    expect(JSON.parse(r.body).email).toMatch(/@/)
    expect(resolveDynamic('{{$guid}}')).toMatch(/^[0-9a-f-]{36}$/)
  })
})
