/**
 * Worker independiente para monitores. Úsalo si quieres separar la carga del servidor:
 * arranca el servidor con INLINE_WORKER=false y este proceso aparte.
 */
import { runMigrations } from './db/migrate.js'
import { closeMonitors, startMonitorWorker } from './lib/monitors.js'

await runMigrations()
await startMonitorWorker()
console.log('Worker de monitores de Cartero en marcha')

const shutdown = async () => {
  await closeMonitors()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
