import { randomUUID } from 'node:crypto'
import { arch, platform } from 'node:os'
import { eq, gt, lte, sql } from 'drizzle-orm'
import { config } from '../config.js'
import { db, schema } from '../db/index.js'
import { pingRedis } from './monitors.js'
import { getSettings } from './settings.js'
import { parseVersion } from './updates.js'

/**
 * Telemetría anónima.
 *
 * Una vez al día, la instancia envía recuentos y datos técnicos a cartero.elrincondeisma.com para saber
 * cuánta gente usa Cartero y cómo. **Nunca** se envía contenido: ni peticiones, URLs, colecciones,
 * variables, secretos, emails ni nombres. El informe exacto se ve en Administración → Sistema.
 *
 * Se apaga en Administración, en el asistente de instalación o con CARTERO_TELEMETRY=off (o DO_NOT_TRACK=1).
 */

export const TELEMETRY_SCHEMA = 1
const STATE_KEY = 'telemetry_state'
const DAY_MS = 24 * 60 * 60 * 1000

interface TelemetryState {
  instanceId: string
  lastSentAt?: string
  /** Último informe enviado, tal cual (para enseñarlo en Administración) */
  lastReport?: TelemetryReport
}

// ───────── Contadores (importaciones, MCP, errores…) ─────────

/** Claves técnicas fijas: letras, números y unos pocos signos; nunca texto que venga del usuario. */
const SAFE_KEY = /^[a-z0-9_.:/ -]{1,120}$/i

const today = () => new Date().toISOString().slice(0, 10)

/** Suma 1 a un contador del día. No lanza nunca: la telemetría no puede romper nada. */
export function countEvent(key: string, n = 1): void {
  if (config.telemetryDisabledByEnv || !SAFE_KEY.test(key)) return
  void db
    .insert(schema.telemetryCounters)
    .values({ day: today(), key, n })
    .onConflictDoUpdate({
      target: [schema.telemetryCounters.day, schema.telemetryCounters.key],
      set: { n: sql`${schema.telemetryCounters.n} + ${n}` },
    })
    .catch(() => {})
}

/** Normaliza el formato que detecta el importador (`openapi-3.1.0` → `openapi-3`). */
export function importKey(format: string): string {
  const f = format.toLowerCase()
  if (f.startsWith('openapi')) return `import.${f.replace(/^(openapi-\d+).*/, '$1')}`
  return `import.${f.replace(/[^a-z0-9-]/g, '').slice(0, 40)}`
}

// ───────── Estado ─────────

async function readState(): Promise<TelemetryState> {
  const [row] = await db
    .select()
    .from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.key, STATE_KEY))
  const value = row?.value as TelemetryState | undefined
  if (value?.instanceId) return value
  const fresh: TelemetryState = { instanceId: randomUUID() }
  await writeState(fresh)
  return fresh
}

async function writeState(state: TelemetryState) {
  await db
    .insert(schema.instanceSettings)
    .values({ key: STATE_KEY, value: state })
    .onConflictDoUpdate({ target: schema.instanceSettings.key, set: { value: state, updatedAt: new Date() } })
}

export async function telemetryEnabled(): Promise<boolean> {
  if (config.telemetryDisabledByEnv) return false
  return (await getSettings()).telemetry.enabled
}

// ───────── Informe ─────────

export interface TelemetryReport {
  schema: number
  instanceId: string
  sentAt: string
  /** Desde cuándo cuentan los datos de «uso» */
  since: string
  install: Record<string, string | number | boolean | null>
  config: Record<string, boolean>
  size: Record<string, number>
  usage: Record<string, number>
  errors: Record<string, number>
}

const n = (v: unknown) => Number(v ?? 0)

async function count(table: any, where?: any): Promise<number> {
  const q = db.select({ n: sql<number>`count(*)::int` }).from(table)
  const [row] = await (where ? q.where(where) : q)
  return n(row?.n)
}

