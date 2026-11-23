import type { Collection, Contract } from '@cartero/core'
import { describe, expect, it } from 'vitest'
import {
  attachContracts,
  collectionToOpenApi,
  diffContracts,
  formatIssue,
  inferSchema,
  openApiPath,
  requestContractFrom,
  sampleFromSchema,
  validateRequest,
  validateResponse,
  validateValue,
} from './index.js'

const user = {
  id: 'b3c1a2e4-1111-4222-8333-944455556666',
  email: 'ana@example.com',
  age: 30,
  tags: ['a'],
  boss: null,
}

describe('inferSchema', () => {
  it('saca tipos, obligatorios, formatos y ejemplos', () => {
    const s = inferSchema(user)
    expect(s.type).toBe('object')
    expect(s.required).toEqual(['id', 'email', 'age', 'tags', 'boss'])
    expect(s.properties.id).toMatchObject({ type: 'string', format: 'uuid' })
    expect(s.properties.email).toMatchObject({ type: 'string', format: 'email', example: 'ana@example.com' })
    expect(s.properties.age).toMatchObject({ type: 'integer' })
    expect(s.properties.tags).toMatchObject({ type: 'array', items: { type: 'string' } })
  })

  it('fusiona los elementos de una lista', () => {
    const s = inferSchema([{ a: 1, b: 'x' }, { a: 2.5 }, { a: null, c: true }])
    expect(s.items.properties.a.type).toEqual(['number', 'null'])
    expect(s.items.required).toEqual(['a'])
    expect(Object.keys(s.items.properties)).toEqual(['a', 'b', 'c'])
  })
})

describe('validar respuestas', () => {
  const contract: Contract = {
    responses: {
      '200': { body: inferSchema(user), headers: [{ name: 'X-Request-Id', required: true }] },
      '404': { body: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] } },
    },
  }

  it('acepta una respuesta que cumple', () => {
    const issues = validateResponse(contract, {
      status: 200,
      headers: [{ key: 'x-request-id', value: '1' }],
      body: JSON.stringify(user),
    })
    expect(issues).toEqual([])
  })

  it('señala qué campo falla y por qué', () => {
    const issues = validateResponse(contract, {
      status: 200,
      headers: [],
      body: JSON.stringify({ ...user, email: 'no-es-email', age: '30', extra: 1, id: undefined }),
    })
    const text = issues.map(formatIssue)
    expect(text).toContain('X-Request-Id: Falta la cabecera obligatoria')
    expect(text).toContain('$.id: Es obligatorio y no ha llegado')
    expect(text).toContain('$.email: No tiene formato email')
    expect(text).toContain('$.age: Se esperaba integer y ha llegado string')
    const extra = issues.find((i) => i.path === '$.extra')
    expect(extra?.level).toBe('warning')
  })

  it('avisa de códigos no previstos y de respuestas que no son JSON', () => {
    expect(validateResponse(contract, { status: 500, headers: [], body: '' })[0]).toMatchObject({
      where: 'status',
      params: ['200, 404'],
    })
    expect(validateResponse(contract, { status: 404, headers: [], body: '<html>' })[0].message).toMatch(
      /no es JSON/,
    )
  })

  it('entiende el nullable de OpenAPI 3.0', () => {
    expect(validateValue({ type: 'string', nullable: true }, null)).toEqual([])
  })
})

