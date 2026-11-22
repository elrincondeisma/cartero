import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db, sqlClient } from './index.js'

export async function runMigrations() {
  const folder = fileURLToPath(new URL('../../drizzle', import.meta.url))
  await migrate(db, { migrationsFolder: folder })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations()
  await sqlClient.end()
  console.log('Migraciones aplicadas')
}
