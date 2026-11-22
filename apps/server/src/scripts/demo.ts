/**
 * Datos de demostración con APIs públicas reales, reversibles.
 *
 *   pnpm --filter @cartero/server demo seed   --email tu@email.com [--lang en]
 *   pnpm --filter @cartero/server demo revert --email tu@email.com
 */
import { sqlClient } from '../db/index.js'
import { revertDemo, seedDemo } from '../lib/demo.js'

const [cmd, ...rest] = process.argv.slice(2)
const email = rest[rest.indexOf('--email') + 1]
if (!['seed', 'revert'].includes(cmd) || !rest.includes('--email') || !email) {
  console.error('Uso: demo seed|revert --email tu@email.com')
  process.exit(2)
}
try {
  if (cmd === 'seed') {
    const lang = rest.includes('--lang') && rest[rest.indexOf('--lang') + 1] === 'en' ? 'en' : 'es'
    await seedDemo(email, console.log, lang)
    console.log(`Para deshacerlo: pnpm --filter @cartero/server demo revert --email ${email}`)
  } else await revertDemo(email)
} catch {
  process.exitCode = 1
} finally {
  await sqlClient.end()
}
