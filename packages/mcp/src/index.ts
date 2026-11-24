/**
 * Servidor MCP de Cartero. Expone tus workspaces, colecciones, entornos, runner y mocks
 * como herramientas para asistentes de IA (Claude, Cursor, etc.).
 *
 * Todas las herramientas usan la API REST de Cartero con el token del usuario,
 * así que respetan sus permisos (un lector no puede modificar nada).
 */
import { readFileSync } from 'node:fs'
import type { Contract } from '@cartero/core'
import {
  checkExchange,
  diffContracts,
  formatChange,
  formatIssue,
  hasContract,
  inferFromText,
  requestContractFrom,
  summarizeChanges,
  validateValue,
} from '@cartero/contracts'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export interface CarteroMcpOptions {
  /** URL base de la API de Cartero (ej. http://localhost:3000) */
  baseUrl: string
  /** Token de API (crt_…) */
  token: string
  /** URL pública (para enlaces que se devuelven al usuario). Por defecto, baseUrl */
  publicUrl?: string
  /** Versión que se anuncia a los clientes MCP. Por defecto, la del paquete */
  version?: string
}

/** Versión de este paquete, leída de su package.json (no hace falta tocarla a mano en cada versión). */
function packageVersion(): string {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  } catch {
    return '0.0.0'
  }
}

type Json = any
const MAX_BODY = 20_000

