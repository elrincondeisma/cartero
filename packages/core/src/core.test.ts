import { describe, expect, it } from 'vitest'
import { extractVariableNames, parseUrl, resolveVariables, toScope, urlToString } from './index.js'

describe('parseUrl', () => {
  it('parsea url completa', () => {
    const u = parseUrl('https://api.example.com:8443/v1/users/:id?page=2&flag#top')
    expect(u.protocol).toBe('https')
    expect(u.host).toEqual(['api', 'example', 'com'])
    expect(u.port).toBe('8443')
    expect(u.path).toEqual(['v1', 'users', ':id'])
    expect(u.query).toEqual([
      { key: 'page', value: '2' },
      { key: 'flag', value: null },
    ])
    expect(u.hash).toBe('top')
    expect(u.variable).toEqual([{ key: 'id', value: '' }])
  })
  it('respeta variables en el host', () => {
    const u = parseUrl('{{baseUrl}}/users')
    expect(u.host).toEqual(['{{baseUrl}}'])
    expect(u.path).toEqual(['users'])
    expect(urlToString({ ...u, raw: '' })).toBe('{{baseUrl}}/users')
  })
})

describe('variables', () => {
  it('resuelve por capas con prioridad y anidadas', () => {
    const out = resolveVariables('{{url}}/x?t={{token}}&u={{missing}}', [
      { url: 'http://a', token: 'g' },
      toScope([{ key: 'token', value: 'env' }, { key: 'host', value: 'h', disabled: true }]),
      { url: '{{proto}}://b', proto: 'https' },
    ])
    expect(out).toBe('https://b/x?t=env&u={{missing}}')
  })
  it('extrae nombres', () => {
    expect(extractVariableNames('{{a}} {{ b }} {{a}}')).toEqual(['a', 'b'])
  })
})