function deployMode(): string {
  if (config.deployMode) return config.deployMode.replace(/[^a-z0-9-]/gi, '').slice(0, 30)
  return parseVersion(config.version) ? 'source' : 'dev'
}

async function postgresMajor(): Promise<string | null> {
  try {
    const rows = (await db.execute(sql`show server_version_num`)) as unknown as Array<{
      server_version_num: string
    }>
    const v = Number(rows[0]?.server_version_num)
    return v ? String(Math.floor(v / 10000)) : null
  } catch {
    return null
  }
}

/** Construye el informe. Solo recuentos y datos técnicos: los tests comprueban que no se cuela contenido. */
export async function buildReport(now = new Date()): Promise<TelemetryReport> {
  const state = await readState()
  const s = await getSettings()
  const since = state.lastSentAt ? new Date(state.lastSentAt) : new Date(now.getTime() - DAY_MS)
  const after = (col: any) => gt(col, since)
  const days = (d: number) => sql`now() - make_interval(days => ${d})`
  const T = schema

  const [first] = await db.select({ at: sql<string>`min(${T.users.createdAt})` }).from(T.users)
  const installDays = first?.at
    ? Math.max(0, Math.floor((now.getTime() - new Date(first.at).getTime()) / DAY_MS))
    : 0

  const active = async (d: number) => {
    const rows = (await db.execute(sql`
      select count(distinct user_id)::int as n from (
        select user_id from ${T.sessions} where ${T.sessions.createdAt} > ${days(d)}
        union all select user_id from ${T.history} where ${T.history.createdAt} > ${days(d)}
        union all select user_id from ${T.runs} where ${T.runs.startedAt} > ${days(d)} and user_id is not null
      ) a`)) as unknown as Array<{ n: number }>
    return n(rows[0]?.n)
  }

  // Runs por origen y resultado desde el último informe
  const runRows = await db
    .select({ source: T.runs.source, status: T.runs.status, n: sql<number>`count(*)::int` })
    .from(T.runs)
    .where(after(T.runs.startedAt))
    .groupBy(T.runs.source, T.runs.status)
  const usage: Record<string, number> = {
    requestsSent: await count(T.history, after(T.history.createdAt)),
    mockHits: await count(T.mockLogs, after(T.mockLogs.createdAt)),
    comments: await count(T.comments, after(T.comments.createdAt)),
  }
  for (const r of runRows) {
    const src = String(r.source).replace(/[^a-z]/g, '')
    const st = String(r.status).replace(/[^a-z]/g, '')
    usage[`runs.${src}`] = (usage[`runs.${src}`] ?? 0) + n(r.n)
    usage[`runs.${src}.${st}`] = n(r.n)
  }

  // Contadores de eventos (importaciones, MCP, cURL, errores) de los días pendientes
  const counters = await db
    .select({ key: T.telemetryCounters.key, n: sql<number>`sum(${T.telemetryCounters.n})::int` })
    .from(T.telemetryCounters)
    .where(lte(T.telemetryCounters.day, today()))
    .groupBy(T.telemetryCounters.key)
  const errors: Record<string, number> = {}
  for (const c of counters) {
    if (!SAFE_KEY.test(c.key)) continue
    if (c.key.startsWith('error.')) errors[c.key.slice(6)] = n(c.n)
    else usage[c.key] = n(c.n)
  }

  return {
    schema: TELEMETRY_SCHEMA,
    instanceId: state.instanceId,
    sentAt: now.toISOString(),
    since: since.toISOString(),
    install: {
      version: config.version,
      channel: config.channel,
      mode: deployMode(),
      os: platform(),
      arch: arch(),
      node: process.versions.node.split('.')[0],
      postgres: await postgresMajor(),
      redis: await pingRedis().catch(() => false),
      inlineWorker: config.inlineWorker,
      installDays,
    },
    config: {
      google: s.providers.google.enabled,
      github: s.providers.github.enabled,
      smtp: !!s.smtp.url,
      openRegistration: s.allowRegistration,
      limitedDomains: s.allowedDomains.length > 0,
      blockPrivateNetworks: s.blockPrivateNetworks,
      updateCheck: s.updates.check,
      autoUpdate: s.updates.auto,
      setupCompleted: s.setupCompleted !== false,
    },
    size: {
      users: await count(T.users),
      admins: await count(T.users, eq(T.users.role, 'admin')),
      disabledUsers: await count(T.users, eq(T.users.disabled, true)),
      activeUsers7d: await active(7),
      activeUsers30d: await active(30),
      personalWorkspaces: await count(T.workspaces, eq(T.workspaces.type, 'personal')),
      teamWorkspaces: await count(T.workspaces, eq(T.workspaces.type, 'team')),
      collections: await count(T.collections),
      savedRequests: await count(T.items, eq(T.items.type, 'request')),
      environments: await count(T.environments),
      mocks: await count(T.mocks),
      monitors: await count(T.monitors),
      activeMonitors: await count(T.monitors, eq(T.monitors.enabled, true)),
      publishedDocs: await count(T.docs, eq(T.docs.published, true)),
      apiTokensUsed30d: await count(T.apiTokens, gt(T.apiTokens.lastUsedAt, days(30) as any)),
    },
    usage,
    errors,
  }
}

