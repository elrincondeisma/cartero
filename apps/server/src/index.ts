import { mkdirSync } from 'node:fs'
import { buildApp } from './app.js'
import { config } from './config.js'
import { sqlClient } from './db/index.js'
import { runMigrations } from './db/migrate.js'
import { closeMonitors, startMonitorWorker } from './lib/monitors.js'
import { ensureAdmin } from './lib/settings.js'

mkdirSync(config.filesDir, { recursive: true })
await runMigrations()
await ensureAdmin()
const app = await buildApp()

if (config.inlineWorker) {
  try {
    await startMonitorWorker()
    app.log.info('Worker de monitores iniciado')
  } catch (e) {
    app.log.warn(`No se pudo iniciar el worker de monitores (¿Redis disponible?): ${(e as Error).message}`)
  }
}

await app.listen({ port: config.port, host: config.host })

const shutdown = async () => {
  await app.close()
  await closeMonitors()
  await sqlClient.end()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
