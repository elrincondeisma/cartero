/**
 * Proceso hijo: recibe RunOptions por IPC, ejecuta y devuelve los eventos.
 * Aísla los scripts de usuario del proceso del servidor (memoria, bucles infinitos, crashes).
 */
import { runCollection } from './run.js'
import type { RunEvent, RunOptions } from './types.js'

const controller = new AbortController()
const pending = new Set<Promise<void>>()

/** process.send es asíncrono: hay que esperar a que cada mensaje salga antes de desconectar. */
function send(e: RunEvent) {
  const p = new Promise<void>((resolve) => {
    process.send?.(e, undefined, {}, () => resolve())
  })
  pending.add(p)
  void p.then(() => pending.delete(p))
}

process.on('message', async (msg: { type: 'run'; options: RunOptions } | { type: 'abort' }) => {
  if (msg.type === 'abort') return controller.abort()
  if (msg.type === 'run') {
    await runCollection(msg.options, send, controller.signal)
    while (pending.size) await Promise.all([...pending])
    process.disconnect?.()
  }
})
