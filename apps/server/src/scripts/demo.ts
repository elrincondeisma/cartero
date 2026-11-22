/**
 * Datos de demostración con APIs públicas reales, reversibles.
 *
 *   pnpm --filter @cartero/server demo seed   --email tu@email.com
 *   pnpm --filter @cartero/server demo revert --email tu@email.com
 *
 * Todo se crea en un workspace de equipo propio («Demo Cartero») más un usuario
 * colaborador de demo (@demo.cartero.local). Revertir borra exactamente eso.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { and, eq, inArray, like } from 'drizzle-orm'
import { config } from '../config.js'
import { db, schema, sqlClient } from '../db/index.js'
import { randomToken, sha256 } from '../lib/crypto.js'

const WORKSPACE_NAME = 'Demo Cartero'
const DEMO_DOMAIN = '@demo.cartero.local'
const API = process.env.CARTERO_API ?? `http://127.0.0.1:${config.port}`
/** Un manifiesto por cuenta, para no mezclar demos de usuarios distintos. */
const manifestPath = (email: string) => path.resolve(config.filesDir, '..', `demo-manifest-${sha256(email.toLowerCase()).slice(0, 12)}.json`)
const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

type Json = any

// ---------------------------------------------------------------- HTTP

function client(auth: { token?: string; cookie?: string }) {
  return async function call<T = Json>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${url}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
        ...(auth.cookie ? { cookie: auth.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 300)}`)
    return (text ? JSON.parse(text) : undefined) as T
  }
}

async function tempToken(userId: string) {
  const token = `crt_${randomToken(24)}`
  const [row] = await db
    .insert(schema.apiTokens)
    .values({ userId, name: 'cartero-demo (temporal)', tokenHash: sha256(token), prefix: token.slice(0, 10) })
    .returning()
  return { token, id: row.id }
}

async function findUser(email: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase()))
  if (!u) throw new Error(`No existe ninguna cuenta con el email ${email}`)
  return u
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const js = (lines: string) => lines.trim().split('\n')
const test = (code: string) => [{ listen: 'test', script: { type: 'text/javascript', exec: js(code) } }]
const pre = (code: string) => [{ listen: 'prerequest', script: { type: 'text/javascript', exec: js(code) } }]
const raw = (o: unknown) => ({ mode: 'raw', raw: JSON.stringify(o, null, 2), options: { raw: { language: 'json' } } })
const jsonHeader = [{ key: 'Content-Type', value: 'application/json' }]

// ---------------------------------------------------------------- Colecciones

const blog = {
  info: {
    name: 'Blog — JSONPlaceholder',
    schema: SCHEMA,
    description: `# API del blog

API REST de ejemplo de [JSONPlaceholder](https://jsonplaceholder.typicode.com): posts, usuarios y comentarios.

- **Base URL:** \`{{baseUrl}}\`
- Las escrituras (POST/PUT/PATCH/DELETE) se simulan: responden como si funcionaran, pero no guardan nada.
- Cada petición tiene tests y un **ejemplo real guardado**, que es lo que devuelve el *mock server* «Mock del blog».`,
  },
  variable: [
    { key: 'baseUrl', value: 'https://jsonplaceholder.typicode.com' },
    { key: 'postId', value: '1' },
  ],
  event: [
    ...pre(`pm.variables.set('inicio', Date.now());`),
    ...test(`pm.test('Responde en menos de 3 s', () => pm.expect(pm.response.responseTime).to.be.below(3000));`),
  ],
  item: [
    {
      name: 'Posts',
      description: 'Entradas del blog.',
      item: [
        {
          name: 'Listar posts',
          request: { method: 'GET', header: [], url: '{{baseUrl}}/posts?_limit=10', description: 'Devuelve los 10 primeros posts. Quita `_limit` para recibir los 100.' },
          event: test(`
pm.test('Código 200', () => pm.response.to.have.status(200));
const posts = pm.response.json();
pm.test('Devuelve 10 posts', () => pm.expect(posts).to.have.lengthOf(10));
pm.test('Cada post tiene id, título y cuerpo', () => posts.forEach(p => pm.expect(p).to.include.keys('id', 'title', 'body', 'userId')));`),
        },
        {
          name: 'Obtener post',
          request: { method: 'GET', header: [], url: '{{baseUrl}}/posts/{{postId}}' },
          event: test(`
pm.test('Código 200', () => pm.response.to.have.status(200));
pm.test('Es el post pedido', () => pm.expect(pm.response.json().id).to.eql(Number(pm.variables.get('postId'))));`),
        },
        {
          name: 'Crear post',
          request: {
            method: 'POST',
            header: jsonHeader,
            body: raw({ title: '{{$randomLoremSentence}}', body: '{{$randomLoremParagraph}}', userId: 1 }),
            url: '{{baseUrl}}/posts',
            description: 'Usa variables dinámicas (`{{$randomLoremSentence}}`) para generar un título distinto en cada envío.',
          },
          event: test(`
pm.test('Código 201 Created', () => pm.response.to.have.status(201));
const post = pm.response.json();
pm.test('Devuelve el id nuevo', () => pm.expect(post.id).to.be.a('number'));
pm.collectionVariables.set('ultimoPostCreado', post.id);
console.log('Post creado con id', post.id);`),
        },
        {
          name: 'Actualizar post',
          request: { method: 'PUT', header: jsonHeader, body: raw({ id: 1, title: 'Título actualizado desde Cartero', body: 'Contenido nuevo', userId: 1 }), url: '{{baseUrl}}/posts/1' },
          event: test(`pm.test('Código 200', () => pm.response.to.have.status(200));
pm.test('Título cambiado', () => pm.expect(pm.response.json().title).to.eql('Título actualizado desde Cartero'));`),
        },
        {
          name: 'Editar título (PATCH)',
          request: { method: 'PATCH', header: jsonHeader, body: raw({ title: 'Solo cambio el título' }), url: '{{baseUrl}}/posts/1' },
          event: test(`pm.test('Código 200', () => pm.response.to.have.status(200));`),
        },
        {
          name: 'Borrar post',
          request: { method: 'DELETE', header: [], url: '{{baseUrl}}/posts/1' },
          event: test(`pm.test('Código 200', () => pm.response.to.have.status(200));`),
        },
      ],
    },
    {
      name: 'Usuarios',
      item: [
        {
          name: 'Listar usuarios',
          request: { method: 'GET', header: [], url: '{{baseUrl}}/users' },
          event: test(`pm.test('Hay 10 usuarios', () => pm.expect(pm.response.json()).to.have.lengthOf(10));`),
        },
        {
          name: 'Obtener usuario',
          request: {
            method: 'GET',
            header: [],
            url: { raw: '{{baseUrl}}/users/:userId', host: ['{{baseUrl}}'], path: ['users', ':userId'], variable: [{ key: 'userId', value: '3', description: 'Id del usuario (1-10)' }] },
            description: 'Ejemplo de **variable de ruta** (`:userId`), editable en la pestaña Params.',
          },
          event: test(`const u = pm.response.json();
pm.test('Tiene email válido', () => pm.expect(u.email).to.match(/@/));
pm.test('Cumple el schema', () => pm.response.to.have.jsonSchema({ type: 'object', required: ['id', 'name', 'email', 'address'], properties: { id: { type: 'number' }, name: { type: 'string' } } }));`),
        },
        {
          name: 'Tareas de un usuario',
          request: { method: 'GET', header: [], url: '{{baseUrl}}/todos?userId=1&completed=false' },
          event: test(`pm.test('Todas pendientes', () => pm.response.json().forEach(t => pm.expect(t.completed).to.be.false));`),
        },
      ],
    },
    {
      name: 'Comentarios',
      item: [
        {
          name: 'Comentarios de un post',
          request: { method: 'GET', header: [], url: '{{baseUrl}}/posts/{{postId}}/comments' },
          event: test(`pm.test('Al menos un comentario', () => pm.expect(pm.response.json().length).to.be.above(0));`),
        },
      ],
    },
  ],
}

