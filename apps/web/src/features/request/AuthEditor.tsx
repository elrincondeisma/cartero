import { type Auth, type AuthAttribute, type AuthType, resolveVariables } from '@cartero/core'
import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Button, Field, Select } from '@/components/ui'
import { VarInput } from '@/components/VarInput'
import { useWs } from '../workspace/context'

const TYPES: { id: AuthType; label: string }[] = [
  { id: 'inherit', label: 'Heredar del padre' },
  { id: 'noauth', label: 'Sin autenticación' },
  { id: 'basic', label: 'Basic Auth' },
  { id: 'bearer', label: 'Bearer Token' },
  { id: 'apikey', label: 'API Key' },
  { id: 'jwt', label: 'JWT Bearer' },
  { id: 'digest', label: 'Digest Auth' },
  { id: 'oauth1', label: 'OAuth 1.0' },
  { id: 'oauth2', label: 'OAuth 2.0' },
  { id: 'hawk', label: 'Hawk' },
  { id: 'awsv4', label: 'AWS Signature' },
  { id: 'ntlm', label: 'NTLM' },
  { id: 'edgegrid', label: 'Akamai EdgeGrid' },
]

type FieldDef = { key: string; label: string; secret?: boolean; placeholder?: string; options?: { value: string; label: string }[]; hint?: string }

const FIELDS: Partial<Record<AuthType, FieldDef[]>> = {
  basic: [
    { key: 'username', label: 'Usuario' },
    { key: 'password', label: 'Contraseña', secret: true },
  ],
  bearer: [{ key: 'token', label: 'Token', secret: true }],
  apikey: [
    { key: 'key', label: 'Clave', placeholder: 'X-API-Key' },
    { key: 'value', label: 'Valor', secret: true },
    { key: 'in', label: 'Añadir a', options: [{ value: 'header', label: 'Cabecera' }, { value: 'query', label: 'Query params' }] },
  ],
  jwt: [
    { key: 'algorithm', label: 'Algoritmo', options: ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'PS256'].map((v) => ({ value: v, label: v })) },
    { key: 'secret', label: 'Secreto / clave privada', secret: true },
    { key: 'payload', label: 'Payload (JSON)', placeholder: '{"sub":"123"}' },
    { key: 'headerPrefix', label: 'Prefijo de cabecera', placeholder: 'Bearer' },
    { key: 'addTokenTo', label: 'Añadir a', options: [{ value: 'header', label: 'Cabecera' }, { value: 'queryParam', label: 'Query param' }] },
  ],
  digest: [
    { key: 'username', label: 'Usuario' },
    { key: 'password', label: 'Contraseña', secret: true },
    { key: 'realm', label: 'Realm' },
    { key: 'nonce', label: 'Nonce' },
    { key: 'algorithm', label: 'Algoritmo', options: ['MD5', 'MD5-sess', 'SHA-256', 'SHA-256-sess', 'SHA-512-256', 'SHA-512-256-sess'].map((v) => ({ value: v, label: v })) },
    { key: 'qop', label: 'qop' },
    { key: 'opaque', label: 'Opaque' },
  ],
  oauth1: [
    { key: 'signatureMethod', label: 'Método de firma', options: ['HMAC-SHA1', 'HMAC-SHA256', 'HMAC-SHA512', 'RSA-SHA1', 'RSA-SHA256', 'RSA-SHA512', 'PLAINTEXT'].map((v) => ({ value: v, label: v })) },
    { key: 'consumerKey', label: 'Consumer key' },
    { key: 'consumerSecret', label: 'Consumer secret', secret: true },
    { key: 'token', label: 'Access token' },
    { key: 'tokenSecret', label: 'Token secret', secret: true },
    { key: 'callback', label: 'Callback URL' },
    { key: 'verifier', label: 'Verifier' },
    { key: 'realm', label: 'Realm' },
    { key: 'addParamsToHeader', label: 'Añadir a', options: [{ value: 'true', label: 'Cabecera' }, { value: 'false', label: 'Body / URL' }] },
  ],
  hawk: [
    { key: 'authId', label: 'Hawk Auth ID' },
    { key: 'authKey', label: 'Hawk Auth Key', secret: true },
    { key: 'algorithm', label: 'Algoritmo', options: [{ value: 'sha256', label: 'SHA256' }, { value: 'sha1', label: 'SHA1' }] },
    { key: 'user', label: 'Usuario' },
    { key: 'ext', label: 'ext' },
    { key: 'app', label: 'app' },
  ],
  awsv4: [
    { key: 'accessKey', label: 'Access key' },
    { key: 'secretKey', label: 'Secret key', secret: true },
    { key: 'region', label: 'Región', placeholder: 'eu-west-1' },
    { key: 'service', label: 'Servicio', placeholder: 's3, execute-api…' },
    { key: 'sessionToken', label: 'Session token', secret: true },
    { key: 'addAuthDataToQuery', label: 'Añadir a', options: [{ value: 'false', label: 'Cabeceras' }, { value: 'true', label: 'Query params' }] },
  ],
  ntlm: [
    { key: 'username', label: 'Usuario' },
    { key: 'password', label: 'Contraseña', secret: true },
    { key: 'domain', label: 'Dominio' },
    { key: 'workstation', label: 'Workstation' },
  ],
  edgegrid: [
    { key: 'accessToken', label: 'Access token' },
    { key: 'clientToken', label: 'Client token' },
    { key: 'clientSecret', label: 'Client secret', secret: true },
    { key: 'baseURL', label: 'Base URL' },
    { key: 'nonce', label: 'Nonce' },
    { key: 'timestamp', label: 'Timestamp' },
    { key: 'headersToSign', label: 'Cabeceras a firmar' },
  ],
}

