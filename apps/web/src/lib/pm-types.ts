/** Tipos de la API de scripts (compatible con Postman) para el autocompletado de Monaco. */
export const PM_TYPES = `
interface VariableScope {
  /** Obtiene el valor de una variable */
  get(key: string): any;
  /** Asigna una variable */
  set(key: string, value: any): void;
  /** Elimina una variable */
  unset(key: string): void;
  has(key: string): boolean;
  clear(): void;
  toObject(): Record<string, any>;
  /** Sustituye {{variables}} en un texto */
  replaceIn(template: string): string;
}
interface HeaderList {
  get(name: string): string | undefined;
  has(name: string): boolean;
  add(header: { key: string; value: string }): void;
  upsert(header: { key: string; value: string }): void;
  remove(name: string): void;
  toObject(): Record<string, string>;
  each(fn: (h: { key: string; value: string }) => void): void;
}
interface PmRequest {
  url: { toString(): string; getHost(): string; getPath(): string; query: any; addQueryParams(params: string | object[]): void };
  method: string;
  headers: HeaderList;
  body: any;
  auth: any;
  addHeader(header: { key: string; value: string } | string): void;
  removeHeader(name: string): void;
  upsertHeader(header: { key: string; value: string }): void;
}
interface Assertion {
  to: Assertion; be: Assertion; been: Assertion; is: Assertion; that: Assertion; which: Assertion; and: Assertion;
  has: Assertion; have: Assertion; with: Assertion; at: Assertion; of: Assertion; same: Assertion; not: Assertion;
  deep: Assertion; nested: Assertion; own: Assertion; ordered: Assertion; any: Assertion; all: Assertion;
  a(type: string): Assertion; an(type: string): Assertion;
  include(value: any): Assertion; includes(value: any): Assertion; contain(value: any): Assertion;
  ok: Assertion; true: Assertion; false: Assertion; null: Assertion; undefined: Assertion; exist: Assertion; empty: Assertion;
  equal(value: any): Assertion; equals(value: any): Assertion; eq(value: any): Assertion; eql(value: any): Assertion;
  above(n: number): Assertion; gt(n: number): Assertion; below(n: number): Assertion; lt(n: number): Assertion;
  least(n: number): Assertion; most(n: number): Assertion; within(a: number, b: number): Assertion;
  property(name: string, value?: any): Assertion; lengthOf(n: number): Assertion; length: Assertion;
  match(re: RegExp): Assertion; string(s: string): Assertion; keys(...keys: string[]): Assertion; members(arr: any[]): Assertion;
  oneOf(list: any[]): Assertion; instanceof(c: any): Assertion; closeTo(n: number, delta: number): Assertion;
  /** Aserciones de respuesta */
  status(code: number | string): Assertion;
  header(name: string, value?: string): Assertion;
  body(value?: any): Assertion;
  jsonBody(path?: string, value?: any): Assertion;
  jsonSchema(schema: object): Assertion;
  json: Assertion; html: Assertion; xml: Assertion;
  success: Assertion; error: Assertion; clientError: Assertion; serverError: Assertion;
  ok: Assertion; accepted: Assertion; badRequest: Assertion; unauthorized: Assertion; forbidden: Assertion; notFound: Assertion;
  responseTime: Assertion;
}
interface PmResponse {
  code: number;
  status: string;
  headers: HeaderList;
  cookies: { get(name: string): string | undefined; has(name: string): boolean; toObject(): Record<string, string> };
  responseTime: number;
  responseSize: number;
  /** Cuerpo como texto */
  text(): string;
  /** Cuerpo parseado como JSON */
  json(): any;
  to: Assertion;
}
interface Pm {
  /** Info de la ejecución */
  info: { eventName: 'prerequest' | 'test'; iteration: number; iterationCount: number; requestName: string; requestId: string };
  /** Variables con la prioridad efectiva (locales > datos > entorno > colección > globales) */
  variables: VariableScope;
  environment: VariableScope & { name: string };
  collectionVariables: VariableScope;
  globals: VariableScope;
  iterationData: VariableScope;
  request: PmRequest;
  /** Solo disponible en scripts post-respuesta */
  response: PmResponse;
  cookies: { get(name: string): string | undefined; has(name: string): boolean; jar(): any; toObject(): Record<string, string> };
  /** Define un test */
  test(name: string, fn: (done?: () => void) => void | Promise<void>): void;
  /** Aserción estilo Chai */
  expect(value: any, message?: string): Assertion;
  /** Envía una petición desde el script */
  sendRequest(req: string | object, callback?: (err: any, res: PmResponse) => void): Promise<PmResponse>;
  execution: {
    /** Salta a la petición indicada (por nombre o id). null para parar. */
    setNextRequest(nameOrId: string | null): void;
    /** No envía la petición actual (solo pre-request) */
    skipRequest(): void;
    location: string[] & { current: string };
  };
  visualizer: { set(template: string, data?: object): void; clear(): void };
  require(name: string): any;
}
declare const pm: Pm;
/** @deprecated usa pm.execution.setNextRequest */
declare const postman: { setNextRequest(name: string | null): void; setEnvironmentVariable(k: string, v: any): void; getEnvironmentVariable(k: string): any };
declare const responseBody: string;
declare const responseCode: { code: number; name: string };
declare const responseTime: number;
declare const tests: Record<string, boolean>;
declare function require(name: 'lodash' | 'moment' | 'crypto-js' | 'uuid' | 'ajv' | 'cheerio' | 'xml2js' | 'chai' | 'atob' | 'btoa' | 'tv4' | string): any;
declare const _: any;
declare const CryptoJS: any;
`