const httpbin = {
  info: {
    name: 'httpbin — Autenticación y HTTP',
    schema: SCHEMA,
    description: `Pruebas de autenticación y del protocolo HTTP contra [httpbin.org](https://httpbin.org).

Activa el entorno **«httpbin (credenciales)»**: guarda usuario, contraseña, token y API key como variables, las secretas cifradas.`,
  },
  variable: [{ key: 'baseUrl', value: 'https://httpbin.org' }],
  item: [
    {
      name: 'Autenticación',
      item: [
        {
          name: 'Basic Auth',
          request: {
            method: 'GET',
            header: [],
            url: '{{baseUrl}}/basic-auth/{{usuario}}/{{password}}',
            auth: { type: 'basic', basic: [{ key: 'username', value: '{{usuario}}', type: 'string' }, { key: 'password', value: '{{password}}', type: 'string' }] },
          },
          event: test(`pm.test('Autenticado', () => pm.expect(pm.response.json().authenticated).to.be.true);`),
        },
        {
          name: 'Digest Auth',
          request: {
            method: 'GET',
            header: [],
            url: '{{baseUrl}}/digest-auth/auth/{{usuario}}/{{password}}',
            auth: { type: 'digest', digest: [{ key: 'username', value: '{{usuario}}', type: 'string' }, { key: 'password', value: '{{password}}', type: 'string' }] },
          },
          event: test(`pm.test('Autenticado con Digest', () => pm.response.to.have.status(200));`),
        },
        {
          name: 'Bearer token',
          request: { method: 'GET', header: [], url: '{{baseUrl}}/bearer', auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] } },
          event: test(`pm.test('Token aceptado', () => pm.expect(pm.response.json().token).to.eql(pm.environment.get('token')));`),
        },
        {
          name: 'API key en cabecera',
          request: {
            method: 'GET',
            header: [],
            url: '{{baseUrl}}/headers',
            auth: { type: 'apikey', apikey: [{ key: 'key', value: 'X-API-Key', type: 'string' }, { key: 'value', value: '{{apiKey}}', type: 'string' }, { key: 'in', value: 'header', type: 'string' }] },
          },
          event: test(`pm.test('La cabecera llega al servidor', () => pm.expect(pm.response.json().headers['X-Api-Key']).to.eql(pm.environment.get('apiKey')));`),
        },
      ],
    },
    {
      name: 'HTTP',
      item: [
        {
          name: 'Soy una tetera (418)',
          request: { method: 'GET', header: [], url: '{{baseUrl}}/status/418' },
          event: test(`pm.test('Código 418', () => pm.response.to.have.status(418));`),
        },
        {
          name: 'Seguir redirecciones',
          request: { method: 'GET', header: [], url: '{{baseUrl}}/redirect/2' },
          event: test(`pm.test('Termina en /get', () => pm.expect(pm.response.json().url).to.include('/get'));`),
        },
        {
          name: 'Respuesta lenta (1 s)',
          request: { method: 'GET', header: [], url: '{{baseUrl}}/delay/1' },
          event: test(`pm.test('Tarda al menos 1 s', () => pm.expect(pm.response.responseTime).to.be.above(1000));`),
        },
        {
          name: 'Guardar una cookie',
          request: { method: 'GET', header: [], url: '{{baseUrl}}/cookies/set?sabor=chocolate' },
          event: test(`pm.test('La cookie queda en el jar', () => pm.expect(pm.response.json().cookies.sabor).to.eql('chocolate'));`),
        },
        {
          name: 'Formulario urlencoded',
          request: {
            method: 'POST',
            header: [],
            url: '{{baseUrl}}/post',
            body: { mode: 'urlencoded', urlencoded: [{ key: 'nombre', value: 'Ismael' }, { key: 'herramienta', value: 'Cartero' }] },
          },
          event: test(`pm.test('El servidor recibe el formulario', () => pm.expect(pm.response.json().form.herramienta).to.eql('Cartero'));`),
        },
        {
          name: 'UUID aleatorio',
          request: { method: 'GET', header: [], url: '{{baseUrl}}/uuid' },
          event: test(`const { uuid } = pm.response.json();
pm.test('Es un UUID', () => pm.expect(uuid).to.match(/^[0-9a-f-]{36}$/));
pm.environment.set('ultimoUuid', uuid);`),
        },
        { name: 'Imagen PNG', request: { method: 'GET', header: [{ key: 'Accept', value: 'image/png' }], url: '{{baseUrl}}/image/png', description: 'Abre la pestaña **Vista previa** de la respuesta.' } },
        { name: 'Página HTML', request: { method: 'GET', header: [], url: '{{baseUrl}}/html' } },
      ],
    },
  ],
}

