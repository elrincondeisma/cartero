/**
 * Rescate de la administración desde la terminal (por si nadie puede entrar):
 *
 *   pnpm --filter @cartero/server admin list
 *   pnpm --filter @cartero/server admin promote  --email tu@email.com
 *   pnpm --filter @cartero/server admin password --email tu@email.com [--password nueva-clave]
 *
 * En Docker:  docker compose exec cartero node dist/scripts/admin.js <orden> …
 */
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, schema, sqlClient } from '../db/index.js'
import { hashPassword } from '../lib/crypto.js'

const [cmd, ...rest] = process.argv.slice(2)
const arg = (name: string) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined)
const email = arg('--email')?.toLowerCase()

function usage(): never {
  console.error('Uso: admin list | promote --email X | password --email X [--password Y]')
  process.exit(2)
}

try {
  if (cmd === 'list') {
    const admins = await db.select({ email: schema.users.email, name: schema.users.name, disabled: schema.users.disabled }).from(schema.users).where(eq(schema.users.role, 'admin'))
    if (!admins.length) console.log('No hay ningún admin (el servidor nombrará a la cuenta más antigua al arrancar).')
    for (const a of admins) console.log(`${a.email}  ${a.name}${a.disabled ? '  (desactivada)' : ''}`)
  } else if (cmd === 'promote' && email) {
    const r = await db.update(schema.users).set({ role: 'admin', disabled: false }).where(eq(schema.users.email, email)).returning({ id: schema.users.id })
    if (!r.length) throw new Error(`No existe ninguna cuenta con el email ${email}`)
    console.log(`${email} ya es admin de la instancia.`)
  } else if (cmd === 'password' && email) {
    const password = arg('--password') ?? randomBytes(9).toString('base64url')
    if (password.length < 8) throw new Error('La contraseña necesita al menos 8 caracteres')
    const r = await db.update(schema.users).set({ passwordHash: await hashPassword(password), disabled: false }).where(eq(schema.users.email, email)).returning({ id: schema.users.id })
    if (!r.length) throw new Error(`No existe ninguna cuenta con el email ${email}`)
    // Cierra las sesiones abiertas de esa cuenta
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, r[0].id))
    console.log(`Contraseña nueva para ${email}: ${password}`)
  } else usage()
} catch (e) {
  console.error((e as Error).message)
  process.exitCode = 1
} finally {
  await sqlClient.end()
}
