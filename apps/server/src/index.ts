import { mkdirSync } from 'node:fs'
import { buildApp } from './app.js'
import { config } from './config.js'
import { sqlClient } from './db/index.js'
import { runMigrations } from './db/migrate.js'
import { closeMonitors, startMonitorWorker } from './lib/monitors.js'
import { ensureAdmin } from './lib/settings.js'
import { startTelemetry } from './lib/telemetry.js'
import { startAutoUpdates } from './lib/updates.js'

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
startAutoUpdates({ info: (m) => app.log.info(m), warn: (m) => app.log.warn(m) })
startTelemetry({ info: (m) => app.log.info(m) })

const shutdown = async () => {
  await app.close()
  await closeMonitors()
  await sqlClient.end()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