const clima = {
  info: {
    name: 'Clima — Open-Meteo',
    schema: SCHEMA,
    description: `Encadena dos APIs reales de [Open-Meteo](https://open-meteo.com) sin clave:

1. **Buscar ciudad** → un script guarda latitud y longitud.
2. **Tiempo actual** y **Previsión** usan esas variables.

Cambia de ciudad con el entorno (Madrid, Barcelona, Ciudad de México…) o ejecútala en el runner con un CSV de ciudades.`,
  },
  variable: [
    { key: 'geoUrl', value: 'https://geocoding-api.open-meteo.com/v1' },
    { key: 'meteoUrl', value: 'https://api.open-meteo.com/v1' },
    { key: 'lat', value: '40.4165' },
    { key: 'lon', value: '-3.70256' },
  ],
  item: [
    {
      name: '1. Buscar ciudad',
      request: { method: 'GET', header: [], url: '{{geoUrl}}/search?name={{ciudad}}&count=1&language=es' },
      event: test(`
const r = pm.response.json().results;
pm.test('Encuentra la ciudad', () => pm.expect(r).to.be.an('array').that.is.not.empty);
pm.collectionVariables.set('lat', r[0].latitude);
pm.collectionVariables.set('lon', r[0].longitude);
pm.collectionVariables.set('lugar', r[0].name + ', ' + r[0].country);
console.log('Coordenadas de', r[0].name, r[0].latitude, r[0].longitude);`),
    },
    {
      name: '2. Tiempo actual',
      request: { method: 'GET', header: [], url: '{{meteoUrl}}/forecast?latitude={{lat}}&longitude={{lon}}&current=temperature_2m,relative_humidity_2m,wind_speed_10m&timezone=auto' },
      event: test(`
const c = pm.response.json().current;
pm.test('Hay temperatura', () => pm.expect(c.temperature_2m).to.be.a('number'));
pm.test('Temperatura razonable', () => pm.expect(c.temperature_2m).to.be.within(-60, 60));
console.log(\`Ahora en \${pm.collectionVariables.get('lugar') || pm.variables.get('ciudad')}: \${c.temperature_2m} °C, humedad \${c.relative_humidity_2m}%, viento \${c.wind_speed_10m} km/h\`);`),
    },
    {
      name: '3. Previsión 7 días',
      request: { method: 'GET', header: [], url: '{{meteoUrl}}/forecast?latitude={{lat}}&longitude={{lon}}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto' },
      event: test(`
const d = pm.response.json().daily;
pm.test('7 días de previsión', () => pm.expect(d.time).to.have.lengthOf(7));
pm.test('Máxima ≥ mínima', () => d.temperature_2m_max.forEach((max, i) => pm.expect(max).to.be.at.least(d.temperature_2m_min[i])));`),
    },
  ],
}

