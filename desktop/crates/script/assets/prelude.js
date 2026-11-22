// API pm.* de Cartero sobre QuickJS, compatible con los scripts de Postman.
// Recibe el contexto en __cartero_input (JSON). Rust llama después a __cartero_tick() mientras
// queden temporizadores y a __cartero_finish(), que deja el resultado en __cartero_output.
;(function () {
  'use strict'
  const input = JSON.parse(globalThis.__cartero_input)
  const host = globalThis.__cartero_host
  const out = { tests: [], console: [], variables: {}, local: {}, error: null, request: null, nextRequest: undefined, skipRequest: false, visualizer: null }
  const loaded = {}
  // crypto.getRandomValues para uuid y compañía (bytes aleatorios de Rust)
  if (!globalThis.crypto) {
    globalThis.crypto = {
      getRandomValues(arr) {
        const bytes = call('random', arr.byteLength)
        new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength).set(bytes)
        return arr
      },
    }
  }

  function call(op, arg) {
    const r = JSON.parse(host(op, JSON.stringify(arg === undefined ? null : arg)))
    if (r.error) throw new Error(r.error)
    return r.value
  }

  function require(name) {
    if (name === 'csv-parse/lib/sync' || name === 'csv-parse/sync') name = 'csv-parse/lib/sync'
    if (name in loaded) return loaded[name]
    call('load', name)
    loaded[name] = globalThis.__cartero_lib
    delete globalThis.__cartero_lib
    return loaded[name]
  }
  const chai = require('chai')

  // ── Texto de la consola, parecido al de Postman ──
  function show(v) {
    if (typeof v === 'string') return v
    if (v === undefined) return 'undefined'
    if (v instanceof Error) return `${v.name}: ${v.message}`
    if (typeof v === 'function') return `[Function ${v.name || 'anónima'}]`
    try {
      return JSON.stringify(v)
    } catch (_) {
      return String(v)
    }
  }
  const log = (level) => (...args) => out.console.push({ level, text: args.map(show).join(' ') })
  const console = { log: log('log'), info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug'), clear() {} }

  // ── Variables dinámicas para replaceIn ──
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  }
  const dynamic = {
    $guid: uuid,
    $randomUUID: uuid,
    $timestamp: () => String(Math.floor(Date.now() / 1000)),
    $isoTimestamp: () => new Date().toISOString(),
    $randomInt: () => String(Math.floor(Math.random() * 1001)),
    $randomBoolean: () => String(Math.random() < 0.5),
  }
  function replaceWith(text, get) {
    let s = String(text)
    for (let i = 0; i < 10; i++) {
      const next = s.replace(/\{\{([^{}]+?)\}\}/g, (m, n) => {
        const k = n.trim()
        const v = get(k)
        if (v !== undefined) return typeof v === 'string' ? v : JSON.stringify(v)
        return dynamic[k] ? dynamic[k]() : m
      })
      if (next === s) break
      s = next
    }
    return s
  }

  // ── Ámbitos de variables ──
  function scope(name, extra) {
    const values = Object.assign({}, input.variables[name] || {})
    out.variables[name] = values
    const api = {
      get: (k) => values[k],
      set: (k, v) => {
        values[k] = v
      },
      unset: (k) => {
        delete values[k]
      },
      has: (k) => Object.prototype.hasOwnProperty.call(values, k),
      clear: () => Object.keys(values).forEach((k) => delete values[k]),
      toObject: () => Object.assign({}, values),
      toJSON: () => Object.assign({}, values),
      replaceIn: (t) => replaceWith(t, (k) => api.get(k)),
    }
    return Object.assign(api, extra || {})
  }
  const environment = scope('environment', { name: input.environmentName || '' })
  const globals = scope('globals')
  const collectionVariables = scope('collection')
  const data = Object.assign({}, input.iterationData || {})
  const local = Object.assign({}, input.local || {})
  out.local = local
  // Orden de Postman: local > datos > entorno > colección > globales
  const variables = {
    get(k) {
      if (k in local) return local[k]
      if (k in data) return data[k]
      for (const s of [environment, collectionVariables, globals]) if (s.has(k)) return s.get(k)
      return undefined
    },
    set: (k, v) => {
      local[k] = v
    },
    unset: (k) => {
      delete local[k]
    },
    has: (k) => variables.get(k) !== undefined,
    toObject: () => Object.assign({}, globals.toObject(), collectionVariables.toObject(), environment.toObject(), data, local),
    replaceIn: (t) => replaceWith(t, (k) => variables.get(k)),
  }
  const iterationData = {
    get: (k) => data[k],
    has: (k) => k in data,
    toObject: () => Object.assign({}, data),
    toJSON: () => Object.assign({}, data),
    unset: (k) => {
      delete data[k]
    },
  }

  // ── Listas tipo PropertyList (cabeceras, query, cookies) ──
  function propertyList(items, keyName = 'key') {
    const find = (k) => items.find((i) => String(i[keyName]).toLowerCase() === String(k).toLowerCase() && !i.disabled)
    return {
      get: (k) => (find(k) || {}).value,
      one: (k) => find(k),
      has: (k, v) => {
        const f = find(k)
        return !!f && (v === undefined || f.value === v)
      },
      add(item) {
        items.push(Object.assign({}, item))
      },
      upsert(item) {
        const f = items.find((i) => String(i[keyName]).toLowerCase() === String(item[keyName]).toLowerCase())
        if (f) Object.assign(f, item)
        else items.push(Object.assign({}, item))
      },
      remove(k) {
        const pred = typeof k === 'function' ? k : (i) => String(i[keyName]).toLowerCase() === String(k && k[keyName] !== undefined ? k[keyName] : k).toLowerCase()
        for (let i = items.length - 1; i >= 0; i--) if (pred(items[i])) items.splice(i, 1)
      },
      clear() {
        items.length = 0
      },
      each(fn) {
        items.filter((i) => !i.disabled).forEach(fn)
      },
      map(fn) {
        return items.filter((i) => !i.disabled).map(fn)
      },
      filter(fn) {
        return items.filter((i) => !i.disabled).filter(fn)
      },
      find(fn) {
        return items.filter((i) => !i.disabled).find(fn)
      },
      all: () => items.filter((i) => !i.disabled),
      count: () => items.filter((i) => !i.disabled).length,
      idx: (n) => items[n],
      toObject: () => Object.fromEntries(items.filter((i) => !i.disabled).map((i) => [i[keyName], i.value])),
      toJSON: () => items,
      get members() {
        return items
      },
    }
  }

  // ── pm.request (se puede cambiar en el pre-request) ──
  function makeRequest(r) {
    if (!r) return undefined
    const headerItems = (r.header || []).map((h) => Object.assign({}, h))
    let rawUrl = typeof r.url === 'string' ? r.url : (r.url && r.url.raw) || ''
    const queryItems = []
    const parseQuery = () => {
      queryItems.length = 0
      const q = rawUrl.split('#')[0].split('?')[1]
      if (q) for (const p of q.split('&')) {
        const i = p.indexOf('=')
        queryItems.push(i < 0 ? { key: p, value: null } : { key: p.slice(0, i), value: p.slice(i + 1) })
      }
    }
    parseQuery()
    const query = propertyList(queryItems)
    const syncQuery = () => {
      const [base, hash] = rawUrl.split('#')
      const qs = queryItems.filter((q) => !q.disabled).map((q) => (q.value === null || q.value === undefined ? q.key : `${q.key}=${q.value}`)).join('&')
      rawUrl = base.split('?')[0] + (qs ? `?${qs}` : '') + (hash !== undefined ? `#${hash}` : '')
    }
    for (const m of ['add', 'upsert', 'remove', 'clear']) {
      const orig = query[m]
      query[m] = (...a) => {
        orig(...a)
        syncQuery()
      }
    }
    const hostOf = () => {
      const m = rawUrl.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i)
      return m ? m[1].replace(/:\d+$/, '') : rawUrl.split(/[/?#]/)[0]
    }
    const url = {
      toString: () => rawUrl,
      toJSON: () => rawUrl,
      getHost: hostOf,
      getPath: () => '/' + rawUrl.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i, '').split(/[?#]/)[0].replace(/^\//, ''),
      getQueryString: () => rawUrl.split('#')[0].split('?')[1] || '',
      getPathWithQuery() {
        const q = url.getQueryString()
        return url.getPath() + (q ? `?${q}` : '')
      },
      update(s) {
        rawUrl = String(s)
        parseQuery()
      },
      addQueryParams(params) {
        for (const p of [].concat(params)) query.add(typeof p === 'string' ? { key: p.split('=')[0], value: p.split('=')[1] } : p)
      },
      removeQueryParams(params) {
        for (const p of [].concat(params)) query.remove(p)
      },
      query,
      get host() {
        return hostOf().split('.')
      },
    }
    const body = r.body ? JSON.parse(JSON.stringify(r.body)) : undefined
    if (body && body.urlencoded) body.urlencoded = propertyList(body.urlencoded)
    if (body && body.formdata) body.formdata = propertyList(body.formdata)
    if (body) {
      body.update = (v) => {
        if (typeof v === 'string') {
          body.mode = 'raw'
          body.raw = v
        } else Object.assign(body, v)
      }
      body.toString = () => (body.mode === 'raw' ? body.raw || '' : '')
      body.isEmpty = () => !body.mode || body.mode === 'none' || (body.mode === 'raw' && !body.raw)
    }
    const headers = propertyList(headerItems)
    const req = {
      id: input.requestId,
      name: input.requestName,
      method: r.method || 'GET',
      url,
      headers,
      body,
      auth: r.auth,
      addHeader: (h) => headers.add(h),
      removeHeader: (k) => headers.remove(k),
      upsertHeader: (h) => headers.upsert(h),
      getHeaders: () => headers.toObject(),
      toJSON() {
        const b = body ? Object.assign({}, body) : undefined
        if (b) {
          delete b.update
          delete b.toString
          delete b.isEmpty
          if (b.urlencoded && b.urlencoded.toJSON) b.urlencoded = b.urlencoded.toJSON()
          if (b.formdata && b.formdata.toJSON) b.formdata = b.formdata.toJSON()
        }
        return { method: req.method, url: rawUrl, header: headerItems, body: b }
      },
    }
    return req
  }

  // ── pm.response ──
  function parseSetCookie(v) {
    const parts = String(v).split(';').map((s) => s.trim())
    const [nv, ...attrs] = parts
    const i = nv.indexOf('=')
    const c = { name: nv.slice(0, i), value: nv.slice(i + 1) }
    for (const a of attrs) {
      const j = a.indexOf('=')
      const k = (j < 0 ? a : a.slice(0, j)).toLowerCase()
      const val = j < 0 ? true : a.slice(j + 1)
      if (k === 'httponly') c.httpOnly = true
      else if (k === 'secure') c.secure = true
      else if (k === 'max-age') c.maxAge = Number(val)
      else c[k] = val
    }
    return c
  }
  function cookieList(list) {
    const items = list.map((c) => Object.assign({ key: c.name }, c))
    const l = propertyList(items, 'name')
    return l
  }
  function makeResponse(r) {
    if (!r) return undefined
    const headerList = (r.headers || []).map((h) => ({ key: h.key, value: h.value }))
    const headers = propertyList(headerList)
    const res = {
      code: r.code,
      status: r.status,
      reason: () => r.status,
      responseTime: r.responseTime,
      responseSize: r.responseSize !== undefined ? r.responseSize : (r.body || '').length,
      headers,
      cookies: cookieList(headerList.filter((h) => h.key.toLowerCase() === 'set-cookie').map((h) => parseSetCookie(h.value))),
      text: () => r.body,
      json: () => JSON.parse(r.body),
      stream: r.body,
      size: () => ({ body: (r.body || '').length, header: 0, total: (r.body || '').length }),
      toJSON: () => ({ code: r.code, status: r.status, header: headerList, body: r.body, responseTime: r.responseTime }),
    }
    Object.defineProperty(res, 'to', { get: () => chai.expect(res).to })
    return res
  }

  // ── Aserciones de Postman: pm.response.to.have.status(200), .to.be.ok, .to.have.jsonBody… ──
  const isResponse = (o) => o && typeof o === 'object' && typeof o.code === 'number' && o.headers && typeof o.text === 'function'
  chai.use(function (_chai, utils) {
    const A = _chai.Assertion
    A.addMethod('status', function (code) {
      const obj = utils.flag(this, 'object')
      if (typeof code === 'number') this.assert(obj.code === code, 'expected response to have status code #{exp} but got #{act}', 'expected response to not have status code #{act}', code, obj.code)
      else this.assert(obj.status === code, 'expected response to have status reason #{exp} but got #{act}', 'expected response to not have status reason #{act}', code, obj.status)
    })
    A.addMethod('header', function (name, value) {
      const obj = utils.flag(this, 'object')
      const has = obj.headers.has(name)
      if (value === undefined) this.assert(has, `expected response to have header ${name}`, `expected response to not have header ${name}`)
      else this.assert(obj.headers.get(name) === value, `expected response header ${name} to be #{exp} but got #{act}`, `expected response header ${name} to not be #{act}`, value, obj.headers.get(name))
    })
    A.addMethod('body', function (expected) {
      const obj = utils.flag(this, 'object')
      const text = obj.text()
      if (expected === undefined) this.assert(!!text, 'expected response to have content in body', 'expected response to not have content in body')
      else if (expected instanceof RegExp) this.assert(expected.test(text), 'expected response body to match #{exp}', 'expected response body to not match #{exp}', String(expected))
      else if (typeof expected === 'string') this.assert(text === expected, 'expected response body to equal #{exp} but got #{act}', 'expected response body to not equal #{exp}', expected, text)
      else this.assert(utils.eql(JSON.parse(text), expected), 'expected response body json to equal #{exp} but got #{act}', 'expected response body json to not equal #{exp}', expected, JSON.parse(text))
    })
    A.addMethod('jsonBody', function (path, value) {
      const obj = utils.flag(this, 'object')
      let json
      try {
        json = obj.json()
      } catch (_) {
        return this.assert(false, 'expected response body to be a valid json', 'expected response body to not be a valid json')
      }
      if (path === undefined) return this.assert(true, '', 'expected response body to not be a valid json')
      if (typeof path === 'object') return this.assert(utils.eql(json, path), 'expected response body json to equal #{exp} but got #{act}', 'expected response body json to not equal #{exp}', path, json)
      const lodash = require('lodash')
      const has = lodash.has(json, path)
      if (arguments.length < 2) return this.assert(has, `expected #{this} to have property '${path}'`, `expected #{this} to not have property '${path}'`)
      const got = lodash.get(json, path)
      this.assert(has && utils.eql(got, value), `expected json property '${path}' to be #{exp} but got #{act}`, `expected json property '${path}' to not be #{exp}`, value, got)
    })
    A.addMethod('jsonSchema', function (schema) {
      const obj = utils.flag(this, 'object')
      const target = isResponse(obj) ? obj.json() : obj
      const Ajv = require('ajv')
      const ajv = new (Ajv.default || Ajv)({ allErrors: true, strict: false, logger: false })
      const valid = ajv.validate(schema, target)
      const detail = valid ? '' : ajv.errorsText(ajv.errors)
      this.assert(valid, `expected data to satisfy schema but found following errors: ${detail}`, 'expected data to not satisfy schema')
    })
    A.addMethod('responseTime', function (ms) {
      const obj = utils.flag(this, 'object')
      this.assert(obj.responseTime === ms, 'expected response time to be #{exp} but got #{act}', 'expected response time to not be #{exp}', ms, obj.responseTime)
    })
    A.addMethod('cookie', function (name, value) {
      const obj = utils.flag(this, 'object')
      const has = obj.cookies.has(name)
      if (value === undefined) this.assert(has, `expected response to have cookie ${name}`, `expected response to not have cookie ${name}`)
      else this.assert(obj.cookies.get(name) === value, `expected cookie ${name} to be #{exp} but got #{act}`, `expected cookie ${name} to not be #{exp}`, value, obj.cookies.get(name))
    })
    const classes = {
      info: [100, 199], success: [200, 299], redirection: [300, 399], clientError: [400, 499], serverError: [500, 599], error: [400, 599],
    }
    const exact = { accepted: 202, withoutContent: 204, badRequest: 400, unauthorized: 401, unauthorised: 401, forbidden: 403, notFound: 404, rateLimited: 429 }
    for (const [name, [lo, hi]] of Object.entries(classes)) {
      A.addProperty(name, function () {
        const obj = utils.flag(this, 'object')
        this.assert(obj.code >= lo && obj.code <= hi, `expected response code to be ${Math.floor(lo / 100)}XX but found #{act}`, `expected response code to not be ${Math.floor(lo / 100)}XX but found #{act}`, null, obj.code)
      })
    }
    for (const [name, code] of Object.entries(exact)) {
      A.addProperty(name, function () {
        const obj = utils.flag(this, 'object')
        this.assert(obj.code === code, `expected response to have status code ${code} but got #{act}`, `expected response to not have status code ${code}`, code, obj.code)
      })
    }
    A.overwriteProperty('ok', function (_super) {
      return function () {
        const obj = utils.flag(this, 'object')
        if (isResponse(obj)) this.assert(obj.code >= 200 && obj.code < 300, 'expected response code to be 2XX but found #{act}', 'expected response code to not be 2XX but found #{act}', null, obj.code)
        else _super.call(this)
      }
    })
    const types = { json: /json/i, html: /html/i, xml: /xml/i, javascript: /javascript/i }
    for (const [name, re] of Object.entries(types)) {
      A.addProperty(name, function () {
        const obj = utils.flag(this, 'object')
        const ct = obj.headers.get('content-type') || ''
        this.assert(re.test(ct), `expected response to have content type ${name} but got #{act}`, `expected response to not have content type ${name}`, null, ct)
      })
    }
    A.addProperty('withBody', function () {
      const obj = utils.flag(this, 'object')
      this.assert(!!obj.text(), 'expected response to have content in body', 'expected response to not have content in body')
    })
  })

  // ── Tests (también asíncronos) ──
  const pending = []
  function record(name, err) {
    return { name: String(name), passed: !err, error: err ? (err && err.message) || String(err) : undefined }
  }
  function test(name, fn) {
    if (typeof fn !== 'function') {
      out.tests.push({ name: String(name), passed: true, skipped: true })
      return pm
    }
    const slot = { name: String(name), passed: true }
    out.tests.push(slot)
    const settle = (err) => Object.assign(slot, record(name, err))
    try {
      if (fn.length > 0) {
        // pm.test('x', function (done) { … done() })
        let finished = false
        slot.pending = true
        pending.push(slot)
        fn((err) => {
          if (!finished) {
            finished = true
            delete slot.pending
            settle(err)
          }
        })
      } else {
        const r = fn()
        if (r && typeof r.then === 'function') {
          slot.pending = true
          r.then(
            () => {
              delete slot.pending
              settle()
            },
            (e) => {
              delete slot.pending
              settle(e)
            },
          )
        } else settle()
      }
    } catch (e) {
      settle(e)
    }
    return pm
  }
  test.skip = (name) => {
    out.tests.push({ name: String(name), passed: true, skipped: true })
    return pm
  }

  // ── pm.sendRequest (síncrono por debajo; callback y promesa) ──
  function sendRequest(req, cb) {
    let spec = typeof req === 'string' ? { url: req, method: 'GET' } : JSON.parse(JSON.stringify(req))
    if (spec.url && typeof spec.url === 'object') spec.url = spec.url.raw || String(spec.url)
    if (spec.header && !Array.isArray(spec.header)) spec.header = Object.entries(spec.header).map(([key, value]) => ({ key, value }))
    let result
    let error = null
    try {
      result = makeResponse(call('sendRequest', spec))
    } catch (e) {
      error = e
    }
    if (typeof cb === 'function') Promise.resolve().then(() => cb(error, result))
    return error ? Promise.reject(error) : Promise.resolve(result)
  }

  // ── Cookies ──
  const requestCookies = cookieList(input.cookies || [])
  const jarOp = (op, args, cb) => {
    let err = null
    let value
    try {
      value = call('cookie', Object.assign({ op }, args))
    } catch (e) {
      err = e
    }
    if (typeof cb === 'function') Promise.resolve().then(() => cb(err, value))
    return err ? Promise.reject(err) : Promise.resolve(value)
  }
  const cookies = Object.assign(requestCookies, {
    jar: () => ({
      get: (url, name, cb) => jarOp('get', { url, name }, cb),
      getAll: (url, cb) => jarOp('getAll', { url }, cb),
      set: (url, name, value, cb) => {
        if (typeof value === 'function') return jarOp('set', { url, cookie: typeof name === 'string' ? `${name}` : name }, value)
        return jarOp('set', { url, cookie: typeof value === 'object' ? Object.assign({ name }, value) : `${name}=${value}` }, cb)
      },
      unset: (url, name, cb) => jarOp('unset', { url, name }, cb),
      clear: (url, cb) => jarOp('clear', { url }, cb),
    }),
  })

  const setNextRequest = (name) => {
    out.nextRequest = name === undefined ? null : name
  }
  const request = makeRequest(input.request)
  const response = makeResponse(input.response)

  const pm = {
    info: {
      eventName: input.event,
      requestName: input.requestName,
      requestId: input.requestId,
      iteration: input.iteration || 0,
      iterationCount: input.iterationCount || 1,
    },
    environment,
    globals,
    collectionVariables,
    variables,
    iterationData,
    request,
    response,
    cookies,
    expect: chai.expect,
    test,
    sendRequest,
    setNextRequest,
    require,
    execution: {
      setNextRequest,
      skipRequest: () => {
        out.skipRequest = true
      },
      location: Object.assign([input.collectionName || '', input.requestName].filter(Boolean), { current: input.requestName }),
    },
    visualizer: {
      set: (template, data, options) => {
        out.visualizer = { template: String(template), data: data === undefined ? null : data, options: options || null }
      },
      clear: () => {
        out.visualizer = null
      },
    },
  }

  // ── API antigua de Postman (tests["…"], postman.*, responseBody…) ──
  const tests = new Proxy(
    {},
    {
      set(_, k, v) {
        out.tests.push({ name: String(k), passed: !!v, error: v ? undefined : 'expected true but got false' })
        return true
      },
    },
  )
  const postman = {
    setNextRequest,
    getEnvironmentVariable: (k) => environment.get(k),
    setEnvironmentVariable: (k, v) => environment.set(k, v),
    clearEnvironmentVariable: (k) => environment.unset(k),
    clearEnvironmentVariables: () => environment.clear(),
    getGlobalVariable: (k) => globals.get(k),
    setGlobalVariable: (k, v) => globals.set(k, v),
    clearGlobalVariable: (k) => globals.unset(k),
    clearGlobalVariables: () => globals.clear(),
    getResponseHeader: (k) => response && response.headers.get(k),
    getResponseCookie: (k) => response && response.cookies.one(k),
  }
  const legacy = {
    tests,
    postman,
    environment: environment.toObject(),
    globals: globals.toObject(),
    data,
    iteration: input.iteration || 0,
    responseBody: response ? response.text() : undefined,
    responseCode: response ? { code: response.code, name: response.status, detail: response.status } : undefined,
    responseHeaders: response ? response.headers.toObject() : undefined,
    responseTime: response ? response.responseTime : undefined,
    responseCookies: response ? response.cookies.all() : undefined,
    request: request ? { url: String(request.url), method: request.method, headers: request.headers.toObject(), data: request.body && request.body.raw, name: input.requestName } : undefined,
  }
  function xml2Json(xml) {
    let result
    require('xml2js').parseString(xml, { explicitArray: false, async: false }, (err, r) => {
      if (err) throw err
      result = r
    })
    return result
  }

  // ── Temporizadores: se ejecutan por orden cuando acaba el script ──
  const timers = []
  let timerSeq = 0
  const setTimeout = (fn, ms, ...args) => {
    const id = ++timerSeq
    timers.push({ id, at: Number(ms) || 0, seq: id, fn: () => fn(...args) })
    return id
  }
  const clearTimeout = (id) => {
    const i = timers.findIndex((t) => t.id === id)
    if (i >= 0) timers.splice(i, 1)
  }
  const setInterval = (fn, ms, ...args) => setTimeout(fn, ms, ...args)
  const setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args)
  globalThis.__cartero_tick = function () {
    if (!timers.length) return false
    timers.sort((a, b) => a.at - b.at || a.seq - b.seq)
    const t = timers.shift()
    try {
      t.fn()
    } catch (e) {
      out.error = errorText(e)
    }
    return true
  }
  function errorText(e) {
    // En QuickJS, stack no incluye el mensaje: se juntan los dos
    return (e && e.message ? `${e.name || 'Error'}: ${e.message}` : String(e)) + (e && e.stack ? `\n${e.stack}` : '')
  }
  globalThis.__cartero_finish = function () {
    for (const t of out.tests) {
      if (t.pending) {
        delete t.pending
        Object.assign(t, record(t.name, new Error('el test asíncrono no terminó (falta llamar a done() o resolver la promesa)')))
      }
    }
    const plain = (v) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v))
    for (const name of Object.keys(out.variables)) {
      const vals = out.variables[name]
      for (const k of Object.keys(vals)) vals[k] = plain(vals[k])
    }
    for (const k of Object.keys(local)) local[k] = plain(local[k])
    if (request && input.event === 'prerequest') out.request = request.toJSON()
    globalThis.__cartero_output = JSON.stringify(out)
  }

  const btoa = (s) => require('buffer').Buffer.from(String(s), 'binary').toString('base64')
  const atob = (s) => require('buffer').Buffer.from(String(s), 'base64').toString('binary')

  try {
    const names = ['pm', 'console', 'require', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'xml2Json', 'btoa', 'atob', ...Object.keys(legacy)]
    const values = [pm, console, require, setTimeout, clearTimeout, setInterval, clearTimeout, setImmediate, xml2Json, btoa, atob, ...Object.values(legacy)]
    new Function(...names, input.script)(...values)
  } catch (e) {
    out.error = errorText(e)
  }
})()
