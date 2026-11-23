/**
 * Piezas de movimiento del vídeo:
 * - ritmo: la música va a 120 BPM, un golpe cada 15 fotogramas (`beat(n)`);
 * - `Mask`: texto que se revela (y se va) bajo una máscara, palabra a palabra;
 * - `Camera`: un mundo que la cámara recorre con fotogramas clave encadenados;
 * - `bump`: énfasis (un pequeño salto) en el golpe;
 * - `Stamp`: el logo (sello con llaves), con troquelado, llaves y separación animables.
 */
import type React from 'react'
import { AbsoluteFill, Easing, Img, interpolate } from 'remotion'
import { useFrame } from './time'
import { C } from './kit'

/** Fotogramas por golpe (120 BPM a 30 fps). Las escenas empiezan en compás. */
export const BEAT = 15
export const beat = (n: number) => Math.round(n * BEAT)

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
/** Salida rápida y aterrizaje suave: el gesto principal del vídeo. */
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1)
/** Para la cámara: arranca y frena sin tirones. */
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1)
export const easeIn = Easing.bezier(0.55, 0, 1, 0.45)

/** 0→1 entre `a` y `b` con la curva dada. */
export const prog = (f: number, a: number, b: number, ease = easeOut) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: ease })

/** Énfasis en el golpe `at`: 1 → 1+amt → 1 en `dur` fotogramas. */
export function bump(f: number, at: number, amt = 0.12, dur = 12) {
  const t = (f - at) / dur
  if (t <= 0 || t >= 1) return 1
  return 1 + amt * Math.sin(Math.PI * t) * (1 - t * 0.4)
}

/** Sacudida corta (para «se ha roto algo»). */
export function shake(f: number, at: number, px = 10, dur = 10) {
  const t = (f - at) / dur
  if (t <= 0 || t >= 1) return 0
  return Math.sin(t * Math.PI * 7) * px * (1 - t)
}

/**
 * Texto revelado bajo máscara: cada palabra sube desde detrás de una línea invisible.
 * `outAt` la hace salir hacia arriba por la misma máscara (encadenado: entra la siguiente).
 */
export const Mask: React.FC<{
  text: string
  at: number
  stagger?: number
  dur?: number
  outAt?: number
  size?: number
  weight?: number
  color?: string
  hl?: string[]
  mono?: string
  code?: string[]
  style?: React.CSSProperties
  align?: 'left' | 'center'
}> = ({ text, at, stagger = 3, dur = 16, outAt, size = 84, weight = 800, color = C.text, hl = [], code = [], mono, style, align = 'left' }) => {
  const f = useFrame()
  const words = text.split(' ')
  return (
    <div
      style={{
        fontSize: size,
        fontWeight: weight,
        lineHeight: 1.08,
        letterSpacing: '-0.035em',
        color,
        textAlign: align,
        ...style,
      }}
    >
      {words.map((w, i) => {
        const pin = prog(f, at + i * stagger, at + i * stagger + dur)
        const pout = outAt === undefined ? 0 : prog(f, outAt + i * Math.max(1, stagger - 1), outAt + i * Math.max(1, stagger - 1) + 12, easeIn)
        // 130 %: con los márgenes de la máscara, menos deja asomar el borde de las letras
        const y = (1 - pin) * 130 - pout * 130
        const bare = w.replace(/[.,!?:]$/, '')
        const isHl = hl.includes(bare)
        const isCode = code.includes(bare)
        return (
          <span
            key={`${w}-${i}`}
            style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', padding: '0.06em 0.02em 0.14em', margin: '-0.06em 0.22em -0.14em 0' }}
          >
            <span
              style={{
                display: 'inline-block',
                transform: `translateY(${y}%)`,
                ...(isHl
                  ? { background: 'linear-gradient(90deg,#fdba74,#f97316 60%,#ea580c)', WebkitBackgroundClip: 'text', color: 'transparent' }
                  : {}),
                ...(isCode ? { fontFamily: mono, color: C.brand, letterSpacing: '-0.02em' } : {}),
              }}
            >
              {w}
            </span>
          </span>
        )
      })}
    </div>
  )
}

/** Bloque (párrafo, fila de chips…) que sube bajo una máscara. */
export const MaskBlock: React.FC<{ at: number; outAt?: number; dur?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  at,
  outAt,
  dur = 18,
  children,
  style,
}) => {
  const f = useFrame()
  const pin = prog(f, at, at + dur)
  const pout = outAt === undefined ? 0 : prog(f, outAt, outAt + 12, easeIn)
  return (
    <div style={{ overflow: 'hidden', padding: '0.1em 0 0.2em', margin: '-0.1em 0 -0.2em', ...style }}>
      <div style={{ transform: `translateY(${(1 - pin) * 130 - pout * 130}%)` }}>{children}</div>
    </div>
  )
}