const pokeapi = {
  info: { name: 'PokeAPI', schema: SCHEMA, description: 'La [PokeAPI](https://pokeapi.co): listados paginados y peticiones encadenadas por URL.' },
  variable: [
    { key: 'baseUrl', value: 'https://pokeapi.co/api/v2' },
    { key: 'pokemon', value: 'pikachu' },
  ],
  item: [
    {
      name: 'Listar Pokémon',
      request: { method: 'GET', header: [], url: '{{baseUrl}}/pokemon?limit=20&offset=0' },
      event: test(`pm.test('20 resultados', () => pm.expect(pm.response.json().results).to.have.lengthOf(20));`),
    },
    {
      name: 'Obtener Pokémon',
      request: { method: 'GET', header: [], url: '{{baseUrl}}/pokemon/{{pokemon}}' },
      event: test(`
const p = pm.response.json();
pm.test('Es el Pokémon pedido', () => pm.expect(p.name).to.eql(pm.variables.get('pokemon')));
pm.collectionVariables.set('especieUrl', p.species.url);
console.log(p.name, 'tipos:', p.types.map(t => t.type.name).join(', '));`),
    },
    {
      name: 'Especie (encadenada)',
      request: { method: 'GET', header: [], url: '{{especieUrl}}', description: 'La URL la guarda el script de «Obtener Pokémon».' },
      event: test(`
const s = pm.response.json();
const es = s.flavor_text_entries.find(f => f.language.name === 'es');
if (es) console.log('Descripción:', es.flavor_text.replace(/\\s+/g, ' '));
pm.collectionVariables.set('evolucionUrl', s.evolution_chain.url);
pm.test('Tiene cadena evolutiva', () => pm.expect(s.evolution_chain.url).to.include('evolution-chain'));`),
    },
    {
      name: 'Cadena evolutiva (encadenada)',
      request: { method: 'GET', header: [], url: '{{evolucionUrl}}' },
      event: test(`
const nombres = [];
let n = pm.response.json().chain;
while (n) { nombres.push(n.species.name); n = n.evolves_to[0]; }
console.log('Evolución:', nombres.join(' → '));
pm.test('Incluye al Pokémon', () => pm.expect(nombres).to.include(pm.variables.get('pokemon')));`),
    },
  ],
}