const OAUTH2_FIELDS: FieldDef[] = [
  { key: 'accessToken', label: 'Access token', secret: true, hint: 'Este es el token que se envía. Puedes pegarlo o pedir uno nuevo abajo.' },
  { key: 'headerPrefix', label: 'Prefijo', placeholder: 'Bearer' },
  { key: 'addTokenTo', label: 'Añadir a', options: [{ value: 'header', label: 'Cabecera' }, { value: 'queryParams', label: 'Query params' }] },
]

const GRANTS = [
  { value: 'authorization_code', label: 'Authorization Code' },
  { value: 'authorization_code_with_pkce', label: 'Authorization Code (con PKCE)' },
  { value: 'client_credentials', label: 'Client Credentials' },
  { value: 'password_credentials', label: 'Password Credentials' },
  { value: 'implicit', label: 'Implicit' },
]

export function getAttr(auth: Auth | null | undefined, key: string): string {
  if (!auth) return ''
  const list = auth[auth.type] as AuthAttribute[] | undefined
  const v = Array.isArray(list) ? list.find((a) => a.key === key)?.value : undefined
  return v === undefined || v === null ? '' : typeof v === 'string' ? v : String(v)
}

function setAttr(auth: Auth, key: string, value: string): Auth {
  const list = [...((auth[auth.type] as AuthAttribute[] | undefined) ?? [])]
  const i = list.findIndex((a) => a.key === key)
  if (i === -1) list.push({ key, value, type: 'string' })
  else list[i] = { ...list[i], value }
  return { ...auth, [auth.type]: list }
}

