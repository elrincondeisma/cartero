import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { badRequest } from './errors.js'
import { getSettings } from './settings.js'
import { countEvent } from './telemetry.js'

/**
 * Actualizaciones de la instancia.
 *
 * Las instalaciones usan la imagen `:stable`, que apunta a la última versión publicada. Actualizar es
 * siempre lo mismo: volver a descargar `stable` y reiniciar Cartero. Quién lo hace depende del modo:
 * - `ecs` (Fargate): la app pide a ECS un despliegue nuevo de su propio servicio.
 * - `compose` (Docker Compose y EC2): la app deja una petición que recoge el contenedor `updater`.
 */

export interface Release {
  version: string
  url: string
  publishedAt: string
}

export type UpdateState = 'idle' | 'running' | 'done' | 'failed'

export interface UpdateStatus {
  current: string
  latest: Release | null
  updateAvailable: boolean
  /** Por qué no se puede actualizar desde la app (si no se puede) */
  blocked: 'dev' | 'pinned' | 'no-updater' | 'updater-offline' | 'check-disabled' | null
  updater: 'ecs' | 'compose' | null
  state: UpdateState
  message?: string
  at?: string
  checkedAt?: string
  checkError?: string
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/

export function parseVersion(v: string): [number, number, number] | null {
  const m = SEMVER.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

/** De la lista de GitHub: la versión más alta publicada (sin borradores, prereleases ni la app de escritorio). */
export function pickLatest(releases: unknown): Release | null {
  if (!Array.isArray(releases)) return null
  let best: Release | null = null
  for (const r of releases as any[]) {
    if (!r || r.draft || r.prerelease || typeof r.tag_name !== 'string') continue
    const v = parseVersion(r.tag_name)
    if (!v) continue
    const version = v.join('.')
    if (!best || isNewer(version, best.version))
      best = { version, url: String(r.html_url ?? ''), publishedAt: String(r.published_at ?? '') }
  }
  return best
}

const CACHE_MS = 6 * 60 * 60 * 1000
let cache: { release: Release | null; at: number; error?: string } | undefined

export function clearUpdateCache() {
  cache = undefined
}

export async function latestRelease(refresh = false): Promise<typeof cache> {
  if (!refresh && cache && Date.now() - cache.at < CACHE_MS) return cache
  try {
    const res = await fetch(config.releasesUrl, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'cartero-update-check' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`GitHub respondió ${res.status}`)
    cache = { release: pickLatest(await res.json()), at: Date.now() }
  } catch (e) {
    // Si GitHub no responde nos quedamos con lo que sabíamos
    cache = { release: cache?.release ?? null, at: Date.now(), error: (e as Error).message }
  }
  return cache
}

// ───────── Docker Compose: ficheros compartidos con el updater ─────────

const file = (name: string) => path.join(config.updaterDir, name)

/** El updater toca este fichero en cada vuelta: si es reciente, está vivo. */
function updaterAlive(): boolean {
  try {
    return Date.now() - statSync(file('heartbeat')).mtimeMs < 60_000
  } catch {
    return false
  }
}

function composeState(): { state: UpdateState; message?: string; at?: string } {
  try {
    if (statSync(file('request')).isFile()) return { state: 'running', message: 'Esperando al updater' }
  } catch {}
  try {
    const s = JSON.parse(readFileSync(file('status.json'), 'utf8'))
    const state: UpdateState = ['running', 'done', 'failed'].includes(s.state) ? s.state : 'idle'
    return { state, message: s.message ? String(s.message) : undefined, at: s.at ? String(s.at) : undefined }
  } catch {
    return { state: 'idle' }
  }
}

function composeRequest() {
  mkdirSync(config.updaterDir, { recursive: true })
  const tmp = file(`request.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify({ at: new Date().toISOString(), from: config.version }))
  renameSync(tmp, file('request'))
}

// ───────── ECS (Fargate): la app redespliega su propio servicio ─────────

type EcsTarget = { cluster: string; service: string }
let ecsTarget: EcsTarget | undefined

async function ecs() {
  const { ECSClient } = await import('@aws-sdk/client-ecs')
  return new ECSClient({})
}

/** Su servicio, a partir de su propia tarea: el grupo de una tarea de servicio es «service:<nombre>». */
async function findEcsTarget(): Promise<EcsTarget> {
  if (ecsTarget) return ecsTarget
  const meta = process.env.ECS_CONTAINER_METADATA_URI_V4
  if (!meta) throw new Error('No hay metadatos de ECS (ECS_CONTAINER_METADATA_URI_V4)')
  const task = (await (await fetch(`${meta}/task`, { signal: AbortSignal.timeout(5000) })).json()) as {
    Cluster: string
    TaskARN: string
  }
  const { DescribeTasksCommand } = await import('@aws-sdk/client-ecs')
  const out = await (await ecs()).send(
    new DescribeTasksCommand({ cluster: task.Cluster, tasks: [task.TaskARN] }),
  )
  const group = out.tasks?.[0]?.group ?? ''
  if (!group.startsWith('service:')) throw new Error('Esta tarea no pertenece a un servicio de ECS')
  ecsTarget = { cluster: task.Cluster, service: group.slice('service:'.length) }
  return ecsTarget
}

async function ecsState(): Promise<{ state: UpdateState; message?: string; at?: string }> {
  try {
    const t = await findEcsTarget()
    const { DescribeServicesCommand } = await import('@aws-sdk/client-ecs')
    const out = await (await ecs()).send(
      new DescribeServicesCommand({ cluster: t.cluster, services: [t.service] }),
    )
    const primary = out.services?.[0]?.deployments?.find((d) => d.status === 'PRIMARY')
    const at = primary?.updatedAt?.toISOString()
    switch (primary?.rolloutState) {
      case 'IN_PROGRESS':
        return { state: 'running', message: primary.rolloutStateReason, at }
      case 'FAILED':
        return { state: 'failed', message: primary.rolloutStateReason, at }
      default:
        return { state: 'idle', at }
    }
  } catch (e) {
    return { state: 'idle', message: (e as Error).message }
  }
}

async function ecsRequest() {
  const t = await findEcsTarget()
  const { UpdateServiceCommand } = await import('@aws-sdk/client-ecs')
  await (await ecs()).send(
    new UpdateServiceCommand({ cluster: t.cluster, service: t.service, forceNewDeployment: true }),
  )
}

// ───────── Estado y acción ─────────

export async function updateStatus(opts: { refresh?: boolean } = {}): Promise<UpdateStatus> {
  const settings = await getSettings()
  const current = config.version
  const check = settings.updates.check
  const known = check ? await latestRelease(opts.refresh) : undefined
  const latest = known?.release ?? null
  const updateAvailable = !!latest && isNewer(latest.version, current)

  const run =
    config.updater === 'ecs'
      ? await ecsState()
      : config.updater === 'compose'
        ? composeState()
        : { state: 'idle' as const }

  let blocked: UpdateStatus['blocked'] = null
  if (!parseVersion(current)) blocked = 'dev'
  else if (config.channel !== 'stable') blocked = 'pinned'
  else if (!config.updater) blocked = 'no-updater'
  else if (config.updater === 'compose' && !updaterAlive()) blocked = 'updater-offline'
  else if (!check) blocked = 'check-disabled'

  return {
    current,
    latest,
    updateAvailable,
    blocked,
    updater: config.updater ?? null,
    ...run,
    checkedAt: known ? new Date(known.at).toISOString() : undefined,
    checkError: known?.error,
  }
}

/** Pide la actualización a quien reinicia Cartero. No lleva parámetros: siempre es «la última stable». */
export async function triggerUpdate(): Promise<void> {
  const s = await updateStatus()
  if (s.blocked) throw badRequest(`No se puede actualizar desde la app (${s.blocked})`)
  if (!s.updateAvailable) throw badRequest('Ya tienes la última versión')
  if (s.state === 'running') throw badRequest('Ya hay una actualización en marcha')
  try {
    if (config.updater === 'ecs') await ecsRequest()
    else composeRequest()
  } catch (e) {
    countEvent(`error.update.${config.updater}`)
    throw e
  }
}

// ───────── Automática, de noche ─────────

/** Ventana de la actualización automática: de 03:00 a 05:00 UTC. */
export function inAutoWindow(now: Date): boolean {
  const h = now.getUTCHours()
  return h >= 3 && h < 5
}

export async function autoUpdateTick(
  now = new Date(),
  log?: { info: (m: string) => void; warn: (m: string) => void },
) {
  if (!inAutoWindow(now)) return false
  const settings = await getSettings()
  if (!settings.updates.auto || !settings.updates.check) return false
  const s = await updateStatus({ refresh: true })
  if (!s.updateAvailable || s.blocked || s.state === 'running') return false
  try {
    await triggerUpdate()
    log?.info(`Actualización automática a ${s.latest?.version} pedida`)
    return true
  } catch (e) {
    log?.warn(`No se pudo pedir la actualización automática: ${(e as Error).message}`)
    countEvent('error.update.auto')
    return false
  }
}

let timer: NodeJS.Timeout | undefined

export function startAutoUpdates(log: { info: (m: string) => void; warn: (m: string) => void }) {
  if (timer || !config.updater) return
  timer = setInterval(() => void autoUpdateTick(new Date(), log).catch(() => {}), 60 * 60 * 1000)
  timer.unref()
}