const paises = {
  info: { name: 'Países — GraphQL', schema: SCHEMA, description: 'Consultas GraphQL reales contra [countries.trevorblades.com](https://countries.trevorblades.com).' },
  variable: [{ key: 'gqlUrl', value: 'https://countries.trevorblades.com/' }],
  item: [
    {
      name: 'País por código',
      request: {
        method: 'POST',
        header: [],
        url: '{{gqlUrl}}',
        body: {
          mode: 'graphql',
          graphql: { query: 'query Pais($code: ID!) {\n  country(code: $code) {\n    name\n    native\n    capital\n    emoji\n    currency\n    languages { name }\n  }\n}', variables: '{\n  "code": "ES"\n}' },
        },
      },
      event: test(`const c = pm.response.json().data.country;
pm.test('Es España', () => pm.expect(c.name).to.eql('Spain'));
console.log(c.emoji, c.native, '· capital:', c.capital, '· moneda:', c.currency);`),
    },
    {
      name: 'Países de Sudamérica',
      request: {
        method: 'POST',
        header: [],
        url: '{{gqlUrl}}',
        body: { mode: 'graphql', graphql: { query: '{\n  continent(code: "SA") {\n    name\n    countries { code name emoji capital }\n  }\n}', variables: '' } },
      },
      event: test(`pm.test('Más de 10 países', () => pm.expect(pm.response.json().data.continent.countries.length).to.be.above(10));`),
    },
  ],
}

// ---------------------------------------------------------------- Seed

async function waitRun(call: ReturnType<typeof client>, runId: string) {
  for (let i = 0; i < 120; i++) {
    const run = await call('GET', `/api/runs/${runId}`)
    if (run.status !== 'running') return run
    await sleep(1000)
  }
  throw new Error(`El run ${runId} no terminó a tiempo`)
}

/** Ejecuta cada petición y guarda su respuesta real como ejemplo. */
async function saveRealExamples(call: ReturnType<typeof client>, ws: string, collectionId: string, environmentId?: string) {
  const col = await call('GET', `/api/collections/${collectionId}`)
  let n = 0
  for (const row of col.items.filter((i: Json) => i.type === 'request')) {
    const item = { id: row.id, name: row.name, ...row.data }
    const r = await call('POST', `/api/workspaces/${ws}/execute`, { collectionId, item, environmentId: environmentId ?? null })
    const res = r.execution?.response
    if (!res || res.body === undefined) continue
    const example = {
      name: `${res.code} ${res.status} (respuesta real)`,
      originalRequest: row.data.request,
      status: res.status,
      code: res.code,
      header: res.headers.filter((h: Json) => /content-type|cache-control|x-ratelimit/i.test(h.key)),
      cookie: [],
      body: res.body,
      _postman_previewlanguage: /json/.test(res.contentType ?? '') ? 'json' : 'text',
      responseTime: Math.round(res.time),
    }
    const fresh = (await call('GET', `/api/collections/${collectionId}`)).items.find((i: Json) => i.id === row.id)
    await call('PATCH', `/api/items/${row.id}`, { data: { ...fresh.data, response: [...(fresh.data.response ?? []), example] }, version: fresh.version })
    n++
  }
  return n
}

