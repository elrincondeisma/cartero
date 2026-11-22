import {
  type Auth,
  type Body,
  type Collection,
  type Environment,
  type Event,
  type FolderItem,
  type Item,
  type KeyValue,
  POSTMAN_SCHEMA_V21,
  type RequestItem,
  type Variable,
  ensureIds,
  parseUrl,
} from '@cartero/core'

export function isInsomniaV4(json: any): boolean {
  return !!json && json._type === 'export' && Array.isArray(json.resources)
}

export function isInsomniaV5(json: any): boolean {
  return !!json && typeof json.type === 'string' && json.type.startsWith('collection.insomnia.rest/')
}

/** Insomnia usa Nunjucks: {{ _.foo }} → {{foo}} */
function vars(s: unknown): string {
  if (s == null) return ''
  return String(s)
    .replace(/\{\{\s*_\.([\w.-]+)\s*\}\}/g, '{{$1}}')
    .replace(/\{\{\s*([\w.-]+)\s*\}\}/g, '{{$1}}')
}

function kv(list: any[] | undefined): KeyValue[] {
  return (list ?? [])
    .filter((p) => p && (p.name ?? '') !== '')
    .map((p) => {
      const out: KeyValue = { key: vars(p.name), value: vars(p.value) }
      if (p.disabled) out.disabled = true
      if (p.description) out.description = p.description
      return out
    })
}

function body(b: any): Body | undefined {
  if (!b || (!b.mimeType && !b.text && !b.params)) return undefined
  const mime: string = b.mimeType ?? ''
  if (mime === 'application/x-www-form-urlencoded') return { mode: 'urlencoded', urlencoded: kv(b.params) }
  if (mime === 'multipart/form-data') {
    return {
      mode: 'formdata',
      formdata: (b.params ?? []).map((p: any) =>
        p.type === 'file'
          ? { key: vars(p.name), type: 'file', src: p.fileName ?? null, disabled: p.disabled || undefined }
          : { key: vars(p.name), value: vars(p.value), type: 'text', disabled: p.disabled || undefined },
      ),
    }
  }
  if (mime === 'application/graphql') {
    try {
      const g = JSON.parse(b.text ?? '{}')
      return { mode: 'graphql', graphql: { query: vars(g.query), variables: g.variables ? JSON.stringify(g.variables, null, 2) : '' } }
    } catch {
      return { mode: 'raw', raw: vars(b.text) }
    }
  }
  if (mime === 'application/octet-stream') return { mode: 'file', file: { src: b.fileName ?? null } }
  const language = mime.includes('json') ? 'json' : mime.includes('xml') ? 'xml' : mime.includes('html') ? 'html' : 'text'
  return { mode: 'raw', raw: vars(b.text), options: { raw: { language } } }
}

function str(key: string, value: unknown) {
  return { key, value: vars(value), type: 'string' }
}

function auth(a: any): Auth | undefined {
  if (!a || !a.type || a.disabled) return undefined
  switch (a.type) {
    case 'basic':
      return { type: 'basic', basic: [str('username', a.username), str('password', a.password)] }
    case 'bearer':
      return { type: 'bearer', bearer: [str('token', a.token)] }
    case 'apikey':
      return {
        type: 'apikey',
        apikey: [str('key', a.key), str('value', a.value), str('in', a.addTo === 'queryParams' ? 'query' : 'header')],
      }
    case 'digest':
      return { type: 'digest', digest: [str('username', a.username), str('password', a.password)] }
    case 'ntlm':
      return { type: 'ntlm', ntlm: [str('username', a.username), str('password', a.password)] }
    case 'hawk':
      return { type: 'hawk', hawk: [str('authId', a.id), str('authKey', a.key), str('algorithm', a.algorithm)] }
    case 'iam':
      return {
        type: 'awsv4',
        awsv4: [str('accessKey', a.accessKeyId), str('secretKey', a.secretAccessKey), str('region', a.region), str('service', a.service), str('sessionToken', a.sessionToken)],
      }
    case 'oauth2': {
      const grant: Record<string, string> = {
        authorization_code: 'authorization_code',
        client_credentials: 'client_credentials',
        password: 'password_credentials',
        implicit: 'implicit',
      }
      return {
        type: 'oauth2',
        oauth2: [
          str('grant_type', grant[a.grantType] ?? a.grantType),
          str('accessTokenUrl', a.accessTokenUrl),
          str('authUrl', a.authorizationUrl),
          str('clientId', a.clientId),
          str('clientSecret', a.clientSecret),
          str('scope', a.scope),
          str('redirect_uri', a.redirectUrl),
          str('username', a.username),
          str('password', a.password),
          { key: 'addTokenTo', value: 'header', type: 'string' },
        ],
      }
    }
    default:
      return undefined
  }
}

