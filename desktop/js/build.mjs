// Empaqueta cada librería del sandbox por separado para QuickJS: el script solo carga las que
// pide con require(). Genera ../crates/script/assets/libs/<nombre>.js
import { build } from 'esbuild'
import { writeFileSync, mkdirSync } from 'node:fs'

const LIBS = {
  chai: 'chai',
  lodash: 'lodash',
  'crypto-js': 'crypto-js',
  moment: 'moment',
  uuid: 'uuid',
  ajv: 'ajv',
  tv4: 'tv4',
  'csv-parse/lib/sync': 'csv-parse/lib/sync',
  xml2js: 'xml2js',
  cheerio: 'cheerio',
  buffer: 'buffer',
}

const out = '../crates/script/assets/libs'
mkdirSync(out, { recursive: true })
const names = []
for (const [name, mod] of Object.entries(LIBS)) {
  const file = name.replace(/[^a-z0-9-]/gi, '_')
  const result = await build({
    stdin: { contents: `globalThis.__cartero_lib = require(${JSON.stringify(mod)})`, resolveDir: '.', loader: 'js' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    alias: { events: 'events', timers: 'timers-browserify', string_decoder: 'string_decoder', stream: 'stream-browserify', buffer: 'buffer' },
    inject: ['./shims.js'],
  })
  writeFileSync(`${out}/${file}.js`, result.outputFiles[0].text)
  names.push([name, file, result.outputFiles[0].text.length])
}
for (const [n, f, size] of names) console.log(`${n.padEnd(22)} ${f}.js ${(size / 1024).toFixed(0)} KB`)
