// Lo mínimo de Node que esperan algunas librerías (xml2js, cheerio)
import { Buffer } from 'buffer'
export { Buffer }
export const process = { env: {}, nextTick: (fn, ...a) => Promise.resolve().then(() => fn(...a)), version: 'v18.0.0', versions: {}, platform: 'quickjs', browser: true }