/** [fotograma en que se llega, x, y, zoom] en coordenadas del mundo. */
export type CamKey = [number, number, number, number]

/**
 * Posición de la cámara: entre dos claves se mueve con `easeInOut`; si las claves van
 * seguidas el movimiento se encadena sin pararse. El zoom se interpola en escala logarítmica
 * para que acercarse y alejarse se sienta igual de rápido.
 */
export function camAt(f: number, keys: CamKey[]): [number, number, number] {
  if (f <= keys[0][0]) return [keys[0][1], keys[0][2], keys[0][3]]
  for (let i = 1; i < keys.length; i++) {
    const [a, x0, y0, z0] = keys[i - 1]
    const [b, x1, y1, z1] = keys[i]
    if (f <= b) {
      const t = easeInOut((f - a) / Math.max(1, b - a))
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * t)]
    }
  }
  const k = keys[keys.length - 1]
  return [k[1], k[2], k[3]]
}

/** Lleva un punto del mundo a la pantalla con la cámara actual. */
export const toScreen = (cam: [number, number, number], x: number, y: number): [number, number] => [960 + (x - cam[0]) * cam[2], 540 + (y - cam[1]) * cam[2]]

export const Camera: React.FC<{ keys: CamKey[]; children: React.ReactNode; offset?: [number, number] }> = ({ keys, children, offset = [0, 0] }) => {
  const f = useFrame()
  const [x, y, z] = camAt(f, keys)
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transformOrigin: '0 0',
          transform: `translate(${960 + offset[0]}px, ${540 + offset[1]}px) scale(${z}) translate(${-x}px, ${-y}px)`,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  )
}

/** Troqueles del sello (lienzo de 32×32). */
const NOTCHES = [2, 9, 16, 23, 30].flatMap((p) => [
  [p, 2],
  [p, 30],
  ...(p !== 2 && p !== 30 ? [[2, p] as const, [30, p] as const] : []),
])
const BRACE_L = 'M13 8.8C11 8.8 10.4 9.8 10.4 11.8V13.7C10.4 15.2 9.8 16 8.2 16C9.8 16 10.4 16.8 10.4 18.3V20.2C10.4 22.2 11 23.2 13 23.2'
const BRACE_R = 'M19 8.8C21 8.8 21.6 9.8 21.6 11.8V13.7C21.6 15.2 22.2 16 23.8 16C22.2 16 21.6 16.8 21.6 18.3V20.2C21.6 22.2 21 23.2 19 23.2'

/**
 * El logo: un sello naranja con llaves.
 * `punch` 0→1 troquela el borde, `braces` 0→1 dibuja las llaves, `spread` las separa
 * y `corner` (radio, en unidades del lienzo) permite que empiece siendo un cuadrado liso.
 */
export const Stamp: React.FC<{ size: number; punch?: number; braces?: number; spread?: number; id?: string; glow?: number }> = ({
  size,
  punch = 1,
  braces = 1,
  spread = 0,
  id = 'stamp',
  glow = 0,
}) => (
  <svg width={size} height={size} viewBox="0 0 32 32" style={{ overflow: 'visible', filter: glow ? `drop-shadow(0 0 ${glow}px rgba(249,115,22,0.6))` : undefined }}>
    <mask id={id}>
      <rect x="-1" y="-1" width="34" height="34" fill="#fff" />
      {NOTCHES.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.8 * punch} fill="#000" />
      ))}
    </mask>
    <rect x="2" y="2" width="28" height="28" fill={C.brand600} mask={`url(#${id})`} />
    <g fill="none" stroke="#fff" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
      {/* Sin trazo no se pinta nada: si no, los extremos redondeados asoman como dos puntos */}
      {braces > 0.02 && (
        <>
          <path d={BRACE_L} pathLength={1} strokeDasharray="1" strokeDashoffset={1 - braces} transform={`translate(${-spread * 6} 0)`} />
          <path d={BRACE_R} pathLength={1} strokeDasharray="1" strokeDashoffset={1 - braces} transform={`translate(${spread * 6} 0)`} />
        </>
      )}
    </g>
  </svg>
)

/** Captura de la app en el mundo de la cámara: esquinas redondeadas, sombra y borde. */
export const Shot: React.FC<{ src: string; w: number; style?: React.CSSProperties; dim?: number }> = ({ src, w, style, dim = 0 }) => (
  <div
    style={{
      position: 'absolute',
      width: w,
      borderRadius: 18,
      overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.14)',
      boxShadow: '0 60px 140px -30px rgba(0,0,0,0.9), 0 0 120px -30px rgba(249,115,22,0.35)',
      ...style,
    }}
  >
    <Img src={src} style={{ display: 'block', width: '100%' }} />
    {dim > 0 && <div style={{ position: 'absolute', inset: 0, background: `rgba(12,12,14,${dim})` }} />}
  </div>
)
