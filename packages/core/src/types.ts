/**
 * Modelo interno de Cartero. Es un superconjunto del formato Postman Collection v2.1
 * para que importar/exportar sea sin pérdidas y para poder ejecutar con postman-runtime.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | string

export interface KeyValue {
  key: string
  value: string
  description?: string
  disabled?: boolean
  type?: string
}

export interface Variable extends KeyValue {
  /** 'default' | 'secret' | 'string' | 'boolean' | 'number' | 'any' */
  type?: string
}

export interface QueryParam {
  key: string | null
  value: string | null
  description?: string
  disabled?: boolean
}

export interface Url {
  raw: string
  protocol?: string
  host?: string[]
  port?: string
  path?: string[]
  query?: QueryParam[]
  hash?: string
  variable?: Variable[]
}

export interface FormParam {
  key: string
  value?: string
  src?: string | string[] | null
  type?: 'text' | 'file'
  contentType?: string
  description?: string
  disabled?: boolean
}

export interface Body {
  mode?: 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql' | 'none'
  raw?: string
  urlencoded?: KeyValue[]
  formdata?: FormParam[]
  file?: { src?: string | null; content?: string }
  graphql?: { query?: string; variables?: string }
  options?: { raw?: { language?: 'json' | 'xml' | 'text' | 'html' | 'javascript' | string } } & Record<
    string,
    any
  >
  disabled?: boolean
}

export interface AuthAttribute {
  key: string
  value?: any
  type?: string
}

export type AuthType =
  | 'noauth'
  | 'inherit'
  | 'basic'
  | 'bearer'
  | 'apikey'
  | 'digest'
  | 'oauth1'
  | 'oauth2'
  | 'hawk'
  | 'awsv4'
  | 'ntlm'
  | 'akamai'
  | 'edgegrid'
  | 'jwt'
  | 'asap'

export interface Auth {
  type: AuthType
  [scheme: string]: AuthAttribute[] | AuthType | undefined
}

export interface Script {
  id?: string
  type?: string
  exec?: string[] | string
  packages?: Record<string, unknown>
}

export interface Event {
  listen: 'prerequest' | 'test' | string
  script: Script
  disabled?: boolean
}

export interface Request {
  method: HttpMethod
  url: Url | string
  header?: KeyValue[]
  body?: Body
  auth?: Auth | null
  description?: string
  proxy?: unknown
  certificate?: unknown
}

export interface Cookie {
  domain: string
  path: string
  key?: string
  name?: string
  value?: string
  expires?: string | null
  httpOnly?: boolean
  secure?: boolean
  hostOnly?: boolean
  session?: boolean
  extensions?: unknown[]
}

export interface ResponseExample {
  id?: string
  name: string
  originalRequest?: Request
  status?: string
  code?: number
  header?: KeyValue[] | null
  cookie?: Cookie[]
  body?: string | null
  _postman_previewlanguage?: string | null
  responseTime?: number | null
}

export interface ProtocolProfileBehavior {
  [k: string]: unknown
}

/** Esquema JSON (draft 2020-12, el de OpenAPI 3.1). Se deja abierto a propósito. */
export type JSONSchema = { [k: string]: any }

/** Un parámetro del contrato: de ruta, de query o una cabecera. */
export interface ContractParam {
  name: string
  required?: boolean
  schema?: JSONSchema
  description?: string
}

export interface ContractResponse {
  description?: string
  body?: JSONSchema
  headers?: ContractParam[]
}

/**
 * Contrato entre frontend y backend de una petición: lo que envía el frontend y lo que debe
 * devolver el backend en cada código de estado. Es una extensión de Cartero (Postman la ignora).
 */
export interface Contract {
  request?: { body?: JSONSchema; query?: ContractParam[]; headers?: ContractParam[]; path?: ContractParam[] }
  /** Clave: código de estado («200», «404»…) o «default». */
  responses: Record<string, ContractResponse>
}

export interface RequestItem {
  id?: string
  name: string
  description?: string
  request: Request
  response?: ResponseExample[]
  contract?: Contract
  event?: Event[]
  variable?: Variable[]
  protocolProfileBehavior?: ProtocolProfileBehavior
}

export interface FolderItem {
  id?: string
  name: string
  description?: string
  item: Item[]
  auth?: Auth | null
  event?: Event[]
  variable?: Variable[]
  protocolProfileBehavior?: ProtocolProfileBehavior
}

export type Item = RequestItem | FolderItem

export interface CollectionInfo {
  _postman_id?: string
  name: string
  description?: string
  schema?: string
  version?: string
}

export interface Collection {
  info: CollectionInfo
  item: Item[]
  auth?: Auth | null
  event?: Event[]
  variable?: Variable[]
  protocolProfileBehavior?: ProtocolProfileBehavior
}

export interface Environment {
  id?: string
  name: string
  values: Variable[]
}

export interface ImportResult {
  collections: Collection[]
  environments: Environment[]
  globals?: Variable[]
  warnings: string[]
  format: string
}

export const POSTMAN_SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

export function isFolder(item: Item): item is FolderItem {
  return Array.isArray((item as FolderItem).item)
}