// ───────── Envío ─────────

export interface SendResult {
  sent: boolean
  reason?: string
}

/** Envía el informe si toca (cada 24 h). `force` lo envía aunque no haya pasado un día. */
export async function sendReport(opts: { force?: boolean; now?: Date } = {}): Promise<SendResult> {
  const now = opts.now ?? new Date()
  if (!(await telemetryEnabled())) return { sent: false, reason: 'disabled' }
  const state = await readState()
  if (
    !opts.force &&
    state.lastSentAt &&
    now.getTime() - new Date(state.lastSentAt).getTime() < DAY_MS - 60_000
  )
    return { sent: false, reason: 'not-due' }
  const report = await buildReport(now)
  try {
    const res = await fetch(config.telemetryUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': `cartero/${config.version}` },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { sent: false, reason: `http-${res.status}` }
  } catch (e) {
    return { sent: false, reason: (e as Error).name === 'TimeoutError' ? 'timeout' : 'network' }
  }
  // Los contadores enviados se borran; los que lleguen a partir de ahora van al próximo informe
  await db.delete(schema.telemetryCounters).where(lte(schema.telemetryCounters.day, today()))
  await writeState({ ...state, lastSentAt: now.toISOString(), lastReport: report })
  return { sent: true }
}

/** Para Administración: si está activa, por qué no, el último informe enviado y el siguiente. */
export async function telemetryStatus() {
  const state = await readState()
  const s = await getSettings()
  return {
    enabled: !config.telemetryDisabledByEnv && s.telemetry.enabled,
    disabledByEnv: config.telemetryDisabledByEnv,
    lastSentAt: state.lastSentAt ?? null,
    nextAt: state.lastSentAt ? new Date(new Date(state.lastSentAt).getTime() + DAY_MS).toISOString() : null,
    lastReport: state.lastReport ?? null,
    preview: await buildReport(),
  }
}

let timer: NodeJS.Timeout | undefined

/** Primer informe a los 10 minutos de arrancar; después se comprueba cada hora si toca. */
export function startTelemetry(log: { info: (m: string) => void }) {
  if (timer) return
  if (config.telemetryDisabledByEnv) {
    log.info('Telemetría anónima apagada (CARTERO_TELEMETRY / DO_NOT_TRACK)')
    return
  }
  log.info(
    'Telemetría anónima: una vez al día se envían recuentos (nunca contenido). Mira el informe o apágala en Administración → Sistema, o con CARTERO_TELEMETRY=off',
  )
  const tick = () => void sendReport().catch(() => {})
  setTimeout(tick, 10 * 60 * 1000).unref()
  timer = setInterval(tick, 60 * 60 * 1000)
  timer.unref()
}
