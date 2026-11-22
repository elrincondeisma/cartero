// API pm.* de Cartero sobre QuickJS. Recibe el contexto en __cartero_input (JSON) y deja el
// resultado en __cartero_output. F0: el subconjunto que valida el enfoque; se completa en la F2.
;(function () {
  'use strict'
  const input = JSON.parse(globalThis.__cartero_input)
  const libs = globalThis.__cartero_libs
  const chai = libs.chai
  const out = { tests: [], console: [], variables: {}, error: null }

  // ── Ámbitos de variables: se anotan los cambios para devolverlos a Rust ──
  function scope(name) {
    const values = Object.assign({}, input.variables[name] || {})
    out.variables[name] = values
    return {
      get: (k) => values[k],
      set: (k, v) => {
        values[k] = typeof v === 'string' ? v : JSON.stringify(v)
      },
      unset: (k) => {
        delete values[k]
      },
      has: (k) => Object.prototype.hasOwnProperty.call(values, k),
      clear: () => Object.keys(values).forEach((k) => delete values[k]),
      toObject: () => Object.assign({}, values),
    }
  }
  const environment = scope('environment')
  const globals = scope('globals')
  const collectionVariables = scope('collection')
  const local = {}
  // pm.variables resuelve en el mismo orden que Postman: local > datos > entorno > colección > globales
  const variables = {
    get: (k) =>
      k in local ? local[k] : (input.iterationData || {})[k] ?? environment.get(k) ?? collectionVariables.get(k) ?? globals.get(k),
    set: (k, v) => {
      local[k] = v
    },
    has: (k) => variables.get(k) !== undefined,
    toObject: () => Object.assign({}, globals.toObject(), collectionVariables.toObject(), environment.toObject(), input.iterationData || {}, local),
  }

  // ── Respuesta (solo en post-response) ──
  let response
  if (input.response) {
    const r = input.response
    const headerList = r.headers || []
    response = {
      code: r.code,
      status: r.status,
      responseTime: r.responseTime,
      headers: {
        get: (name) => (headerList.find((h) => h.key.toLowerCase() === String(name).toLowerCase()) || {}).value,
        has: (name) => headerList.some((h) => h.key.toLowerCase() === String(name).toLowerCase()),
        toObject: () => Object.fromEntries(headerList.map((h) => [h.key, h.value])),
      },
      text: () => r.body,
      json: () => JSON.parse(r.body),
    }
    Object.defineProperty(response, 'to', { get: () => chai.expect(response).to })
  }

  // ── Aserciones de Postman sobre la respuesta: pm.response.to.have.status(200), .to.be.ok… ──
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
    A.addProperty('ok', function () {
      const obj = utils.flag(this, 'object')
      if (obj && typeof obj.code === 'number') this.assert(obj.code >= 200 && obj.code < 300, 'expected response code to be 2XX but found #{act}', 'expected response code to not be 2XX but found #{act}', null, obj.code)
      else this.assert(!!obj, 'expected #{this} to be truthy', 'expected #{this} to be falsy')
    })
  })

  const pm = {
    info: { eventName: input.event, requestName: input.requestName, iteration: input.iteration || 0 },
    environment,
    globals,
    collectionVariables,
    variables,
    iterationData: { get: (k) => (input.iterationData || {})[k], toObject: () => Object.assign({}, input.iterationData || {}) },
    request: input.request,
    response,
    expect: chai.expect,
    test(name, fn) {
      try {
        fn()
        out.tests.push({ name: String(name), passed: true })
      } catch (e) {
        out.tests.push({ name: String(name), passed: false, error: (e && e.message) || String(e) })
      }
    },
  }
  pm.test.skip = (name) => out.tests.push({ name: String(name), passed: true, skipped: true })

  const log = (level) => (...args) => out.console.push({ level, text: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') })
  const console = { log: log('log'), info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') }

  function require(name) {
    if (name in libs) return libs[name]
    throw new Error(`Cannot find module '${name}'`)
  }

  try {
    // El script del usuario, con pm, console y require como en Postman
    new Function('pm', 'console', 'require', 'postman', input.script)(pm, console, require, { setNextRequest: () => {} })
  } catch (e) {
    // En QuickJS, stack no incluye el mensaje: se juntan los dos
    out.error = (e && e.message ? `${e.name || 'Error'}: ${e.message}` : String(e)) + (e && e.stack ? `\n${e.stack}` : '')
  }
  globalThis.__cartero_output = JSON.stringify(out)
})()
