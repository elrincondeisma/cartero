import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { Collection, Variable } from '@cartero/core'
import { PRIVATE_NETWORKS, type RunEvent, type RunOptions, type RunResult, runIsolated } from '@cartero/executor'
import { and, eq } from 'drizzle-orm'
import { config } from '../config.js'
import { db, schema } from '../db/index.js'
import { openVariables, sealVariables } from './crypto.js'
import { getSettings } from './settings.js'
import { broadcast } from './realtime.js'

export interface RunContext {
  workspaceId: string
  userId?: string
  environmentId?: string | null
}

/** Carga entorno, globales y cookie jar para ejecutar. */
export async function loadContext(ctx: RunContext) {
  const [ws] = await db.select({ globals: schema.workspaces.globals }).from(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId))
  let environment: Variable[] = []
  if (ctx.environmentId) {
    const [env] = await db
      .select()
      .from(schema.environments)
      .where(and(eq(schema.environments.id, ctx.environmentId), eq(schema.environments.workspaceId, ctx.workspaceId)))
    environment = openVariables(env?.values ?? [])
  }
  let cookieJar: unknown
  if (ctx.userId) {
    const [jar] = await db
      .select()
      .from(schema.cookieJars)
      .where(and(eq(schema.cookieJars.workspaceId, ctx.workspaceId), eq(schema.cookieJars.userId, ctx.userId)))
    cookieJar = jar?.jar
  }
  return { environment, globals: openVariables(ws?.globals ?? []) as Variable[], cookieJar }
}

function sameVars(a: Variable[], b: Variable[]) {
  const norm = (v: Variable[]) => JSON.stringify(v.map((x) => [x.key, String(x.value ?? ''), !!x.disabled]))
  return norm(a) === norm(b)
}

/** Conserva tipo/descr. de las variables originales al guardar las modificadas por scripts. */
function mergeVars(original: Variable[], updated: Variable[]): Variable[] {
  return updated.map((u) => {
    const o = original.find((x) => x.key === u.key)
    return o ? { ...o, value: u.value, disabled: u.disabled ?? o.disabled } : u
  })
}

/** Persiste los cambios que los scripts hicieron en variables y cookies. */
export async function persistResult(
  ctx: RunContext,
  before: { environment: Variable[]; globals: Variable[]; collectionVariables?: Variable[]; collectionId?: string },
  result: RunResult,
  canWrite: boolean,
) {
  const changed: string[] = []
  if (canWrite) {
    if (ctx.environmentId && !sameVars(before.environment, result.environment)) {
      await db
        .update(schema.environments)
        .set({ values: sealVariables(mergeVars(before.environment, result.environment)), updatedAt: new Date() })
        .where(eq(schema.environments.id, ctx.environmentId))
      changed.push('environment')
    }
    if (!sameVars(before.globals, result.globals)) {
      await db
        .update(schema.workspaces)
        .set({ globals: sealVariables(mergeVars(before.globals, result.globals)) })
        .where(eq(schema.workspaces.id, ctx.workspaceId))
      changed.push('globals')
    }
    if (before.collectionId && before.collectionVariables && !sameVars(before.collectionVariables, result.collectionVariables)) {
      const [col] = await db.select({ data: schema.collections.data }).from(schema.collections).where(eq(schema.collections.id, before.collectionId))
      if (col) {
        await db
          .update(schema.collections)
          .set({ data: { ...col.data, variable: mergeVars(before.collectionVariables, result.collectionVariables) } })
          .where(eq(schema.collections.id, before.collectionId))
        changed.push('collection')
      }
    }
    if (changed.includes('environment') || changed.includes('globals'))
      broadcast(ctx.workspaceId, { type: 'environments.changed', by: ctx.userId ?? 'system' })
    if (changed.includes('collection') && before.collectionId)
      broadcast(ctx.workspaceId, { type: 'collection.changed', collectionId: before.collectionId, action: 'variables', by: ctx.userId ?? 'system' })
  }
  if (ctx.userId && result.cookieJar) {
    await db
      .insert(schema.cookieJars)
      .values({ workspaceId: ctx.workspaceId, userId: ctx.userId, jar: result.cookieJar })
      .onConflictDoUpdate({ target: [schema.cookieJars.workspaceId, schema.cookieJars.userId], set: { jar: result.cookieJar, updatedAt: new Date() } })
  }
  return changed
}

