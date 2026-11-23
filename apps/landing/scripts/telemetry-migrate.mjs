/** Crea las tablas de la telemetría en Neon. Uso: node --env-file=.env.local scripts/telemetry-migrate.mjs */
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
if (!url) throw new Error('Falta DATABASE_URL (vercel env pull o --env-file=.env.local)')
const sql = neon(url)
const ddl = readFileSync(new URL('./telemetry-schema.sql', import.meta.url), 'utf8')
for (const stmt of ddl
  .split(/;\s*\n/)
  .map((s) => s.replace(/--.*$/gm, '').trim())
  .filter(Boolean))
  await sql.query(stmt)
console.log('Tablas de telemetría listas')
