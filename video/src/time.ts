/**
 * Pausas de lectura. Cada escena puede detenerse en ciertos momentos (cuando un texto ya
 * está completo) durante unos fotogramas reales: la escena se queda quieta y el fondo sigue.
 * Las escenas leen su tiempo con `useFrame()` en vez de `useCurrentFrame()`.
 */
import { createContext, useContext } from 'react'
import { useCurrentFrame } from 'remotion'

/** [fotograma de la escena en que se para, cuántos fotogramas reales dura la pausa] */
export type Hold = [at: number, len: number]

export const HoldsCtx = createContext<Hold[]>([])

/** Fotograma real dentro de la escena → fotograma de la escena (se detiene en las pausas). */
export function realToScene(real: number, holds: Hold[]): number {
  let offset = 0
  for (const [at, len] of [...holds].sort((a, b) => a[0] - b[0])) {
    const start = at + offset
    if (real < start) break
    if (real < start + len) return at
    offset += len
  }
  return real - offset
}

/** Fotograma de la escena → fotograma real (para colocar sonidos). */
export function sceneToReal(scene: number, holds: Hold[]): number {
  return scene + holds.filter(([at]) => at < scene).reduce((a, [, len]) => a + len, 0)
}

export const holdsLength = (holds: Hold[]) => holds.reduce((a, [, len]) => a + len, 0)

export function useFrame(): number {
  return realToScene(useCurrentFrame(), useContext(HoldsCtx))
}