export async function baseRunOptions(): Promise<Partial<RunOptions>> {
  const { blockPrivateNetworks } = await getSettings()
  return {
    timeoutRequest: 120_000,
    timeoutScript: 30_000,
    fileResolverBaseDir: path.resolve(config.filesDir),
    restrictedAddresses: blockPrivateNetworks ? PRIVATE_NETWORKS : undefined,
  }
}

// --- Runs en segundo plano con eventos en vivo (SSE) ---

interface LiveRun {
  events: RunEvent[]
  emitter: EventEmitter
  abort: AbortController
  done: boolean
}

const live = new Map<string, LiveRun>()

export function getLiveRun(runId: string) {
  return live.get(runId)
}

export interface StartRunInput extends RunContext {
  collectionId: string
  collection: Collection
  name: string
  source: 'app' | 'cli' | 'monitor'
  monitorId?: string
  options: Partial<RunOptions>
  persistVariables?: boolean
  canWrite: boolean
  onFinish?: (result: RunResult, runId: string) => Promise<void> | void
}

/** Crea el run en BD y lo ejecuta en segundo plano. Devuelve el id inmediatamente. */
export async function startRun(input: StartRunInput): Promise<string> {
  const ctx = await loadContext(input)
  const [run] = await db
    .insert(schema.runs)
    .values({
      workspaceId: input.workspaceId,
      collectionId: input.collectionId,
      environmentId: input.environmentId ?? null,
      monitorId: input.monitorId,
      userId: input.userId,
      source: input.source,
      name: input.name,
      status: 'running',
    })
    .returning()

  const state: LiveRun = { events: [], emitter: new EventEmitter(), abort: new AbortController(), done: false }
  state.emitter.setMaxListeners(100)
  live.set(run.id, state)

  const collectionVariables = input.collection.variable ?? []
  void runIsolated(
    { ...(await baseRunOptions()), ...input.options, collection: input.collection, environment: ctx.environment, globals: ctx.globals, cookieJar: ctx.cookieJar },
    (e) => {
      // Las ejecuciones con cuerpos grandes no se guardan enteras en memoria para el replay
      state.events.push(e)
      state.emitter.emit('event', e)
    },
    { signal: state.abort.signal, maxDuration: 30 * 60_000 },
  ).then(async (result) => {
    const failed = result.stats.failedAssertions > 0 || result.stats.failedRequests > 0
    const status = state.abort.signal.aborted ? 'aborted' : result.error ? 'error' : failed ? 'failed' : 'passed'
    await db
      .update(schema.runs)
      .set({ status, stats: result.stats, result: compactResult(result), finishedAt: new Date() })
      .where(eq(schema.runs.id, run.id))
    if (input.persistVariables !== false) {
      await persistResult(
        input,
        { environment: ctx.environment, globals: ctx.globals, collectionVariables, collectionId: input.collectionId },
        result,
        input.canWrite,
      )
    }
    state.done = true
    state.emitter.emit('end', status)
    broadcast(input.workspaceId, { type: 'run.updated', runId: run.id, status })
    await input.onFinish?.(result, run.id)
    // Mantener el buffer unos minutos para clientes que se reconecten
    setTimeout(() => live.delete(run.id), 5 * 60_000)
  })
  return run.id
}

const MAX_STORED_BODY = 256 * 1024

/** Recorta cuerpos enormes antes de guardar el resultado en BD. */
export function compactResult(result: RunResult): RunResult {
  return {
    ...result,
    cookieJar: undefined,
    executions: result.executions.map((e) => {
      if (!e.response) return e
      const r = { ...e.response }
      if (r.body && r.body.length > MAX_STORED_BODY) {
        r.body = r.body.slice(0, MAX_STORED_BODY)
        r.truncated = true
      }
      if (r.bodyBase64 && r.bodyBase64.length > MAX_STORED_BODY) {
        r.bodyBase64 = undefined
        r.truncated = true
      }
      return { ...e, response: r }
    }),
  }
}
