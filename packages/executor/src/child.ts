/**
 * Proceso hijo: recibe RunOptions por IPC, ejecuta y devuelve los eventos.
 * Aísla los scripts de usuario del proceso del servidor (memoria, bucles infinitos, crashes).
 */
import { runCollection } from './run.js'
import type { RunOptions } from './types.js'

const controller = new AbortController()

process.on('message', async (msg: { type: 'run'; options: RunOptions } | { type: 'abort' }) => {
  if (msg.type === 'abort') return controller.abort()
  if (msg.type === 'run') {
    await runCollection(msg.options, (event) => process.send?.(event), controller.signal)
    process.disconnect?.()
    setTimeout(() => process.exit(0), 50)
  }
})