function scripts(pre?: string, post?: string): Event[] | undefined {
  const ev: Event[] = []
  if (pre?.trim()) ev.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: pre.split('\n') } })
  if (post?.trim()) ev.push({ listen: 'test', script: { type: 'text/javascript', exec: post.split('\n') } })
  return ev.length ? ev : undefined
}

function requestItem(r: any): RequestItem {
  const url = parseUrl(vars(r.url))
  const params = kv(r.parameters)
  if (params.length) url.query = [...(url.query ?? []), ...params.map((p) => ({ key: p.key, value: p.value, disabled: p.disabled }))]
  if (r.pathParameters?.length) url.variable = kv(r.pathParameters)
  const item: RequestItem = {
    name: r.name || r.url || 'Petición',
    request: { method: (r.method ?? 'GET').toUpperCase(), url, header: kv(r.headers) },
  }
  const b = body(r.body)
  if (b) item.request.body = b
  const a = auth(r.authentication)
  if (a) item.request.auth = a
  if (r.description) item.request.description = r.description
  const ev = scripts(r.preRequestScript ?? r.scripts?.preRequest, r.afterResponseScript ?? r.scripts?.afterResponse)
  if (ev) item.event = ev
  return item
}

function dataToVars(data: Record<string, unknown> | undefined, prefix = ''): Variable[] {
  const out: Variable[] = []
  for (const [k, v] of Object.entries(data ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...dataToVars(v as Record<string, unknown>, key))
    else out.push({ key, value: typeof v === 'string' ? vars(v) : JSON.stringify(v) })
  }
  return out
}

/** Importa una exportación de Insomnia v4 (JSON). Cada workspace pasa a ser una colección. */
export function importInsomniaV4(json: any): { collections: Collection[]; environments: Environment[] } {
  const resources: any[] = json.resources
  const byParent = new Map<string, any[]>()
  for (const r of resources) {
    const list = byParent.get(r.parentId) ?? []
    list.push(r)
    byParent.set(r.parentId, list)
  }
  const sortKey = (r: any) => r.metaSortKey ?? 0

  const build = (parentId: string): Item[] =>
    (byParent.get(parentId) ?? [])
      .filter((r) => r._type === 'request' || r._type === 'request_group')
      .sort((a, b) => sortKey(a) - sortKey(b))
      .map((r) => {
        if (r._type === 'request') return requestItem(r)
        const folder: FolderItem = { name: r.name, item: build(r._id) }
        if (r.description) folder.description = r.description
        const a = auth(r.authentication)
        if (a) folder.auth = a
        const ev = scripts(r.preRequestScript, r.afterResponseScript)
        if (ev) folder.event = ev
        if (r.environment && Object.keys(r.environment).length) folder.variable = dataToVars(r.environment)
        return folder
      })

  const collections: Collection[] = []
  const environments: Environment[] = []
  for (const ws of resources.filter((r) => r._type === 'workspace')) {
    const envs = (byParent.get(ws._id) ?? []).filter((r) => r._type === 'environment')
    const base = envs[0]
    const col: Collection = {
      info: { name: ws.name, description: ws.description || undefined, schema: POSTMAN_SCHEMA_V21 },
      item: build(ws._id),
    }
    if (base?.data) col.variable = dataToVars(base.data)
    collections.push(ensureIds(col))
    for (const base of envs) {
      for (const sub of byParent.get(base._id) ?? []) {
        if (sub._type === 'environment') environments.push({ name: sub.name, values: dataToVars(sub.data) })
      }
    }
  }
  return { collections, environments }
}

/** Importa el formato YAML de Insomnia v5 (Insomnia ≥ 10). */
export function importInsomniaV5(doc: any): { collections: Collection[]; environments: Environment[] } {
  const build = (nodes: any[]): Item[] =>
    (nodes ?? []).map((n) => {
      if (Array.isArray(n.children)) {
        const folder: FolderItem = { name: n.name, item: build(n.children) }
        if (n.description) folder.description = n.description
        const a = auth(n.authentication)
        if (a) folder.auth = a
        const ev = scripts(n.scripts?.preRequest, n.scripts?.afterResponse)
        if (ev) folder.event = ev
        return folder
      }
      return requestItem(n)
    })
  const col: Collection = {
    info: { name: doc.name ?? 'Insomnia', schema: POSTMAN_SCHEMA_V21 },
    item: build(doc.collection),
  }
  if (doc.environments?.data) col.variable = dataToVars(doc.environments.data)
  const environments: Environment[] = (doc.environments?.subEnvironments ?? []).map((e: any) => ({
    name: e.name,
    values: dataToVars(e.data),
  }))
  return { collections: [ensureIds(col)], environments }
}