async function seed(email: string) {
  const MANIFEST = manifestPath(email)
  const user = await findUser(email)
  const existing = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .innerJoin(schema.members, eq(schema.members.workspaceId, schema.workspaces.id))
    .where(and(eq(schema.workspaces.name, WORKSPACE_NAME), eq(schema.members.userId, user.id)))
  if (existing.length) throw new Error(`Ya existe «${WORKSPACE_NAME}». Ejecuta antes: demo revert --email ${email}`)

  const tok = await tempToken(user.id)
  const call = client({ token: tok.token })
  const manifest: Json = { email, userId: user.id, createdAt: new Date().toISOString(), demoUsers: [] }
  const step = (s: string) => console.log(`• ${s}`)

  try {
    const ws = (await call('POST', '/api/workspaces', { name: WORKSPACE_NAME })).id
    manifest.workspaceId = ws
    step(`Workspace «${WORKSPACE_NAME}»`)

    // Globales y entornos
    await call('PUT', `/api/workspaces/${ws}/globals`, [
      { key: 'idioma', value: 'es' },
      { key: 'appNombre', value: 'Cartero Demo' },
    ])
    const envs: Record<string, string> = {}
    for (const [name, values] of [
      ['Madrid', [{ key: 'ciudad', value: 'Madrid' }]],
      ['Barcelona', [{ key: 'ciudad', value: 'Barcelona' }]],
      ['Ciudad de México', [{ key: 'ciudad', value: 'Ciudad de México' }]],
      [
        'httpbin (credenciales)',
        [
          { key: 'usuario', value: 'cartero' },
          { key: 'password', value: 'demo-1234', type: 'secret' },
          { key: 'token', value: `demo-${randomToken(12)}`, type: 'secret' },
          { key: 'apiKey', value: `key-${randomToken(10)}`, type: 'secret', description: 'Se envía en la cabecera X-API-Key' },
        ],
      ],
    ] as const) {
      envs[name] = (await call('POST', `/api/workspaces/${ws}/environments`, { name, values })).id
    }
    step('Globales y 4 entornos (las credenciales de httpbin, cifradas)')

    // Colecciones: importadas en distintos formatos
    const imp = async (text: string) => (await call('POST', `/api/workspaces/${ws}/import`, { text })).collections[0].id
    const ids: Record<string, string> = {}
    ids.blog = await imp(JSON.stringify(blog))
    ids.httpbin = await imp(JSON.stringify(httpbin))
    ids.clima = await imp(JSON.stringify(clima))
    ids.poke = await imp(JSON.stringify(pokeapi))
    ids.paises = await imp(JSON.stringify(paises))
    step('5 colecciones importadas (formato Postman v2.1)')

    const petstore = await call('POST', `/api/workspaces/${ws}/import`, { url: 'https://petstore3.swagger.io/api/v3/openapi.json' })
    ids.petstore = petstore.collections[0].id
    const pet = await call('GET', `/api/collections/${ids.petstore}`)
    await call('PATCH', `/api/collections/${ids.petstore}`, {
      name: 'Petstore — importada de OpenAPI',
      data: {
        description: 'Importada directamente de la especificación OpenAPI 3 publicada en https://petstore3.swagger.io/api/v3/openapi.json',
        variable: (pet.data.variable ?? []).map((v: Json) => (v.key === 'baseUrl' ? { ...v, value: 'https://petstore3.swagger.io/api/v3' } : v)),
      },
    })
    step('Petstore importada desde su URL de OpenAPI')

    const gh = await call('POST', `/api/workspaces/${ws}/import`, {
      text: `curl -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' https://api.github.com/repos/postmanlabs/postman-runtime`,
    })
    ids.github = gh.collections[0].id
    await call('PATCH', `/api/collections/${ids.github}`, { name: 'GitHub — importada de cURL' })
    const ghCol = await call('GET', `/api/collections/${ids.github}`)
    const ghItem = ghCol.items[0]
    await call('PATCH', `/api/items/${ghItem.id}`, {
      name: 'Repositorio postman-runtime',
      data: { ...ghItem.data, event: test(`const r = pm.response.json();\npm.test('Repo público', () => pm.expect(r.private).to.be.false);\nconsole.log(r.full_name, '⭐', r.stargazers_count);`) },
      version: ghItem.version,
    })
    step('GitHub importada desde un comando cURL')

    // Ejemplos reales (alimentan el mock y la documentación)
    let examples = 0
    examples += await saveRealExamples(call, ws, ids.blog)
    examples += await saveRealExamples(call, ws, ids.clima, envs.Madrid)
    examples += await saveRealExamples(call, ws, ids.poke)
    // Un 404 manual para enseñar x-mock-response-code
    const blogCol = await call('GET', `/api/collections/${ids.blog}`)
    const getPost = blogCol.items.find((i: Json) => i.name === 'Obtener post')
    await call('PATCH', `/api/items/${getPost.id}`, {
      data: {
        ...getPost.data,
        response: [
          ...(getPost.data.response ?? []),
          { name: 'Post no encontrado', code: 404, status: 'Not Found', originalRequest: getPost.data.request, header: jsonHeader, body: '{\n  "error": "Post no encontrado"\n}' },
        ],
      },
      version: getPost.version,
    })
    step(`${examples + 1} ejemplos guardados a partir de respuestas reales`)

    // Runs: uno por colección y uno con datos (varias ciudades)
    const runs = [
      await call('POST', `/api/collections/${ids.blog}/runs`, {}),
      await call('POST', `/api/collections/${ids.httpbin}/runs`, { environmentId: envs['httpbin (credenciales)'] }),
      await call('POST', `/api/collections/${ids.poke}/runs`, {}),
      await call('POST', `/api/collections/${ids.paises}/runs`, {}),
      await call('POST', `/api/collections/${ids.github}/runs`, {}),
      await call('POST', `/api/collections/${ids.clima}/runs`, {
        environmentId: envs.Madrid,
        data: [{ ciudad: 'Madrid' }, { ciudad: 'Sevilla' }, { ciudad: 'Bilbao' }, { ciudad: 'Tokio' }, { ciudad: 'Buenos Aires' }],
        persistVariables: false,
      }),
    ]
    for (const r of runs) {
      const run = await waitRun(call, r.runId)
      step(`Run «${run.name}»: ${run.status} (${run.stats.assertions - run.stats.failedAssertions}/${run.stats.assertions} tests)`)
    }

    // Mock server
    const mock = await call('POST', `/api/workspaces/${ws}/mocks`, { collectionId: ids.blog, name: 'Mock del blog', delayMs: 150 })
    for (const [p, headers] of [
      ['/posts', {}],
      ['/posts/1', {}],
      ['/posts/1', { 'x-mock-response-code': '404' }],
      ['/users/7', {}],
      ['/posts/1/comments', {}],
      ['/no-existe', {}],
    ] as const) {
      await fetch(`${API}/mock/${mock.slug}${p}`, { headers })
    }
    await fetch(`${API}/mock/${mock.slug}/posts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"title":"hola"}' })
    step(`Mock server en ${config.publicUrl}/mock/${mock.slug}`)

    // Documentación publicada
    const suffix = randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')
    const docBlog = await call('PUT', `/api/collections/${ids.blog}/docs`, { slug: `blog-demo-${suffix}`, published: true })
    const docClima = await call('PUT', `/api/collections/${ids.clima}/docs`, { slug: `clima-demo-${suffix}`, published: true, environmentId: envs.Madrid })
    step(`Documentación: ${config.publicUrl}/docs/${docBlog.slug} y /docs/${docClima.slug}`)

    // Monitores (se ejecutan de verdad; uno se lanza ya para tener historial)
    const m1 = await call('POST', `/api/workspaces/${ws}/monitors`, {
      collectionId: ids.httpbin,
      environmentId: envs['httpbin (credenciales)'],
      name: 'Salud de httpbin',
      cron: '0 * * * *',
      timezone: 'Europe/Madrid',
    })
    const m2 = await call('POST', `/api/workspaces/${ws}/monitors`, {
      collectionId: ids.clima,
      environmentId: envs.Madrid,
      name: 'El tiempo en Madrid',
      cron: '0 8 * * *',
      timezone: 'Europe/Madrid',
    })
    await call('POST', `/api/monitors/${m1.id}/run`)
    await call('POST', `/api/monitors/${m2.id}/run`)
    step('2 monitores (cada hora y cada día a las 8:00, Europa/Madrid)')

    // Colaboración: una compañera de demo
    const lauraEmail = `laura-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, 'x')}${DEMO_DOMAIN}`
    const inv = await call('POST', `/api/workspaces/${ws}/invitations`, { email: lauraEmail, role: 'editor' })
    const reg = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: lauraEmail, name: 'Laura Martín (demo)', password: randomToken(16), invitation: inv.link.split('/').pop() }),
    })
    if (!reg.ok) throw new Error(`No se pudo crear la usuaria de demo: ${await reg.text()}`)
    const cookie = reg.headers.get('set-cookie')!.split(';')[0]
    const laura = client({ cookie })
    const lauraUser = await laura('GET', '/api/auth/me')
    manifest.demoUsers.push(lauraUser.id)
    // El registro le crea un workspace personal: se apunta para borrarlo al revertir
    manifest.demoWorkspaces = (await laura('GET', '/api/workspaces')).filter((w: Json) => w.type === 'personal').map((w: Json) => w.id)

    const blog2 = await call('GET', `/api/collections/${ids.blog}`)
    const crear = blog2.items.find((i: Json) => i.name === 'Crear post')
    const listar = blog2.items.find((i: Json) => i.name === 'Listar posts')
    await laura('POST', `/api/collections/${ids.blog}/comments`, { itemId: crear.id, body: '¿Validamos también que el título no venga vacío? En producción nos ha pasado.' })
    await call('POST', `/api/collections/${ids.blog}/comments`, { itemId: crear.id, body: 'Buena idea, lo añado al test. 👍' })
    await laura('POST', `/api/collections/${ids.blog}/comments`, { itemId: listar.id, body: 'He subido el límite de tiempo a 3 s en la colección, que JSONPlaceholder a veces va lento.' })
    // Laura edita una petición (queda en el historial de cambios)
    await laura('PATCH', `/api/items/${listar.id}`, {
      data: { ...listar.data, request: { ...listar.data.request, header: [{ key: 'Accept', value: 'application/json', description: 'Añadido por Laura' }] } },
      version: listar.version,
    })
    // …y crea un fork para probar cambios sin tocar la original
    const fork = await laura('POST', `/api/collections/${ids.blog}/fork`, { workspaceId: ws, name: 'Blog — fork de Laura' })
    const forkCol = await laura('GET', `/api/collections/${fork.id}`)
    const folder = forkCol.items.find((i: Json) => i.name === 'Posts')
    await laura('POST', `/api/collections/${fork.id}/items`, {
      type: 'request',
      name: 'Buscar posts por usuario',
      parentId: folder.id,
      data: { request: { method: 'GET', header: [], url: { raw: '{{baseUrl}}/posts?userId=2', host: ['{{baseUrl}}'], path: ['posts'], query: [{ key: 'userId', value: '2' }] } } },
    })
    step('Colaboradora de demo (Laura): comentarios, un cambio y un fork')

    manifest.collections = ids
    manifest.environments = envs
    manifest.mock = mock.slug
    manifest.monitors = [m1.id, m2.id]
    mkdirSync(path.dirname(MANIFEST), { recursive: true })
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
    console.log(`\nListo. En Cartero, cambia al workspace «${WORKSPACE_NAME}» desde el selector de arriba.`)
    console.log(`Para deshacerlo: pnpm --filter @cartero/server demo revert --email ${email}`)
  } catch (e) {
    mkdirSync(path.dirname(MANIFEST), { recursive: true })
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
    console.error(`\nError: ${(e as Error).message}\nLo creado hasta ahora se puede borrar con «demo revert».`)
    process.exitCode = 1
  } finally {
    await db.delete(schema.apiTokens).where(eq(schema.apiTokens.id, tok.id))
  }
}

// ---------------------------------------------------------------- Revert

async function revert(email: string) {
  const MANIFEST = manifestPath(email)
  const user = await findUser(email)
  const manifest: Json = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {}

  // Workspaces de demo: los del manifiesto y, por si acaso, los que se llamen igual y sean del usuario
  const byName = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .innerJoin(schema.members, eq(schema.members.workspaceId, schema.workspaces.id))
    .where(and(eq(schema.workspaces.name, WORKSPACE_NAME), eq(schema.members.userId, user.id), eq(schema.members.role, 'owner')))
  const wsIds = [...new Set([manifest.workspaceId, ...byName.map((w) => w.id)].filter(Boolean))] as string[]

  // Usuarios de demo de ESTA demo: los del manifiesto y los @demo.cartero.local que son miembros de sus workspaces
  const memberDemo = wsIds.length
    ? await db
        .select({ id: schema.users.id })
        .from(schema.members)
        .innerJoin(schema.users, eq(schema.users.id, schema.members.userId))
        .where(and(inArray(schema.members.workspaceId, wsIds), like(schema.users.email, `%${DEMO_DOMAIN}`)))
    : []
  const userIds = [...new Set([...(manifest.demoUsers ?? []), ...memberDemo.map((u) => u.id)])] as string[]

  const tok = await tempToken(user.id)
  const call = client({ token: tok.token })
  try {
    for (const id of wsIds) {
      await call('DELETE', `/api/workspaces/${id}`).catch((e) => console.warn(`  (workspace ${id}: ${e.message})`))
      console.log(`• Workspace ${id} eliminado (colecciones, entornos, mocks, monitores, docs, runs e historial)`)
    }
    if (userIds.length) {
      const personal = await db
        .select({ id: schema.members.workspaceId })
        .from(schema.members)
        .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.members.workspaceId))
        .where(and(inArray(schema.members.userId, userIds), eq(schema.workspaces.type, 'personal')))
      if (personal.length) await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, personal.map((p) => p.id)))
      await db.delete(schema.users).where(inArray(schema.users.id, userIds))
      console.log(`• ${userIds.length} usuario(s) de demo eliminado(s)`)
    }
    if (existsSync(MANIFEST)) rmSync(MANIFEST)
    console.log('\nDemo revertida. Tu workspace personal y tu cuenta no se han tocado.')
  } finally {
    await db.delete(schema.apiTokens).where(eq(schema.apiTokens.id, tok.id))
  }
}

// ---------------------------------------------------------------- CLI

const [cmd, ...rest] = process.argv.slice(2)
const email = rest[rest.indexOf('--email') + 1]
if (!['seed', 'revert'].includes(cmd) || !rest.includes('--email') || !email) {
  console.error('Uso: demo seed|revert --email tu@email.com')
  process.exit(2)
}
try {
  await (cmd === 'seed' ? seed(email) : revert(email))
} finally {
  await sqlClient.end()
}