describe('validar peticiones', () => {
  it('comprueba params, cabeceras y cuerpo', () => {
    const contract: Contract = {
      request: {
        path: [{ name: 'id', required: true, schema: { type: 'integer' } }],
        query: [{ name: 'page', required: true }],
        headers: [{ name: 'Authorization', required: true }],
        body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
      responses: {},
    }
    const issues = validateRequest(contract, {
      path: [{ key: 'id', value: 'abc' }],
      query: [],
      headers: [{ key: 'authorization', value: 'Bearer x' }],
      body: '{}',
    })
    expect(issues.map(formatIssue)).toEqual([
      'id: Se esperaba integer y ha llegado string',
      'page: Falta el parámetro obligatorio',
      '$.name: Es obligatorio y no ha llegado',
    ])
  })

  it('saca la parte de petición de la petición actual', () => {
    const r = requestContractFrom({
      method: 'POST',
      url: { raw: '{{baseUrl}}/users/:id?full=1', query: [{ key: 'full', value: '1' }] },
      header: [{ key: 'Authorization', value: 'x' }],
      body: { mode: 'raw', raw: '{"name":"Ana"}' },
    })
    expect(r.path?.[0].name).toBe('id')
    expect(r.query?.[0].name).toBe('full')
    expect(r.headers?.[0].name).toBe('Authorization')
    expect(r.body?.properties.name.type).toBe('string')
  })
})

describe('sampleFromSchema', () => {
  it('genera un valor que cumple el esquema', () => {
    const schema = inferSchema(user, { examples: false })
    const sample = sampleFromSchema(schema)
    expect(validateValue(schema, sample)).toEqual([])
  })
  it('usa ejemplos y enum', () => {
    expect(sampleFromSchema({ type: 'string', enum: ['a', 'b'] })).toBe('a')
    expect(sampleFromSchema({ type: 'object', properties: { n: { type: 'integer', example: 7 } } })).toEqual({
      n: 7,
    })
  })
})

describe('diffContracts', () => {
  const v1: Contract = {
    request: { body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    responses: {
      '200': {
        body: {
          type: 'object',
          properties: { id: { type: 'integer' }, email: { type: 'string' } },
          required: ['id', 'email'],
        },
      },
      '404': {},
    },
  }

  it('separa lo que rompe de lo compatible', () => {
    const v2: Contract = {
      request: {
        body: {
          type: 'object',
          properties: { name: { type: 'string' }, age: { type: 'integer' }, nick: { type: 'string' } },
          required: ['name', 'age'],
        },
      },
      responses: {
        '200': {
          body: {
            type: 'object',
            properties: { id: { type: 'string' }, avatar: { type: 'string' } },
            required: ['id'],
          },
        },
        '201': {},
      },
    }
    const changes = diffContracts(v1, v2)
    const breaking = changes.filter((c) => c.breaking).map((c) => `${c.section} ${c.path} ${c.message}`)
    const compatible = changes.filter((c) => !c.breaking).map((c) => `${c.section} ${c.path} ${c.message}`)
    expect(breaking).toEqual([
      'request $.age Nuevo campo obligatorio',
      '200 $.id Cambia el tipo: {0} → {1}',
      '200 $.email Se quita el campo',
      '404 404 Se quita este código de respuesta',
    ])
    expect(compatible).toEqual([
      'request $.nick Nuevo campo opcional',
      '200 $.avatar Nuevo campo opcional',
      '201 201 Nuevo código de respuesta',
    ])
  })

  it('no ve cambios si el contrato es el mismo', () => {
    expect(diffContracts(v1, structuredClone(v1))).toEqual([])
  })
})

describe('OpenAPI', () => {
  const collection: Collection = {
    info: { name: 'Usuarios', version: '2.0.0' },
    item: [
      {
        name: 'Usuarios',
        item: [
          {
            name: 'Ver usuario',
            request: { method: 'GET', url: 'https://api.example.com/users/:id' },
            contract: {
              request: { path: [{ name: 'id', required: true, schema: { type: 'integer' } }] },
              responses: {
                '200': { body: inferSchema(user, { examples: false }) },
                '404': { description: 'No existe' },
              },
            },
          },
          {
            name: 'Crear usuario',
            request: {
              method: 'POST',
              url: '{{baseUrl}}/users',
              body: { mode: 'raw', raw: '{"name":"Ana"}' },
            },
            response: [{ name: 'Creado', code: 201, body: '{"id":1}' }],
          },
        ],
      },
    ],
  }

  it('convierte rutas de Cartero', () => {
    expect(openApiPath('{{baseUrl}}/users/:id/posts/{{postId}}?x=1')).toBe('/users/{id}/posts/{postId}')
    expect(openApiPath('https://api.example.com/')).toBe('/')
  })

  it('exporta contratos y deduce lo que no tiene contrato', () => {
    const { spec } = collectionToOpenApi(collection)
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.servers).toEqual([{ url: 'https://api.example.com' }])
    const get = spec.paths['/users/{id}'].get
    expect(get.tags).toEqual(['Usuarios'])
    expect(get.parameters[0]).toMatchObject({
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'integer' },
    })
    expect(get.responses['200'].content['application/json'].schema.properties.email.format).toBe('email')
    expect(get.responses['404'].description).toBe('No existe')
    const post = spec.paths['/users'].post
    expect(post.requestBody.content['application/json'].example).toEqual({ name: 'Ana' })
    expect(post.responses['201'].content['application/json'].schema.properties.id.type).toBe('integer')
  })

  it('ida y vuelta: los contratos vuelven a sus peticiones', () => {
    const { spec } = collectionToOpenApi(collection)
    const copy = structuredClone(collection)
    for (const it of (copy.item[0] as any).item) delete it.contract
    expect(attachContracts(copy, JSON.parse(JSON.stringify(spec)))).toBe(2)
    const get = (copy.item[0] as any).item[0]
    expect(get.contract.request.path[0].schema).toEqual({ type: 'integer' })
    expect(get.contract.responses['200'].body.properties.email.format).toBe('email')
  })

  it('resuelve $ref y nullable de OpenAPI 3.0', () => {
    const spec = {
      openapi: '3.0.3',
      paths: {
        '/pets/{petId}': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
              },
            },
          },
        },
      },
      components: {
        schemas: { Pet: { type: 'object', properties: { name: { type: 'string', nullable: true } } } },
      },
    }
    const col: Collection = {
      info: { name: 'x' },
      item: [{ name: 'p', request: { method: 'GET', url: '{{baseUrl}}/pets/:petId' } }],
    }
    expect(attachContracts(col, spec)).toBe(1)
    expect((col.item[0] as any).contract.responses['200'].body.properties.name.type).toEqual([
      'string',
      'null',
    ])
  })
})
