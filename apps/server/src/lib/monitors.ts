import { Queue, Worker } from 'bullmq'
import { eq } from 'drizzle-orm'
import { Redis } from 'ioredis'
import { config } from '../config.js'
import { db, schema } from '../db/index.js'
import { type NotifyTarget, notify } from './notify.js'
import { startRun } from './runner.js'
import { publicUrl } from './settings.js'
import { loadCollection } from './tree.js'

const QUEUE = 'cartero-monitors'
let connection: Redis | undefined
let queue: Queue | undefined
let worker: Worker | undefined

function conn() {
  connection ??= new Redis(config.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false })
  return connection
}

function getQueue() {
  queue ??= new Queue(QUEUE, { connection: conn() })
  return queue
}

type MonitorRow = typeof schema.monitors.$inferSelect

/** Crea/actualiza (o elimina) la programación de un monitor. */
export async function scheduleMonitor(m: MonitorRow) {
  const q = getQueue()
  if (!m.enabled) {
    await q.removeJobScheduler(m.id)
    return
  }
  await q.upsertJobScheduler(
    m.id,
    { pattern: m.cron, tz: m.timezone || 'UTC' },
    { name: 'monitor', data: { monitorId: m.id }, opts: { removeOnComplete: 100, removeOnFail: 100 } },
  )
}

export async function unscheduleMonitor(id: string) {
  await getQueue().removeJobScheduler(id)
}

export async function nextRuns(id: string): Promise<number | undefined> {
  const s = await getQueue().getJobScheduler(id)
  return s?.next
}

/** Ejecuta un monitor ahora y espera a que termine. */
export async function runMonitor(monitorId: string): Promise<string | undefined> {
  const [m] = await db.select().from(schema.monitors).where(eq(schema.monitors.id, monitorId))
  if (!m) return undefined
  const { collection } = await loadCollection(m.collectionId)
  return new Promise<string>((resolve) => {
    let id = ''
    void startRun({
      workspaceId: m.workspaceId,
      environmentId: m.environmentId,
      collectionId: m.collectionId,
      collection,
      name: `Monitor: ${m.name}`,
      source: 'monitor',
      monitorId: m.id,
      canWrite: false,
      persistVariables: false,
      options: { iterationCount: 1, timeoutRequest: 60_000 },
      onFinish: async (result, runId) => {
        const failed = result.error || result.stats.failedAssertions > 0 || result.stats.failedRequests > 0
        const status = result.error ? 'error' : failed ? 'failed' : 'passed'
        await db.update(schema.monitors).set({ lastRunAt: new Date(), lastStatus: status }).where(eq(schema.monitors.id, m.id))
        const failures = result.executions
          .flatMap((e) => [
            ...(e.error ? [`• ${e.name}: ${e.error}`] : []),
            ...e.tests.filter((t) => !t.passed && !t.skipped).map((t) => `• ${e.name} › ${t.name}: ${t.error ?? 'falló'}`),
          ])
          .slice(0, 15)
        const s = result.stats
        const text = [
          `${s.requests} peticiones, ${s.assertions - s.failedAssertions}/${s.assertions} tests OK, ${s.totalTime} ms`,
          ...(result.error ? [`Error: ${result.error}`] : []),
          ...failures,
        ].join('\n')
        const errors = await notify(m.notify as NotifyTarget[], {
          title: `Monitor «${m.name}» ${status === 'passed' ? 'OK' : 'ha fallado'}`,
          text,
          status,
          url: `${await publicUrl()}/w/${m.workspaceId}/runs/${runId}`,
          data: { monitorId: m.id, runId, stats: s },
        })
        if (errors.length) console.warn(`Avisos del monitor ${m.id} con errores:`, errors)
        resolve(runId)
      },
    }).then((runId) => {
      id = runId
    })
    void id
  })
}

/** Arranca el worker que procesa las ejecuciones programadas. */
export async function startMonitorWorker() {
  worker = new Worker(
    QUEUE,
    async (job) => {
      await runMonitor(job.data.monitorId)
    },
    { connection: conn(), concurrency: 4 },
  )
  worker.on('failed', (job, err) => console.error(`Monitor ${job?.data?.monitorId} falló:`, err.message))
  // Re-sincroniza las programaciones con la BD al arrancar
  const all = await db.select().from(schema.monitors)
  for (const m of all) await scheduleMonitor(m).catch((e) => console.error('No se pudo programar el monitor', m.id, e.message))
  return worker
}

export async function closeMonitors() {
  await worker?.close()
  await queue?.close()
  connection?.disconnect()
}

/** ¿Responde Redis? (para la pestaña Sistema del panel). No crea la cola si no existía. */
export async function pingRedis(): Promise<boolean> {
  const r = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 2000, retryStrategy: () => null })
  try {
    await r.connect()
    return (await r.ping()) === 'PONG'
  } catch {
    return false
  } finally {
    r.disconnect()
  }
}
