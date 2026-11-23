/**
 * Cliente mínimo de la API de Postman (https://api.getpostman.com) para importar workspaces,
 * colecciones, entornos y globales con la API key del usuario. La key nunca se guarda: llega en
 * cada petición y solo se usa para hablar con Postman.
 */
import { badRequest } from './errors.js'
import { stripNul } from './tree.js'

const BASE = () => (process.env.POSTMAN_API_URL ?? 'https://api.getpostman.com').replace(/\/$/, '')

export interface PostmanUser {
  id: number
  username: string
  fullName: string
  email?: string
  avatar?: string | null
  teamName?: string | null
}

export interface PostmanUsage {
  limit: number
  usage: number
}

export interface PostmanWorkspaceSummary {
  id: string
  name: string
  type: 'personal' | 'team' | string
  visibility?: string
}

interface Ref {
  id: string
  uid: string
  name: string
}

export interface PostmanWorkspace extends PostmanWorkspaceSummary {
  description?: string
  collections: Ref[]
  environments: Ref[]
  mocks: Ref[]
  monitors: Ref[]
  apis: Ref[]
}

/** Error de Postman con un mensaje que se puede enseñar tal cual. */
export class PostmanError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class PostmanClient {
  /** Llamadas hechas con este cliente (cada una gasta cupo mensual de Postman). */
  calls = 0

  constructor(private apiKey: string) {
    if (!/^\S{10,200}$/.test(apiKey)) throw badRequest('La API key de Postman no es válida')
  }

  async get<T>(path: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        this.calls++
        res = await fetch(`${BASE()}${path}`, {
          headers: { 'x-api-key': this.apiKey, accept: 'application/json' },
          signal: AbortSignal.timeout(60_000),
        })
      } catch (e) {
        if (attempt < 2) {
          await sleep(1000 * (attempt + 1))
          continue
        }
        throw new PostmanError(`No se puede conectar con Postman: ${(e as Error).message}`, 502)
      }
      // Límite por minuto: Postman dice cuánto esperar
      if (res.status === 429 && attempt < 3) {
        const wait = Number(res.headers.get('retry-after') ?? res.headers.get('x-ratelimit-retryafter') ?? 10)
        await sleep(Math.min(Math.max(wait, 1), 60) * 1000)
        continue
      }
      if (res.status >= 500 && attempt < 2) {
        await sleep(1500 * (attempt + 1))
        continue
      }
      const body: any = await res.json().catch(() => ({}))
      if (res.ok) return stripNul(body) as T
      throw new PostmanError(describe(res.status, body), res.status)
    }
  }

  async me(): Promise<{ user: PostmanUser; usage: PostmanUsage | null }> {
    const r = await this.get<any>('/me')
    const op = (r.operations ?? []).find((o: any) => o.name === 'api_usage')
    return { user: r.user, usage: op ? { limit: op.limit, usage: op.usage } : null }
  }

  async workspaces(): Promise<PostmanWorkspaceSummary[]> {
    const r = await this.get<{ workspaces?: PostmanWorkspaceSummary[] }>('/workspaces')
    return (r.workspaces ?? []).map(({ id, name, type, visibility }) => ({ id, name, type, visibility }))
  }

  async workspace(id: string): Promise<PostmanWorkspace> {
    const { workspace: w } = await this.get<{ workspace: any }>(`/workspaces/${encodeURIComponent(id)}`)
    const refs = (list: any[] | undefined): Ref[] =>
      (list ?? []).map((x) => ({ id: x.id, uid: x.uid ?? x.id, name: x.name ?? '' }))
    return {
      id: w.id,
      name: w.name,
      type: w.type,
      visibility: w.visibility,
      description: w.description,
      collections: refs(w.collections),
      environments: refs(w.environments),
      mocks: refs(w.mocks),
      monitors: refs(w.monitors),
      apis: refs(w.apis),
    }
  }

  async collection(uid: string): Promise<any> {
    const r = await this.get<{ collection: any }>(`/collections/${encodeURIComponent(uid)}`)
    return r.collection
  }

  async environment(uid: string): Promise<{ name: string; values: any[] }> {
    const r = await this.get<{ environment: any }>(`/environments/${encodeURIComponent(uid)}`)
    return r.environment
  }

  async globals(workspaceId: string): Promise<any[]> {
    const r = await this.get<{ values?: any[] }>(
      `/workspaces/${encodeURIComponent(workspaceId)}/global-variables`,
    )
    return r.values ?? []
  }
}

function describe(status: number, body: any): string {
  const msg: string = body?.error?.message ?? body?.message ?? ''
  if (status === 401)
    return 'Postman no acepta esta API key. Comprueba que la has copiado entera y que no ha caducado.'
  if (status === 403) return `Postman no da permiso para esto${msg ? `: ${msg}` : ''}`
  if (status === 404)
    return 'Postman no encuentra ese elemento (puede que lo hayan borrado o que la key no tenga acceso).'
  if (status === 429)
    return 'Se ha agotado el cupo de la API de Postman. Espera un poco (o al mes que viene, si es el cupo mensual).'
  return `Postman respondió ${status}${msg ? `: ${msg}` : ''}`
}
