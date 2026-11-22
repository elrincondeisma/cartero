import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { RunEvent, RunOptions, RunResult } from './types.js'

export interface IsolatedOptions {
  /** Tiempo máximo total de la ejecución (ms). Por defecto 5 min. */
  maxDuration?: number
  /** Memoria máxima del proceso hijo (MB). Por defecto 512. */
  maxMemoryMb?: number
  signal?: AbortSignal
}

// Desde src/ (tests con vitest) apunta al build en dist/
const childPath = fileURLToPath(
  new URL(import.meta.url.endsWith('.ts') ? '../dist/child.js' : './child.js', import.meta.url),
)

/** Ejecuta en un proceso Node aparte con límites de tiempo y memoria. */
export function runIsolated(options: RunOptions, onEvent: (e: RunEvent) => void = () => {}, iso: IsolatedOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = fork(childPath, [], {
      execArgv: [`--max-old-space-size=${iso.maxMemoryMb ?? 512}`],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'advanced',
    })
    let result: RunResult | undefined
    let stderr = ''
    child.stderr?.on('data', (d) => {
      stderr = (stderr + d).slice(-4000)
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, iso.maxDuration ?? 5 * 60_000)

    const onAbort = () => child.send({ type: 'abort' })
    iso.signal?.addEventListener('abort', onAbort, { once: true })

    child.on('message', (e: RunEvent) => {
      if (e.type === 'done') result = e.result
      onEvent(e)
    })
    child.on('exit', (code, sig) => {
      clearTimeout(timer)
      iso.signal?.removeEventListener('abort', onAbort)
      if (result) return resolve(result)
      const now = new Date().toISOString()
      const error = sig === 'SIGKILL' ? 'La ejecución superó el tiempo máximo y se detuvo' : `El proceso de ejecución terminó con código ${code}: ${stderr.trim()}`
      const failed: RunResult = {
        executions: [],
        console: [],
        stats: { requests: 0, failedRequests: 0, assertions: 0, failedAssertions: 0, iterations: 0, totalTime: 0 },
        environment: options.environment ?? [],
        globals: options.globals ?? [],
        collectionVariables: options.collection.variable ?? [],
        cookieJar: options.cookieJar,
        startedAt: now,
        finishedAt: now,
        error,
      }
      onEvent({ type: 'done', result: failed })
      resolve(failed)
    })
    child.send({ type: 'run', options })
  })
}