export function createCarteroMcpServer(opts: CarteroMcpOptions): McpServer {
  const base = opts.baseUrl.replace(/\/$/, '')
  const pub = (opts.publicUrl ?? base).replace(/\/$/, '')

  async function api<T = Json>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${opts.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) {
      let msg = text
      try {
        msg = JSON.parse(text).message ?? text
      } catch {}
      throw new Error(`Cartero respondió ${res.status}: ${msg}`)
    }
    return (text ? JSON.parse(text) : undefined) as T
  }

  /** Como api(), pero devuelve el texto tal cual (para YAML). */
  async function apiText(path: string): Promise<string> {
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${opts.token}` } })
    const text = await res.text()
    if (!res.ok) throw new Error(`Cartero respondió ${res.status}: ${text}`)
    return text
  }

  const ok = (data: unknown) => ({
    content: [
      { type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) },
    ],
  })
  const fail = (e: unknown) => ({
    content: [{ type: 'text' as const, text: (e as Error).message }],
    isError: true,
  })
  const wrap =
    <A>(fn: (a: A) => Promise<unknown>) =>
    async (a: A) => {
      try {
        return ok(await fn(a))
      } catch (e) {
        return fail(e)
      }
    }

  const rawUrl = (u: Json) => (typeof u === 'string' ? u : (u?.raw ?? ''))
  const getExec = (events: Json[] | undefined, listen: string) => {
    const e = events?.find((x) => x.listen === listen)?.script?.exec
    return Array.isArray(e) ? e.join('\n') : (e ?? '')
  }
  const setExec = (events: Json[] | undefined, listen: string, code: string | undefined) => {
    if (code === undefined) return events
    const list = (events ?? []).filter((e) => e.listen !== listen)
    if (code.trim()) list.push({ listen, script: { type: 'text/javascript', exec: code.split('\n') } })
    return list.length ? list : undefined
  }
  const toHeaders = (h?: Record<string, string>) =>
    Object.entries(h ?? {}).map(([key, value]) => ({ key, value }))
  const toBody = (body?: string, contentType?: string) => {
    if (body === undefined || body === '') return undefined
    const lang = /json/.test(contentType ?? '')
      ? 'json'
      : /xml/.test(contentType ?? '')
        ? 'xml'
        : (() => {
            try {
              JSON.parse(body)
              return 'json'
            } catch {
              return 'text'
            }
          })()
    return { mode: 'raw', raw: body, options: { raw: { language: lang } } }
  }

  /** Resumen legible de una ejecución para el modelo. */
  function summarizeExecution(ex: Json, console?: Json[]) {
    if (!ex) return { error: 'No se ejecutó ninguna petición' }
    const r = ex.response
    let body = r?.body
    let truncated = false
    if (body && body.length > MAX_BODY) {
      body = body.slice(0, MAX_BODY)
      truncated = true
    }
    try {
      if (body && /json/.test(r?.contentType ?? '')) body = JSON.parse(body)
    } catch {}
    return {
      request: ex.request ? `${ex.request.method} ${ex.request.url}` : undefined,
      error: ex.error,
      status: r ? `${r.code} ${r.status}` : undefined,
      timeMs: r ? Math.round(r.time) : undefined,
      sizeBytes: r?.size?.body,
      headers: r ? Object.fromEntries(r.headers.map((h: Json) => [h.key, h.value])) : undefined,
      body: r?.bodyBase64 ? `(binario ${r.contentType}, ${r.size.body} bytes)` : body,
      bodyTruncated: truncated || undefined,
      tests: ex.tests?.length
        ? ex.tests.map(
            (t: Json) =>
              `${t.passed ? '✓' : t.skipped ? '-' : '✗'} ${t.name}${t.error ? ` — ${t.error}` : ''}`,
          )
        : undefined,
      scriptErrors: [ex.prerequestError, ex.testScriptError].filter(Boolean),
      console: console?.length
        ? console.map((c) =>
            c.messages.map((m: Json) => (typeof m === 'string' ? m : JSON.stringify(m))).join(' '),
          )
        : undefined,
    }
  }

  function tree(items: Json[]) {
    const byParent = new Map<string | null, Json[]>()
    for (const i of items) byParent.set(i.parentId, [...(byParent.get(i.parentId) ?? []), i])
    const build = (p: string | null): Json[] =>
      (byParent.get(p) ?? [])
        .sort((a, b) => (a.sort < b.sort ? -1 : 1))
        .map((i) =>
          i.type === 'folder'
            ? { carpeta: i.name, id: i.id, items: build(i.id) }
            : {
                peticion: i.name,
                id: i.id,
                method: i.data.request?.method,
                url: rawUrl(i.data.request?.url),
                ejemplos: i.data.response?.length || undefined,
                contrato: hasContract(i.data.contract) || undefined,
              },
        )
    return build(null)
  }

  const server = new McpServer(
    { name: 'cartero', version: opts.version ?? packageVersion(), title: 'Cartero' },
    {
      instructions:
        'Cartero es un cliente de APIs (alternativa a Postman). Flujo típico: listar_workspaces → listar_colecciones → ver_coleccion → ver_peticion / enviar_peticion. ' +
        'Las peticiones se envían desde el servidor de Cartero con las variables del entorno elegido y ejecutan sus scripts pm.* y tests. ' +
        'Los valores de variables secretas nunca se muestran. No hay herramientas para borrar: hazlo desde la interfaz. ' +
        'Cada petición puede tener un contrato (lo que envía el frontend y lo que debe devolver el backend por código de estado, en JSON Schema): ' +
        'ver_contrato, generar_contrato, guardar_contrato, validar_contrato, historial_contrato y exportar_openapi.',
    },
  )

  const ro = { readOnlyHint: true, openWorldHint: false }

  server.registerTool(
    'listar_workspaces',
    {
      title: 'Listar workspaces',
      description: 'Workspaces a los que tienes acceso, con tu rol en cada uno.',
      inputSchema: {},
      annotations: ro,
    },
    wrap(async () => api('GET', '/api/workspaces')),
  )

  server.registerTool(
    'listar_colecciones',
    {
      title: 'Listar colecciones',
      description: 'Colecciones de un workspace con su número de peticiones.',
      inputSchema: { workspaceId: z.string().describe('Id del workspace') },
      annotations: ro,
    },
    wrap(async ({ workspaceId }: { workspaceId: string }) =>
      api('GET', `/api/workspaces/${workspaceId}/collections`),
    ),
  )

  server.registerTool(
    'ver_coleccion',
    {
      title: 'Ver colección',
      description:
        'Árbol de carpetas y peticiones de una colección (con ids, métodos y URLs), su descripción, variables y autenticación.',
      inputSchema: { collectionId: z.string() },
      annotations: ro,
    },
    wrap(async ({ collectionId }: { collectionId: string }) => {
      const c = await api('GET', `/api/collections/${collectionId}`)
      return {
        id: c.id,
        nombre: c.name,
        workspaceId: c.workspaceId,
        descripcion: c.data.description,
        autenticacion: c.data.auth?.type,
        variables: (c.data.variable ?? []).map((v: Json) => ({
          key: v.key,
          value: v.type === 'secret' ? '••••' : v.value,
        })),
        items: tree(c.items),
      }
    }),
  )

  server.registerTool(
    'buscar_peticiones',
    {
      title: 'Buscar peticiones',
      description: 'Busca peticiones por nombre o URL en todas las colecciones de un workspace.',
      inputSchema: {
        workspaceId: z.string(),
        texto: z.string().describe('Texto a buscar en el nombre o la URL'),
      },
      annotations: ro,
    },
    wrap(async ({ workspaceId, texto }: { workspaceId: string; texto: string }) => {
      const q = texto.toLowerCase()
      const cols = await api<Json[]>('GET', `/api/workspaces/${workspaceId}/collections`)
      const out: Json[] = []
      for (const c of cols) {
        const detail = await api('GET', `/api/collections/${c.id}`)
        for (const i of detail.items)
          if (
            i.type === 'request' &&
            (i.name.toLowerCase().includes(q) || rawUrl(i.data.request?.url).toLowerCase().includes(q))
          )
            out.push({
              id: i.id,
              nombre: i.name,
              coleccion: c.name,
              collectionId: c.id,
              method: i.data.request?.method,
              url: rawUrl(i.data.request?.url),
            })
      }
      return out.length ? out : 'Sin resultados'
    }),
  )

  server.registerTool(
    'ver_peticion',
    {
      title: 'Ver petición',
      description:
        'Detalle completo de una petición guardada: método, URL, cabeceras, body, autenticación, scripts y ejemplos.',
      inputSchema: { requestId: z.string() },
      annotations: ro,
    },
    wrap(async ({ requestId }: { requestId: string }) => {
      const i = await api('GET', `/api/items/${requestId}`)
      const r = i.data.request ?? {}
      return {
        id: i.id,
        nombre: i.name,
        collectionId: i.collectionId,
        workspaceId: i.workspaceId,
        method: r.method,
        url: rawUrl(r.url),
        headers: r.header,
        body: r.body,
        autenticacion: r.auth ? r.auth.type : 'heredada',
        scriptPreRequest: getExec(i.data.event, 'prerequest') || undefined,
        scriptTests: getExec(i.data.event, 'test') || undefined,
        ejemplos: (i.data.response ?? []).map((e: Json) => ({ nombre: e.name, code: e.code })),
        contrato: hasContract(i.data.contract)
          ? `códigos ${Object.keys(i.data.contract.responses ?? {}).join(', ') || '—'} (detalle con ver_contrato)`
          : undefined,
        descripcion: r.description,
      }
    }),
  )

  server.registerTool(
    'enviar_peticion',
    {
      title: 'Enviar petición',
      description:
        'Envía una petición y devuelve la respuesta (estado, tiempo, cabeceras, body), los resultados de los tests y la consola. ' +
        'Pasa requestId para enviar una petición guardada (con la auth y scripts de su colección), o method+url (+headers/body) para una petición suelta. ' +
        'Admite {{variables}} del entorno indicado.',
      inputSchema: {
        workspaceId: z.string().optional().describe('Obligatorio si no pasas requestId'),
        requestId: z.string().optional(),
        method: z.string().optional(),
        url: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.string().optional().describe('Body en texto (JSON, XML…)'),
        environmentId: z.string().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    wrap(
      async (a: {
        workspaceId?: string
        requestId?: string
        method?: string
        url?: string
        headers?: Record<string, string>
        body?: string
        environmentId?: string
      }) => {
        let ws = a.workspaceId
        let item: Json
        let collectionId: string | null = null
        if (a.requestId) {
          const i = await api('GET', `/api/items/${a.requestId}`)
          ws = i.workspaceId
          collectionId = i.collectionId
          item = { id: i.id, name: i.name, ...i.data }
          if (a.method || a.url || a.headers || a.body !== undefined) {
            const r = { ...item.request }
            if (a.method) r.method = a.method.toUpperCase()
            if (a.url) r.url = a.url
            if (a.headers)
              r.header = [
                ...(r.header ?? []).filter((h: Json) => !(h.key in a.headers!)),
                ...toHeaders(a.headers),
              ]
            if (a.body !== undefined)
              r.body = toBody(a.body, a.headers?.['Content-Type'] ?? a.headers?.['content-type'])
            item.request = r
          }
        } else {
          if (!ws || !a.url) throw new Error('Indica requestId, o workspaceId + url')
          item = {
            name: `${a.method ?? 'GET'} ${a.url}`,
            request: {
              method: (a.method ?? 'GET').toUpperCase(),
              url: a.url,
              header: toHeaders(a.headers),
              body: toBody(a.body, a.headers?.['Content-Type'] ?? a.headers?.['content-type']),
            },
          }
        }
        const r = await api('POST', `/api/workspaces/${ws}/execute`, {
          collectionId,
          item,
          environmentId: a.environmentId ?? null,
        })
        return {
          ...summarizeExecution(r.execution, r.console),
          variablesModificadas: r.variablesChanged?.length ? r.variablesChanged : undefined,
        }
      },
    ),
  )

  server.registerTool(
    'crear_coleccion',
    {
      title: 'Crear colección',
      description: 'Crea una colección vacía en un workspace.',
      inputSchema: { workspaceId: z.string(), nombre: z.string() },
    },
    wrap(async ({ workspaceId, nombre }: { workspaceId: string; nombre: string }) => {
      const c = await api('POST', `/api/workspaces/${workspaceId}/collections`, { name: nombre })
      return { id: c.id, nombre: c.name }
    }),
  )

  server.registerTool(
    'crear_carpeta',
    {
      title: 'Crear carpeta',
      description: 'Crea una carpeta en una colección (opcionalmente dentro de otra carpeta).',
      inputSchema: { collectionId: z.string(), nombre: z.string(), carpetaPadreId: z.string().optional() },
    },
    wrap(
      async ({
        collectionId,
        nombre,
        carpetaPadreId,
      }: {
        collectionId: string
        nombre: string
        carpetaPadreId?: string
      }) => {
        const r = await api('POST', `/api/collections/${collectionId}/items`, {
          type: 'folder',
          name: nombre,
          parentId: carpetaPadreId ?? null,
        })
        return { id: r.id, nombre: r.name }
      },
    ),
  )

  const requestFields = {
    nombre: z.string().optional(),
    method: z.string().optional(),
    url: z.string().optional().describe('Admite {{variables}}, p. ej. {{baseUrl}}/users'),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    scriptPreRequest: z
      .string()
      .optional()
      .describe('JavaScript con la API pm.* que se ejecuta antes de enviar'),
    scriptTests: z
      .string()
      .optional()
      .describe('JavaScript con pm.test(...) que se ejecuta tras la respuesta'),
    descripcion: z.string().optional().describe('Markdown'),
  }

  server.registerTool(
    'crear_peticion',
    {
      title: 'Crear petición',
      description: 'Guarda una petición nueva en una colección, con tests opcionales.',
      inputSchema: {
        collectionId: z.string(),
        carpetaId: z.string().optional(),
        ...requestFields,
        nombre: z.string(),
        url: z.string(),
      },
    },
    wrap(async (a: Json) => {
      const request = {
        method: (a.method ?? 'GET').toUpperCase(),
        url: a.url,
        header: toHeaders(a.headers),
        body: toBody(a.body, a.headers?.['Content-Type'] ?? a.headers?.['content-type']),
        description: a.descripcion,
      }
      let event = setExec(undefined, 'prerequest', a.scriptPreRequest)
      event = setExec(event, 'test', a.scriptTests)
      const r = await api('POST', `/api/collections/${a.collectionId}/items`, {
        type: 'request',
        name: a.nombre,
        parentId: a.carpetaId ?? null,
        data: { request, response: [], ...(event ? { event } : {}) },
      })
      return { id: r.id, nombre: r.name }
    }),
  )

  server.registerTool(
    'actualizar_peticion',
    {
      title: 'Actualizar petición',
      description: 'Modifica una petición guardada. Solo cambia los campos que indiques.',
      inputSchema: { requestId: z.string(), ...requestFields },
    },
    wrap(async (a: Json) => {
      const i = await api('GET', `/api/items/${a.requestId}`)
      const r = { ...(i.data.request ?? {}) }
      if (a.method) r.method = a.method.toUpperCase()
      if (a.url) r.url = a.url
      if (a.headers) r.header = toHeaders(a.headers)
      if (a.body !== undefined) r.body = toBody(a.body, a.headers?.['Content-Type'])
      if (a.descripcion !== undefined) r.description = a.descripcion
      let event = setExec(i.data.event, 'prerequest', a.scriptPreRequest)
      event = setExec(event, 'test', a.scriptTests)
      const saved = await api('PATCH', `/api/items/${a.requestId}`, {
        name: a.nombre,
        data: { ...i.data, request: r, event },
        version: i.version,
      })
      return { id: saved.id, nombre: saved.name, version: saved.version }
    }),
  )

  server.registerTool(
    'ejecutar_coleccion',
    {
      title: 'Ejecutar colección',
      description:
        'Lanza el runner sobre una colección o carpeta, espera a que termine (máx. 5 min) y devuelve el resumen y los fallos.',
      inputSchema: {
        collectionId: z.string(),
        carpetaId: z.string().optional(),
        environmentId: z.string().optional(),
        iteraciones: z.number().int().min(1).max(100).optional(),
        datos: z
          .array(z.record(z.string(), z.any()))
          .optional()
          .describe('Una fila por iteración; accesibles como {{columna}}'),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    wrap(
      async (a: {
        collectionId: string
        carpetaId?: string
        environmentId?: string
        iteraciones?: number
        datos?: Json[]
      }) => {
        const { runId } = await api('POST', `/api/collections/${a.collectionId}/runs`, {
          folderId: a.carpetaId ?? null,
          environmentId: a.environmentId ?? null,
          iterations: a.iteraciones,
          data: a.datos,
        })
        let run: Json
        for (let i = 0; i < 300; i++) {
          run = await api('GET', `/api/runs/${runId}`)
          if (run.status !== 'running') break
          await new Promise((r) => setTimeout(r, 1000))
        }
        const execs: Json[] = run.result?.executions ?? []
        return {
          runId,
          estado: run.status,
          resumen: run.stats,
          fallos: execs
            .flatMap((x) => [
              ...(x.error ? [`${x.name}: ${x.error}`] : []),
              ...x.tests
                .filter((t: Json) => !t.passed && !t.skipped)
                .map((t: Json) => `${x.name} › ${t.name}: ${t.error ?? 'falló'}`),
            ])
            .slice(0, 50),
          peticiones: execs.map(
            (x) =>
              `${x.request?.method} ${x.name} → ${x.error ? 'ERROR' : (x.response?.code ?? '?')} (${Math.round(x.response?.time ?? 0)} ms, ${x.tests.filter((t: Json) => t.passed).length}/${x.tests.length} tests)`,
          ),
          error: run.result?.error,
        }
      },
    ),
  )

  server.registerTool(
    'listar_entornos',
    {
      title: 'Listar entornos',
      description: 'Entornos del workspace con sus variables. Los valores secretos se ocultan.',
      inputSchema: { workspaceId: z.string() },
      annotations: ro,
    },
    wrap(async ({ workspaceId }: { workspaceId: string }) => {
      const envs = await api<Json[]>('GET', `/api/workspaces/${workspaceId}/environments`)
      return envs.map((e) => ({
        id: e.id,
        nombre: e.name,
        variables: e.values.map((v: Json) => ({
          key: v.key,
          value: v.type === 'secret' ? '••••' : v.value,
          secreta: v.type === 'secret' || undefined,
          desactivada: v.disabled || undefined,
        })),
      }))
    }),
  )

  server.registerTool(
    'guardar_variable',
    {
      title: 'Guardar variable de entorno',
      description: 'Crea o cambia una variable en un entorno.',
      inputSchema: {
        environmentId: z.string(),
        key: z.string(),
        value: z.string(),
        secreta: z.boolean().optional(),
      },
    },
    wrap(async (a: { environmentId: string; key: string; value: string; secreta?: boolean }) => {
      // Necesitamos el entorno completo: lo buscamos en sus workspaces
      const wss = await api<Json[]>('GET', '/api/workspaces')
      for (const w of wss) {
        const envs = await api<Json[]>('GET', `/api/workspaces/${w.id}/environments`)
        const env = envs.find((e) => e.id === a.environmentId)
        if (!env) continue
        const values = env.values.filter((v: Json) => v.key !== a.key)
        const prev = env.values.find((v: Json) => v.key === a.key)
        values.push({
          ...prev,
          key: a.key,
          value: a.value,
          ...((a.secreta ?? prev?.type === 'secret') ? { type: 'secret' } : {}),
        })
        await api('PUT', `/api/environments/${env.id}`, { values })
        return `Variable «${a.key}» guardada en «${env.name}»`
      }
      throw new Error('Entorno no encontrado')
    }),
  )

  server.registerTool(
    'importar',
    {
      title: 'Importar',
      description:
        'Importa en un workspace una colección o entorno de Postman, Insomnia, una especificación OpenAPI/Swagger o un comando cURL (pega el texto o indica una URL).',
      inputSchema: {
        workspaceId: z.string(),
        texto: z.string().optional(),
        url: z.string().url().optional(),
      },
    },
    wrap(async (a: { workspaceId: string; texto?: string; url?: string }) => {
      if (!a.texto && !a.url) throw new Error('Indica texto o url')
      return api(
        'POST',
        `/api/workspaces/${a.workspaceId}/import`,
        a.url ? { url: a.url } : { text: a.texto },
      )
    }),
  )

  server.registerTool(
    'generar_codigo',
    {
      title: 'Generar código',
      description:
        'Genera el código para hacer una petición guardada en otro lenguaje (curl, nodejs, python, go, java, csharp, php, ruby, swift, kotlin…).',
      inputSchema: {
        requestId: z.string(),
        lenguaje: z.string().default('curl'),
        variante: z
          .string()
          .optional()
          .describe('Ej. para nodejs: Axios, Native, Request; para python: Requests, http.client'),
        environmentId: z.string().optional(),
      },
      annotations: ro,
    },
    wrap(async (a: { requestId: string; lenguaje: string; variante?: string; environmentId?: string }) => {
      const i = await api('GET', `/api/items/${a.requestId}`)
      const langs = await api<Json[]>('GET', '/api/snippets/languages')
      const lang = langs.find((l) => l.key === a.lenguaje.toLowerCase())
      if (!lang) throw new Error(`Lenguaje no soportado. Opciones: ${langs.map((l) => l.key).join(', ')}`)
      const variant = a.variante && lang.variants.includes(a.variante) ? a.variante : lang.variants[0]
      const r = await api('POST', `/api/workspaces/${i.workspaceId}/snippet`, {
        request: i.data.request,
        language: lang.key,
        variant,
        collectionId: i.collectionId,
        environmentId: a.environmentId ?? null,
      })
      return r.snippet
    }),
  )

  server.registerTool(
    'listar_ejecuciones',
    {
      title: 'Listar ejecuciones',
      description: 'Últimas ejecuciones del runner, monitores y CLI en un workspace.',
      inputSchema: { workspaceId: z.string(), collectionId: z.string().optional() },
      annotations: ro,
    },
    wrap(async ({ workspaceId, collectionId }: { workspaceId: string; collectionId?: string }) => {
      const runs = await api<Json[]>(
        'GET',
        `/api/workspaces/${workspaceId}/runs${collectionId ? `?collectionId=${collectionId}` : ''}`,
      )
      return runs
        .slice(0, 30)
        .map((r) => ({
          id: r.id,
          nombre: r.name,
          estado: r.status,
          origen: r.source,
          inicio: r.startedAt,
          resumen: r.stats,
        }))
    }),
  )

  server.registerTool(
    'crear_mock',
    {
      title: 'Crear mock server',
      description:
        'Crea un mock server que responde con los ejemplos guardados de una colección o, si una petición no tiene ejemplo que encaje, con datos generados desde su contrato. Devuelve su URL.',
      inputSchema: {
        workspaceId: z.string(),
        collectionId: z.string(),
        nombre: z.string(),
        retardoMs: z.number().int().min(0).max(60000).optional(),
      },
    },
    wrap(async (a: { workspaceId: string; collectionId: string; nombre: string; retardoMs?: number }) => {
      const m = await api('POST', `/api/workspaces/${a.workspaceId}/mocks`, {
        collectionId: a.collectionId,
        name: a.nombre,
        delayMs: a.retardoMs ?? 0,
      })
      return { id: m.id, url: `${pub}/mock/${m.slug}` }
    }),
  )

  server.registerTool(
    'listar_mocks',
    {
      title: 'Listar mock servers',
      description: 'Mock servers de un workspace con sus URLs.',
      inputSchema: { workspaceId: z.string() },
      annotations: ro,
    },
    wrap(async ({ workspaceId }: { workspaceId: string }) => {
      const mocks = await api<Json[]>('GET', `/api/workspaces/${workspaceId}/mocks`)
      return mocks.map((m) => ({
        id: m.id,
        nombre: m.name,
        coleccion: m.collection,
        url: `${pub}/mock/${m.slug}`,
        privado: m.isPrivate,
      }))
    }),
  )

  // ---------- Contratos ----------

  /** Envía una petición guardada y devuelve el ítem y el resultado de la ejecución. */
  async function executeSaved(requestId: string, environmentId?: string) {
    const i = await api('GET', `/api/items/${requestId}`)
    const r = await api('POST', `/api/workspaces/${i.workspaceId}/execute`, {
      collectionId: i.collectionId,
      item: { id: i.id, name: i.name, ...i.data },
      environmentId: environmentId ?? null,
    })
    return { i, r }
  }

  /** Esquemas del contrato que ajv no sabe compilar. */
  function invalidSchemas(c: Contract): string[] {
    const out: string[] = []
    const check = (where: string, schema: unknown) => {
      if (!schema) return
      if (
        validateValue(schema as Json, null).some((x) =>
          x.message.startsWith('El esquema del contrato no es válido'),
        )
      )
        out.push(where)
    }
    check('petición › cuerpo', c.request?.body)
    for (const kind of ['path', 'query', 'headers'] as const)
      for (const p of c.request?.[kind] ?? []) check(`petición › ${kind} ${p.name}`, p.schema)
    for (const [code, r] of Object.entries(c.responses ?? {})) {
      check(`${code} › cuerpo`, r.body)
      for (const h of r.headers ?? []) check(`${code} › cabecera ${h.name}`, h.schema)
    }
    return out
  }

  /** Guarda (o quita, con null) el contrato de una petición. Si rompe, exige confirmarlo. */
  async function saveContract(i: Json, contract: Contract | null, acceptBreaking?: boolean) {
    if (contract) {
      if (!contract.responses || typeof contract.responses !== 'object')
        throw new Error('El contrato necesita un objeto «responses» (aunque esté vacío)')
      const bad = invalidSchemas(contract)
      if (bad.length) throw new Error(`Estos esquemas no son JSON Schema válido: ${bad.join('; ')}`)
    }
    // Un contrato nuevo no rompe nada: nadie lo usa todavía
    const isNew = !hasContract(i.data.contract)
    const changes = isNew ? [] : diffContracts(i.data.contract, contract ?? undefined)
    const breaking = changes.filter((c) => c.breaking)
    if (breaking.length && !acceptBreaking)
      throw new Error(
        `No se ha guardado: estos cambios rompen a quien ya usa el contrato:\n- ${breaking.map(formatChange).join('\n- ')}\n` +
          'Si estás seguro, repite la llamada con aceptarCambiosQueRompen: true.',
      )
    const { contract: _old, ...rest } = i.data
    const data = contract ? { ...rest, contract } : rest
    const saved = await api('PATCH', `/api/items/${i.id}`, { data, version: i.version })
    return {
      guardado: true,
      version: saved.version,
      resumen: !i.data.contract
        ? 'contrato creado'
        : !contract
          ? 'contrato eliminado'
          : summarizeChanges(changes),
      cambios: changes.length
        ? changes.map((c) => `${c.breaking ? 'ROMPE' : 'compatible'} · ${formatChange(c)}`)
        : undefined,
    }
  }

  const contractSchema = z
    .object({
      request: z
        .object({
          path: z.array(z.any()).optional(),
          query: z.array(z.any()).optional(),
          headers: z.array(z.any()).optional(),
          body: z.any().optional(),
        })
        .optional()
        .describe(
          'Lo que envía el frontend. path/query/headers: [{ name, required?, schema?, description? }]; body: JSON Schema',
        ),
      responses: z
        .record(
          z.string(),
          z.object({
            description: z.string().optional(),
            headers: z.array(z.any()).optional(),
            body: z.any().optional(),
          }),
        )
        .describe('Una entrada por código («200», «404», «4XX», «default»); body es un JSON Schema'),
    })
    .passthrough()

  server.registerTool(
    'ver_contrato',
    {
      title: 'Ver contrato',
      description:
        'Contrato de una petición: lo que debe enviar el frontend (parámetros de ruta, query, cabeceras, cuerpo) y lo que debe devolver el backend en cada código de estado. Los esquemas son JSON Schema 2020-12.',
      inputSchema: { requestId: z.string() },
      annotations: ro,
    },
    wrap(async ({ requestId }: { requestId: string }) => {
      const i = await api('GET', `/api/items/${requestId}`)
      if (!hasContract(i.data.contract))
        return `«${i.name}» no tiene contrato. Puedes crearlo con generar_contrato (desde una respuesta real) o con guardar_contrato.`
      return {
        peticion: i.name,
        method: i.data.request?.method,
        url: rawUrl(i.data.request?.url),
        contrato: i.data.contract,
      }
    }),
  )

  server.registerTool(
    'guardar_contrato',
    {
      title: 'Guardar contrato',
      description:
        'Crea o sustituye el contrato completo de una petición (pasa contrato: null para quitarlo). ' +
        'Si el cambio rompe a quien ya lo usa (quitar un campo de la respuesta, cambiar un tipo, pedir un campo nuevo obligatorio…), no se guarda y devuelve la lista; ' +
        'repite con aceptarCambiosQueRompen: true si el usuario lo confirma. Queda en el historial.',
      inputSchema: {
        requestId: z.string(),
        contrato: contractSchema.nullable(),
        aceptarCambiosQueRompen: z.boolean().optional(),
      },
    },
    wrap(async (a: { requestId: string; contrato: Contract | null; aceptarCambiosQueRompen?: boolean }) => {
      const i = await api('GET', `/api/items/${a.requestId}`)
      return saveContract(i, a.contrato, a.aceptarCambiosQueRompen)
    }),
  )

  server.registerTool(
    'generar_contrato',
    {
      title: 'Generar contrato desde una respuesta real',
      description:
        'Envía la petición guardada y deduce el contrato de lo que llega: tipos, formatos (email, uuid, fecha…) y ejemplos. ' +
        'Añade o sustituye el código de estado recibido y, si la petición aún no tiene contrato, también la parte de petición. ' +
        'Todos los campos quedan obligatorios: revisa cuáles pueden faltar. Por defecto solo lo propone; con guardar: true lo guarda.',
      inputSchema: {
        requestId: z.string(),
        environmentId: z.string().optional(),
        guardar: z.boolean().optional(),
        aceptarCambiosQueRompen: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    wrap(
      async (a: {
        requestId: string
        environmentId?: string
        guardar?: boolean
        aceptarCambiosQueRompen?: boolean
      }) => {
        const { i, r } = await executeSaved(a.requestId, a.environmentId)
        const res = r.execution?.response
        if (!res)
          throw new Error(
            `La petición no ha obtenido respuesta: ${r.execution?.error ?? 'error desconocido'}`,
          )
        const code = String(res.code)
        const prev: Contract = i.data.contract ?? { responses: {} }
        const body = inferFromText(res.body)
        const contract: Contract = {
          ...prev,
          request: prev.request ?? requestContractFrom(i.data.request),
          responses: {
            ...prev.responses,
            [code]: {
              ...prev.responses[code],
              description: prev.responses[code]?.description || res.status,
              body: body ?? prev.responses[code]?.body,
            },
          },
        }
        const changes = hasContract(i.data.contract) ? diffContracts(i.data.contract, contract) : []
        const out: Json = {
          codigo: code,
          cuerpoJson: !!body,
          contrato: contract,
          cambios: changes.length
            ? changes.map((c) => `${c.breaking ? 'ROMPE' : 'compatible'} · ${formatChange(c)}`)
            : undefined,
          nuevo: !hasContract(i.data.contract) || undefined,
        }
        if (!a.guardar)
          return {
            ...out,
            guardado: false,
            nota: 'No se ha guardado. Llama otra vez con guardar: true, o ajústalo y usa guardar_contrato.',
          }
        return { ...out, ...(await saveContract(i, contract, a.aceptarCambiosQueRompen)) }
      },
    ),
  )

  server.registerTool(
    'validar_contrato',
    {
      title: 'Validar contrato',
      description:
        'Envía la petición guardada y comprueba las dos partes del contrato: si lo que se envía cumple la parte del frontend y si lo que llega cumple la del backend. ' +
        'Devuelve cada fallo con su ruta ($.user.email) y el motivo. Los campos que no están en el contrato salen como aviso.',
      inputSchema: { requestId: z.string(), environmentId: z.string().optional() },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    wrap(async (a: { requestId: string; environmentId?: string }) => {
      const { i, r } = await executeSaved(a.requestId, a.environmentId)
      if (!hasContract(i.data.contract)) throw new Error(`«${i.name}» no tiene contrato`)
      const ex = r.execution
      if (!ex?.response)
        throw new Error(`La petición no ha obtenido respuesta: ${ex?.error ?? 'error desconocido'}`)
      const check = checkExchange(i.data.contract, rawUrl(i.data.request?.url), ex.request, ex.response)
      const list = (xs: Json[]) =>
        xs.length ? xs.map((x) => `${x.level === 'error' ? '✗' : '!'} ${formatIssue(x)}`) : undefined
      return {
        status: `${ex.response.code} ${ex.response.status}`,
        cumple: check.errors === 0,
        fallos: check.errors,
        avisos: check.warnings,
        peticion: list(check.request),
        respuesta: list(check.response),
      }
    }),
  )

  server.registerTool(
    'historial_contrato',
    {
      title: 'Historial del contrato',
      description:
        'Versiones guardadas del contrato de una petición (quién, cuándo) y qué cambió en cada una, marcando lo que rompe.',
      inputSchema: { requestId: z.string(), limite: z.number().int().min(1).max(30).optional() },
      annotations: ro,
    },
    wrap(async ({ requestId, limite }: { requestId: string; limite?: number }) => {
      const i = await api('GET', `/api/items/${requestId}`)
      const revs = await api<Json[]>(
        'GET',
        `/api/collections/${i.collectionId}/revisions?itemId=${requestId}&action=contract`,
      )
      if (!revs.length) return 'El contrato no tiene versiones guardadas'
      const out: Json[] = []
      for (const rev of revs.slice(0, limite ?? 10)) {
        const full = await api('GET', `/api/revisions/${rev.id}`)
        const changes = diffContracts(full.before?.contract, full.after?.contract)
        out.push({
          fecha: rev.createdAt,
          autor: rev.user,
          resumen: rev.summary,
          cambios:
            full.before?.contract && full.after?.contract
              ? changes.map((c) => `${c.breaking ? 'ROMPE' : 'compatible'} · ${formatChange(c)}`)
              : undefined,
        })
      }
      return out
    }),
  )

  server.registerTool(
    'exportar_openapi',
    {
      title: 'Exportar OpenAPI 3.1',
      description:
        'Exporta una colección como especificación OpenAPI 3.1 con los contratos de sus peticiones (las que no tienen contrato se describen desde su cuerpo y ejemplos).',
      inputSchema: { collectionId: z.string(), formato: z.enum(['yaml', 'json']).optional() },
      annotations: ro,
    },
    wrap(async ({ collectionId, formato }: { collectionId: string; formato?: 'yaml' | 'json' }) =>
      apiText(`/api/collections/${collectionId}/openapi?format=${formato ?? 'yaml'}`),
    ),
  )

  server.registerPrompt(
    'probar_api',
    {
      title: 'Probar una API',
      description: 'Revisa una colección: la ejecuta, analiza los fallos y propone tests que faltan.',
      argsSchema: { coleccion: z.string().describe('Nombre o id de la colección') },
    },
    ({ coleccion }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Usa las herramientas de Cartero para revisar la colección «${coleccion}»: localízala, ejecútala con ejecutar_coleccion, explica los fallos con detalle (mirando las peticiones con ver_peticion y, si hace falta, enviándolas) y propón tests nuevos para las peticiones que no tengan. No modifiques nada sin preguntarme.`,
          },
        },
      ],
    }),
  )

  return server
}
