import { loadFont } from '@remotion/google-fonts/Inter'
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono'
import type React from 'react'
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'

export const inter = loadFont('normal', { weights: ['400', '500', '600', '700', '800'], subsets: ['latin'] }).fontFamily
export const mono = loadMono('normal', { weights: ['400', '500', '700'], subsets: ['latin'] }).fontFamily

export const C = {
  bg: '#0c0c0e',
  ink900: '#141416',
  ink800: '#1f1f23',
  brand: '#f97316',
  brand600: '#ea580c',
  brand300: '#fdba74',
  text: '#fafafa',
  muted: '#a1a1aa',
  green: '#22c55e',
  line: 'rgba(255,255,255,0.07)',
}

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** Muelle 0→1 que arranca en `delay` (fotogramas relativos a la escena). */
export function useIn(delay = 0, damping = 200, durationInFrames?: number) {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ frame: f - delay, fps, config: { damping }, durationInFrames })
}

export function lerp(f: number, a: number, b: number, from: number, to: number, ease = Easing.out(Easing.cubic)) {
  return interpolate(f, [a, b], [from, to], { ...clamp, easing: ease })
}

/** Fondo continuo: rejilla que se desliza y un halo naranja que deriva. */
export const Background: React.FC = () => {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(to right, ${C.line} 1px, transparent 1px), linear-gradient(to bottom, ${C.line} 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
          backgroundPosition: `${f * 0.25}px ${f * 0.5}px`,
          maskImage: 'radial-gradient(ellipse 75% 65% at 50% 40%, #000 25%, transparent 100%)',
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(1000px circle at ${50 + Math.sin(f / 80) * 18}% ${-8 + Math.cos(f / 110) * 10}%, rgba(249,115,22,0.30), transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(700px circle at ${80 + Math.cos(f / 95) * 10}% ${110 + Math.sin(f / 70) * 6}%, rgba(234,88,12,0.14), transparent 70%)`,
        }}
      />
    </AbsoluteFill>
  )
}

/** Envoltorio de escena: sale con fundido, leve zoom y desenfoque. */
export const Scene: React.FC<{ children: React.ReactNode; out?: number }> = ({ children, out = 12 }) => {
  const f = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const o = interpolate(f, [durationInFrames - out, durationInFrames], [1, 0], clamp)
  return (
    <AbsoluteFill style={{ opacity: o, transform: `scale(${1.04 - o * 0.04})`, filter: `blur(${(1 - o) * 12}px)`, fontFamily: inter, color: C.text }}>
      {children}
    </AbsoluteFill>
  )
}

export const Logo: React.FC<{ size?: number; draw?: number }> = ({ size = 64, draw = 1 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32">
    <defs>
      <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fb923c" />
        <stop offset="1" stopColor="#ea580c" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="8" fill="url(#lg)" />
    <path d="M7 11.5 16 17l9-5.5V22a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 7 22z" fill="#fff" opacity={draw} transform={`translate(0 ${(1 - draw) * 4})`} />
    <path d="M7.5 9.5h17L16 15z" fill="#fff" opacity={0.85 * draw} transform={`translate(0 ${(1 - draw) * -4})`} />
  </svg>
)

/** Titular que entra palabra a palabra. Las palabras de `hl` van en naranja; `code` en monoespaciada. */
export const Words: React.FC<{
  text: string
  delay?: number
  stagger?: number
  size?: number
  weight?: number
  color?: string
  hl?: string[]
  code?: string[]
  style?: React.CSSProperties
}> = ({ text, delay = 0, stagger = 4, size = 84, weight = 800, color = C.text, hl = [], code = [], style }) => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (
    <div style={{ fontSize: size, fontWeight: weight, lineHeight: 1.06, letterSpacing: '-0.035em', color, ...style }}>
      {text.split(' ').map((w, i) => {
        const s = spring({ frame: f - delay - i * stagger, fps, config: { damping: 18, mass: 0.6 } })
        const bare = w.replace(/[.,!?]$/, '')
        const isHl = hl.includes(bare)
        const isCode = code.includes(bare)
        return (
          <span
            key={`${w}-${i}`}
            style={{
              display: 'inline-block',
              marginRight: '0.24em',
              opacity: Math.min(1, s * 1.4),
              transform: `translateY(${(1 - s) * 0.5}em)`,
              filter: `blur(${Math.max(0, 1 - s) * 10}px)`,
              ...(isHl ? { background: 'linear-gradient(90deg,#fdba74,#f97316 60%,#ea580c)', WebkitBackgroundClip: 'text', color: 'transparent' } : {}),
              ...(isCode ? { fontFamily: mono, color: C.brand, letterSpacing: '-0.02em', fontWeight: 700 } : {}),
            }}
          >
            {w}
          </span>
        )
      })}
    </div>
  )
}

export const Kicker: React.FC<{ children: React.ReactNode; delay?: number; style?: React.CSSProperties }> = ({ children, delay = 0, style }) => {
  const s = useIn(delay)
  return (
    <div
      style={{
        fontFamily: mono,
        fontSize: 22,
        fontWeight: 700,
        letterSpacing: '0.22em',
        color: C.brand,
        opacity: s,
        transform: `translateX(${(1 - s) * -30}px)`,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        marginBottom: 22,
        ...style,
      }}
    >
      <span style={{ width: 36 * s, height: 2, background: C.brand, display: 'inline-block' }} />
      {children}
    </div>
  )
}

export const Fade: React.FC<{ children: React.ReactNode; delay?: number; y?: number; style?: React.CSSProperties }> = ({ children, delay = 0, y = 24, style }) => {
  const s = useIn(delay)
  return <div style={{ opacity: s, transform: `translateY(${(1 - s) * y}px)`, ...style }}>{children}</div>
}

/** Ventana de navegador con una captura real de la app. */
export const Browser: React.FC<{ src: string; width: number; url?: string; style?: React.CSSProperties; imgStyle?: React.CSSProperties }> = ({
  src,
  width,
  url = 'cartero.local',
  style,
  imgStyle,
}) => (
  <div
    style={{
      width,
      borderRadius: 16,
      overflow: 'hidden',
      background: C.ink900,
      border: '1px solid rgba(255,255,255,0.13)',
      boxShadow: '0 50px 120px -30px rgba(0,0,0,0.85), 0 0 90px -20px rgba(249,115,22,0.35)',
      ...style,
    }}
  >
    <div style={{ height: 42, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', background: '#18181b', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
      {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
        <span key={c} style={{ width: 12, height: 12, borderRadius: 99, background: c }} />
      ))}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', marginRight: 60 }}>
        <div style={{ fontFamily: mono, fontSize: 14, color: C.muted, background: C.bg, padding: '5px 18px', borderRadius: 7 }}>{url}</div>
      </div>
    </div>
    <div style={{ overflow: 'hidden' }}>
      <Img src={staticFile(`shots/${src}.png`)} style={{ display: 'block', width: '100%', ...imgStyle }} />
    </div>
  </div>
)

export const Chip: React.FC<{ children: React.ReactNode; color?: string; delay?: number; size?: number; style?: React.CSSProperties }> = ({
  children,
  color = C.brand,
  delay = 0,
  size = 28,
  style,
}) => {
  const s = useIn(delay, 14)
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        padding: `${size * 0.45}px ${size * 0.85}px`,
        borderRadius: 999,
        background: 'rgba(24,24,27,0.85)',
        border: '1px solid rgba(255,255,255,0.14)',
        color: C.text,
        fontSize: size,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        opacity: Math.min(1, s * 1.5),
        transform: `scale(${0.6 + s * 0.4}) translateY(${(1 - s) * 20}px)`,
        boxShadow: '0 12px 30px -10px rgba(0,0,0,0.6)',
        ...style,
      }}
    >
      <span style={{ width: size * 0.4, height: size * 0.4, borderRadius: 99, background: color, boxShadow: `0 0 14px ${color}` }} />
      {children}
    </div>
  )
}

/** Texto que se escribe solo, con cursor parpadeante mientras escribe. */
export const Type: React.FC<{ text: string; delay?: number; cps?: number; caret?: boolean }> = ({ text, delay = 0, cps = 28, caret = true }) => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const n = Math.max(0, Math.min(text.length, Math.floor(((f - delay) / fps) * cps)))
  const typing = f >= delay && n < text.length
  const show = caret && f >= delay && (typing || Math.floor(f / 15) % 2 === 0)
  return (
    <span>
      {text.slice(0, n)}
      {show && <span style={{ display: 'inline-block', width: '0.55em', height: '1.05em', background: C.brand, verticalAlign: 'text-bottom', marginLeft: 2 }} />}
    </span>
  )
}

/** Fotograma en que termina de escribirse un texto de `Type`. */
export const typedAt = (text: string, delay: number, cps = 28, fps = 30) => delay + Math.ceil((text.length / cps) * fps)

export const Terminal: React.FC<{ children: React.ReactNode; width?: number; title?: string; style?: React.CSSProperties }> = ({
  children,
  width = 760,
  title = 'bash',
  style,
}) => (
  <div
    style={{
      width,
      borderRadius: 14,
      overflow: 'hidden',
      background: 'rgba(12,12,14,0.92)',
      border: '1px solid rgba(255,255,255,0.13)',
      boxShadow: '0 30px 80px -20px rgba(0,0,0,0.8)',
      fontFamily: mono,
      ...style,
    }}
  >
    <div style={{ height: 36, display: 'flex', alignItems: 'center', gap: 7, padding: '0 14px', background: '#18181b', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
      {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
        <span key={c} style={{ width: 10, height: 10, borderRadius: 99, background: c }} />
      ))}
      <span style={{ flex: 1, textAlign: 'center', fontSize: 13, color: C.muted, marginRight: 40 }}>{title}</span>
    </div>
    <div style={{ padding: '22px 26px', fontSize: 24, lineHeight: 1.65, color: C.text }}>{children}</div>
  </div>
)

export const Prompt: React.FC = () => <span style={{ color: C.brand, marginRight: 14 }}>$</span>
