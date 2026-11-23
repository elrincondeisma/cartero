/** Envoltorio de @clack/prompts: si el usuario cancela (Ctrl+C / Esc), se sale sin tocar nada. */
import * as clack from '@clack/prompts'
import { lang, m } from '../i18n.js'

/**
 * clack con los textos que no traduce: la ayuda de las flechas va fija en inglés (se oculta en
 * español) y los botones de confirmar se traducen.
 */
export const p: typeof clack = {
  ...clack,
  select: <V>(o: Parameters<typeof clack.select<V>>[0]) =>
    clack.select<V>({ showInstructions: lang() === 'en', ...o }),
  confirm: (o: Parameters<typeof clack.confirm>[0]) =>
    clack.confirm({ active: m.yesButton, inactive: m.noButton, ...o }),
}

export async function ask<T>(prompt: Promise<T>): Promise<Exclude<T, symbol>> {
  const v = await prompt
  if (clack.isCancel(v)) {
    clack.cancel(m.cancelled)
    process.exit(0)
  }
  return v as Exclude<T, symbol>
}

/** Ejecuta una tarea con spinner; si falla, muestra el error y lo relanza. */
export async function withSpinner<T>(msg: string, fn: () => Promise<T>, done?: (v: T) => string): Promise<T> {
  const s = clack.spinner()
  s.start(msg)
  try {
    const v = await fn()
    s.stop(done ? done(v) : msg)
    return v
  } catch (err) {
    s.error(`${msg}: ${(err as Error).message}`)
    throw err
  }
}