export function AuthEditor({
  auth,
  onChange,
  known,
  allowInherit = true,
  readOnly,
}: {
  auth: Auth | null | undefined
  onChange: (a: Auth | null) => void
  known: Record<string, string>
  allowInherit?: boolean
  readOnly?: boolean
}) {
  // En Postman, auth ausente en una petición = heredar
  const type: AuthType = auth?.type ?? (allowInherit ? 'inherit' : 'noauth')
  const fields = type === 'oauth2' ? OAUTH2_FIELDS : (FIELDS[type] ?? [])

  const changeType = (t: AuthType) => {
    if (t === 'inherit') return onChange(null)
    if (t === 'noauth') return onChange({ type: 'noauth' })
    const base: Auth = { type: t, [t]: [] }
    onChange(t === 'apikey' ? setAttr(base, 'in', 'header') : t === 'oauth2' ? setAttr(setAttr(base, 'addTokenTo', 'header'), 'headerPrefix', 'Bearer') : base)
  }

  return (
    <div className="flex gap-8 p-4">
      <div className="w-64 shrink-0 space-y-2">
        <Field label="Tipo">
          <Select value={type} onChange={(e) => changeType(e.target.value as AuthType)} className="w-full" disabled={readOnly}>
            {TYPES.filter((t) => allowInherit || t.id !== 'inherit').map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs leading-relaxed text-muted">
          {type === 'inherit' && 'Se usa la autenticación de la carpeta o colección que la contiene.'}
          {type === 'noauth' && 'La petición se envía sin autenticación.'}
          {type !== 'inherit' && type !== 'noauth' && 'Los valores admiten {{variables}}. Guarda los secretos en variables de tipo secreto del entorno.'}
        </p>
      </div>
      <div className="max-w-xl min-w-0 flex-1 space-y-3">
        {auth &&
          fields.map((f) => (
            <AuthField key={f.key} def={f} value={getAttr(auth, f.key)} onChange={(v) => onChange(setAttr(auth, f.key, v))} known={known} readOnly={readOnly} />
          ))}
        {auth && type === 'oauth2' && <OAuth2Token auth={auth} onChange={onChange} known={known} readOnly={readOnly} />}
      </div>
    </div>
  )
}

function AuthField({ def, value, onChange, known, readOnly }: { def: FieldDef; value: string; onChange: (v: string) => void; known: Record<string, string>; readOnly?: boolean }) {
  const [show, setShow] = useState(false)
  return (
    <Field label={def.label} hint={def.hint}>
      {def.options ? (
        <Select value={value || def.options[0].value} onChange={(e) => onChange(e.target.value)} className="w-full" disabled={readOnly}>
          {def.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : (
        <div className="flex h-8 items-center rounded-md border border-app bg-app focus-within:border-brand-500">
          {def.secret && !show && !/^\{\{.*\}\}$/.test(value) && value ? (
            <input type="password" value={value} onChange={(e) => onChange(e.target.value)} readOnly={readOnly} className="h-full flex-1 bg-transparent px-2.5 font-mono text-[12.5px] outline-none" />
          ) : (
            <VarInput value={value} onChange={onChange} known={known} placeholder={def.placeholder} className="h-full" />
          )}
          {def.secret && (
            <button type="button" onClick={() => setShow(!show)} className="px-2 text-[11px] text-muted hover:text-app">
              {show ? 'Ocultar' : 'Ver'}
            </button>
          )}
        </div>
      )}
    </Field>
  )
}

function base64url(buf: ArrayBuffer | Uint8Array) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function OAuth2Token({ auth, onChange, known, readOnly }: { auth: Auth; onChange: (a: Auth) => void; known: Record<string, string>; readOnly?: boolean }) {
  const { ws } = useWs()
  const [loading, setLoading] = useState(false)
  const g = (k: string) => resolveVariables(getAttr(auth, k), [known])
  const grant = getAttr(auth, 'grant_type') || 'authorization_code'
  const needsBrowser = grant === 'authorization_code' || grant === 'authorization_code_with_pkce' || grant === 'implicit'
  const callback = `${location.origin}/oauth/callback`

  const fields: FieldDef[] = [
    { key: 'grant_type', label: 'Tipo de concesión (grant)', options: GRANTS },
    ...(needsBrowser ? [{ key: 'redirect_uri', label: 'Callback URL', placeholder: callback, hint: `Regístrala en tu proveedor. Por defecto: ${callback}` }] : []),
    ...(needsBrowser ? [{ key: 'authUrl', label: 'Auth URL' }] : []),
    ...(grant !== 'implicit' ? [{ key: 'accessTokenUrl', label: 'Access Token URL' }] : []),
    { key: 'clientId', label: 'Client ID' },
    ...(grant !== 'implicit' ? [{ key: 'clientSecret', label: 'Client Secret', secret: true }] : []),
    ...(grant === 'password_credentials' ? [{ key: 'username', label: 'Usuario' }, { key: 'password', label: 'Contraseña', secret: true }] : []),
    { key: 'scope', label: 'Scope', placeholder: 'read write' },
    { key: 'state', label: 'State' },
    ...(grant !== 'implicit'
      ? [{ key: 'client_authentication', label: 'Autenticación del cliente', options: [{ value: 'header', label: 'Basic Auth en cabecera' }, { value: 'body', label: 'Credenciales en el body' }] }]
      : []),
  ]

  const exchange = async (extra: Record<string, string>) => {
    const data = await api.post<any>(`/api/workspaces/${ws}/oauth2/token`, {
      grant_type: grant === 'authorization_code_with_pkce' ? 'authorization_code' : grant,
      accessTokenUrl: g('accessTokenUrl'),
      clientId: g('clientId') || undefined,
      clientSecret: g('clientSecret') || undefined,
      scope: g('scope') || undefined,
      username: g('username') || undefined,
      password: g('password') || undefined,
      client_authentication: getAttr(auth, 'client_authentication') || 'header',
      ...extra,
    })
    let next = setAttr(auth, 'accessToken', data.access_token)
    if (data.refresh_token) next = setAttr(next, 'refreshToken', data.refresh_token)
    if (data.token_type && data.token_type.toLowerCase() === 'bearer') next = setAttr(next, 'headerPrefix', 'Bearer')
    onChange(next)
    toast.success(`Token obtenido${data.expires_in ? ` (caduca en ${data.expires_in}s)` : ''}`)
  }

  const getToken = async () => {
    setLoading(true)
    try {
      if (!needsBrowser) {
        await exchange({})
        return
      }
      const redirect = g('redirect_uri') || callback
      const state = g('state') || crypto.randomUUID()
      const params = new URLSearchParams({
        response_type: grant === 'implicit' ? 'token' : 'code',
        client_id: g('clientId'),
        redirect_uri: redirect,
        state,
      })
      if (g('scope')) params.set('scope', g('scope'))
      let verifier: string | undefined
      if (grant === 'authorization_code_with_pkce') {
        verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
        const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
        params.set('code_challenge', challenge)
        params.set('code_challenge_method', 'S256')
      }
      const authUrl = g('authUrl')
      const popup = window.open(`${authUrl}${authUrl.includes('?') ? '&' : '?'}${params}`, 'cartero-oauth', 'width=520,height=720')
      if (!popup) throw new Error('El navegador ha bloqueado la ventana emergente')
      const result = await new Promise<Record<string, string>>((resolve, reject) => {
        const onMsg = (ev: MessageEvent) => {
          if (ev.origin !== location.origin || ev.data?.type !== 'cartero-oauth') return
          window.removeEventListener('message', onMsg)
          clearInterval(timer)
          resolve(ev.data.params)
        }
        window.addEventListener('message', onMsg)
        const timer = setInterval(() => {
          if (popup.closed) {
            clearInterval(timer)
            window.removeEventListener('message', onMsg)
            reject(new Error('Se cerró la ventana sin completar el login'))
          }
        }, 500)
      })
      if (result.error) throw new Error(result.error_description ?? result.error)
      if (result.state && result.state !== state) throw new Error('El parámetro state no coincide')
      if (grant === 'implicit') {
        onChange(setAttr(auth, 'accessToken', result.access_token))
        toast.success('Token obtenido')
      } else {
        await exchange({ code: result.code, redirect_uri: redirect, ...(verifier ? { code_verifier: verifier } : {}) })
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const refresh = async () => {
    setLoading(true)
    try {
      await exchange({ grant_type: 'refresh_token', refresh_token: getAttr(auth, 'refreshToken') } as any)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-5 space-y-3 rounded-lg border border-app p-4">
      <div className="flex items-center gap-2 font-medium">
        <KeyRound className="size-4 text-muted" />
        Obtener un token nuevo
      </div>
      {fields.map((f) => (
        <AuthField key={f.key} def={f} value={getAttr(auth, f.key)} onChange={(v) => onChange(setAttr(auth, f.key, v))} known={known} readOnly={readOnly} />
      ))}
      <div className="flex gap-2 pt-1">
        <Button variant="primary" onClick={getToken} loading={loading} disabled={readOnly}>
          Pedir token
        </Button>
        {getAttr(auth, 'refreshToken') && (
          <Button variant="outline" onClick={refresh} disabled={loading || readOnly}>
            Refrescar token
          </Button>
        )}
      </div>
    </div>
  )
}
