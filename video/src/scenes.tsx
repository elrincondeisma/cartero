/**
 * Escenas del vídeo. Cada una termina transformando un objeto en el primero de la siguiente
 * (la raya del tachado → el sello → la ventana → la barra de la URL…), los textos se revelan
 * bajo máscara, la cámara sigue lo importante y las entradas caen en los golpes (cada 15 fps).
 */
import type React from 'react'
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { useLang, useT } from './i18n'
import { Browser, C, Chip, Kicker, Prompt, Scene, Terminal, Type, inter, mono, typedAt, useIn } from './kit'
import { BEAT, Camera, type CamKey, Mask, MaskBlock, Shot, Stamp, beat, bump, camAt, easeIn, easeInOut, easeOut, prog, shake, toScreen } from './motion'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const useShot = () => {
  const lang = useLang()
  return (name: string) => staticFile(`shots/${lang}/${name}.png`)
}

/** Degradado a la izquierda para que el texto se lea encima de una captura. */
const LeftShade: React.FC<{ opacity?: number }> = ({ opacity = 1 }) => (
  <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(12,12,14,0.96) 0%, rgba(12,12,14,0.9) 32%, rgba(12,12,14,0) 52%)', opacity }} />
)

/** Cursor con clic (onda) en coordenadas de pantalla. */
const Pointer: React.FC<{ x: number; y: number; clickAt: number; opacity?: number }> = ({ x, y, clickAt, opacity = 1 }) => {
  const f = useCurrentFrame()
  const ring = prog(f, clickAt, clickAt + 14)
  const press = bump(f, clickAt, -0.18, 8)
  return (
    <div style={{ position: 'absolute', left: x, top: y, opacity }}>
      {f >= clickAt && (
        <div
          style={{
            position: 'absolute',
            left: -40,
            top: -40,
            width: 80,
            height: 80,
            borderRadius: 99,
            border: `3px solid ${C.brand300}`,
            opacity: 1 - ring,
            transform: `scale(${0.3 + ring * 1.2})`,
          }}
        />
      )}
      <svg width="44" height="44" viewBox="0 0 24 24" style={{ transform: `scale(${press})`, transformOrigin: '4px 2px', filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.6))' }}>
        <path d="M4 2l16 9-7 2-3 7z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/** Anillo de énfasis en un punto de la pantalla (algo importante acaba de pasar ahí). */
const Ping: React.FC<{ x: number; y: number; at: number; color: string; r?: number }> = ({ x, y, at, color, r = 70 }) => {
  const f = useCurrentFrame()
  const p = prog(f, at, at + 20)
  if (f < at || p >= 1) return null
  return (
    <div
      style={{
        position: 'absolute',
        left: x - r,
        top: y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: 999,
        border: `4px solid ${color}`,
        boxShadow: `0 0 40px ${color}`,
        opacity: 1 - p,
        transform: `scale(${0.4 + p * 1.1})`,
      }}
    />
  )
}

/* ───────────── 1 · Gancho (0–4 s): una palabra por golpe; la raya del tachado se vuelve el sello ───────────── */
export const Hook: React.FC = () => {
  const f = useCurrentFrame()
  const t = useT()
  const words = t.hook1.split(' ')
  const strike = prog(f, beat(6), beat(6) + 9)
  const morph = prog(f, beat(7), beat(8), easeInOut)
  const out = beat(7)
  return (
    <Scene>
      <AbsoluteFill style={{ alignItems: 'center' }}>
        <div style={{ position: 'absolute', top: 250, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 26 }}>
          {words.map((w, i) => (
            <div key={w} style={{ transform: `scale(${bump(f, beat(i) + 6, 0.1)})` }}>
              <Mask text={w} at={beat(i) + 1} size={100} outAt={out} />
            </div>
          ))}
        </div>
        <div style={{ position: 'absolute', top: 455, width: '100%' }}>
          <Mask text={t.hook2} at={beat(4)} size={58} weight={600} color={C.muted} align="center" stagger={2} outAt={out} />
        </div>
        <div style={{ position: 'absolute', top: 590, width: '100%', textAlign: 'center' }}>
          <span style={{ position: 'relative', display: 'inline-block', transform: `scale(${bump(f, beat(5) + 6, 0.12)}) translateX(${shake(f, beat(6) + 2, 8)}px)` }}>
            <Mask text={`${t.paywall}.`} at={beat(5)} size={140} outAt={out} color={strike > 0.5 ? '#71717a' : C.text} />
            {/* La raya: tacha la palabra y luego se encoge hasta ser el cuadrado del sello */}
            <span
              style={{
                position: 'absolute',
                left: `calc(-6px * ${1 - morph} + 50% * ${morph})`,
                top: `calc(52% - ${136 * morph}px)`,
                width: `calc((100% + 12px) * ${strike * (1 - morph)} + ${150 * morph}px)`,
                height: 9 + morph * 141,
                transform: `translate(${-50 * morph}%, -50%)`,
                borderRadius: 5 + morph * 4,
                background: morph > 0 ? C.brand600 : C.brand,
                boxShadow: `0 0 ${24 * (1 - morph)}px ${C.brand}`,
              }}
            />
          </span>
        </div>
      </AbsoluteFill>
    </Scene>
  )
}

/* ───────────── 2 · El sello (4–8 s): se troquela en el golpe; la cámara se mete dentro ───────────── */
export const Reveal: React.FC = () => {
  const f = useCurrentFrame()
  const t = useT()
  const punch = prog(f, 0, 8)
  const braces = prog(f, 3, 18)
  const slide = prog(f, beat(1), beat(2), easeInOut)
  const sx = mix(960, 640, slide)
  const ring = prog(f, 0, 26)
  // Al final, la cámara entra en el sello hasta que todo es naranja
  const dive = prog(f, beat(6), beat(8) - 4, easeIn)
  const z = Math.exp(Math.log(160) * dive)
  const size = 171
  // Punto del sello sin llaves ni troqueles (debajo de las llaves): al acercarse todo es naranja
  const diveY = 540 + (10.4 * size) / 32
  return (
    <Scene>
      <AbsoluteFill style={{ transformOrigin: `${sx}px ${diveY}px`, transform: `scale(${z})` }}>
        <div
          style={{
            position: 'absolute',
            left: sx - 120,
            top: 420,
            width: 240,
            height: 240,
            borderRadius: 40,
            border: `4px solid ${C.brand}`,
            opacity: (1 - ring) * 0.9,
            transform: `scale(${0.7 + ring * 1.3})`,
          }}
        />
        <div style={{ position: 'absolute', left: sx - size / 2, top: 540 - size / 2, transform: `scale(${bump(f, 0, 0.16, 14)})` }}>
          <Stamp size={size} punch={punch} braces={braces} id="reveal" glow={40 * (1 - dive)} />
        </div>
        <div style={{ position: 'absolute', left: sx + 120, top: 540 - 118 }}>
          <Mask text="Cartero" at={beat(1) + 2} size={200} dur={20} outAt={beat(6) - 4} />
        </div>
        <div style={{ position: 'absolute', top: 730, width: '100%', textAlign: 'center', fontSize: 50, fontWeight: 500, color: C.muted, letterSpacing: '-0.02em' }}>
          <MaskBlock at={beat(2) + 4} outAt={beat(6) - 8}>
            {t.tagPre}
            <span style={{ color: C.text, fontWeight: 700 }}>{t.tagHl}</span>
            {t.tagPost}
          </MaskBlock>
        </div>
      </AbsoluteFill>
      {/* Ya dentro del sello: naranja entero para el corte */}
      <AbsoluteFill style={{ background: C.brand600, opacity: prog(f, beat(8) - 6, beat(8) - 3) }} />
    </Scene>
  )
}

/* ───────────── 3 · Importar: el naranja se encoge hasta ser la ventana; los formatos entran volando ───────────── */
const IMPORT_WIN = { x: 930, y: 205, w: 940, h: 42 + 940 / 1.641 }
export const Import: React.FC = () => {
  const f = useCurrentFrame()
  const t = useT()
  const m = prog(f, 0, 18, easeInOut)
  const formats: [string, string][] = [
    ['Postman', '#ff6c37'],
    ['OpenAPI', '#6ba539'],
    ['cURL', '#38bdf8'],
    ['Insomnia', '#a855f7'],
  ]
  const fly = (i: number) => prog(f, beat(7) + i * 4, beat(7) + i * 4 + 14, easeInOut)
  const arrivals = formats.map((_, i) => beat(7) + i * 4 + 14)
  const winBump = arrivals.reduce((acc, a) => acc * bump(f, a, 0.025, 10), 1)
  const toastIn = useIn(beat(8) + 8, 14)
  // El aviso se estira hasta ser la barra de la URL de la escena siguiente
  const tm = prog(f, 150, 176, easeInOut)
  const exit = prog(f, 150, 166, easeIn)
  const rect = {
    x: mix(0, IMPORT_WIN.x, m),
    y: mix(0, IMPORT_WIN.y, m),
    w: mix(1920, IMPORT_WIN.w, m),
    h: mix(1080, IMPORT_WIN.h, m),
  }
  const chipX = (i: number) => 120 + [0, 190, 380, 540][i]
  return (
    <Scene>
      <div style={{ position: 'absolute', left: 120, top: 250, width: 760 }}>
        <MaskBlock at={beat(1) - 4} outAt={150}>
          <Kicker delay={beat(1) - 4}>{t.importK}</Kicker>
        </MaskBlock>
        <Mask text={t.importH} size={92} hl={t.importHl} at={beat(1)} outAt={150} />
        <MaskBlock at={beat(2)} outAt={152} style={{ marginTop: 26 }}>
          <div style={{ fontSize: 31, lineHeight: 1.45, color: C.muted, width: 680 }}>{t.importSub}</div>
        </MaskBlock>
      </div>
      {/* Ventana: aparece dentro del naranja que se encoge */}
      <div
        style={{
          position: 'absolute',
          left: IMPORT_WIN.x,
          top: IMPORT_WIN.y,
          opacity: interpolate(m, [0.55, 1], [0, 1], clamp) * (1 - exit),
          transform: `scale(${winBump * (1 - exit * 0.06)})`,
          transformOrigin: 'center',
        }}
      >
        <Browser src="import" width={IMPORT_WIN.w} url="cartero.local/import" />
      </div>
      {m < 1 && (
        <div
          style={{
            position: 'absolute',
            left: rect.x,
            top: rect.y,
            width: rect.w,
            height: rect.h,
            borderRadius: 16 * m,
            background: C.brand600,
            opacity: interpolate(m, [0.6, 1], [1, 0], clamp),
          }}
        />
      )}
      {/* Formatos: entran en el golpe y vuelan a la ventana encadenados */}
      {formats.map(([name, color], i) => {
        const p = fly(i)
        const x0 = chipX(i)
        const y0 = 760
        const x1 = 1360
        const y1 = 480
        const x = mix(x0, x1, p)
        const y = mix(y0, y1, p) - Math.sin(p * Math.PI) * 160
        return (
          <div key={name} style={{ position: 'absolute', left: x, top: y, transform: `scale(${(1 - p * 0.7) * bump(f, beat(3 + i), 0.12)})`, opacity: p > 0.92 ? 0 : 1 }}>
            <Chip color={color} delay={beat(3 + i)} size={25}>
              {name}
            </Chip>
          </div>
        )
      })}
      {/* Aviso → barra de la URL */}
      <div
        style={{
          position: 'absolute',
          left: mix(1240, 960 - 750, tm),
          top: mix(830, 540 - 42, tm),
          width: mix(640, 1500, tm),
          height: mix(66, 84, tm),
          opacity: toastIn,
          transform: `translateY(${(1 - toastIn) * 30}px) scale(${(0.9 + toastIn * 0.1) * bump(f, beat(8) + 14, 0.06)})`,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '0 26px',
          borderRadius: mix(14, 12, tm),
          background: '#18181b',
          border: `1px solid ${tm > 0.5 ? 'rgba(255,255,255,0.14)' : 'rgba(34,197,94,0.4)'}`,
          boxShadow: '0 20px 50px -10px rgba(0,0,0,0.7)',
          fontSize: 26,
          fontWeight: 600,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ position: 'absolute', left: 26, opacity: 1 - prog(f, 150, 158), display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ color: C.green, fontSize: 30 }}>✓</span> {t.importToast}
        </span>
        <span style={{ position: 'absolute', left: 26, opacity: prog(f, 162, 176), fontFamily: mono, fontSize: 30, display: 'flex', gap: 26 }}>
          <span style={{ color: C.green, fontWeight: 700 }}>GET</span>
          <span>
            <span style={{ color: C.brand }}>{'{{baseUrl}}'}</span>/users/:userId
          </span>
        </span>
      </div>
    </Scene>
  )
}

/* ───────────── 4 · Petición: la cámara sigue el clic en Enviar y baja hasta el 200 OK ───────────── */
const REQ_W = 2500
const REQ_H = REQ_W / 1.6
const REQ_KEYS: CamKey[] = [
  [0, 1459, 265, 0.889],
  [18, 1459, 265, 0.95],
  [34, 2397, 255, 1.7],
  [50, 2397, 255, 1.7],
  [72, 2175, 906, 1.8],
  [88, 2175, 906, 1.85],
  [112, 478, 781, 0.46],
  [150, 478, 781, 0.46],
  [178, 1475, 334, 3],
]
export const Request: React.FC = () => {
  const f = useCurrentFrame()
  const t = useT()
  const shot = useShot()
  const cam = camAt(f, REQ_KEYS)
  const [sendX, sendY] = toScreen(cam, 2397, 255)
  const [okX, okY] = toScreen(cam, 2175, 906)
  const auths = ['Bearer', 'OAuth 2.0', 'AWS SigV4', 'Digest', 'API Key']
  const pointer = prog(f, 20, 38, easeInOut)
  const textOut = 146
  return (
    <Scene>
      <Camera keys={REQ_KEYS}>
        <Shot src={shot('request-dark')} w={REQ_W} />
      </Camera>
      {/* La barra que llega de la escena anterior se funde con la de la captura */}
      <div
        style={{
          position: 'absolute',
          left: 210,
          top: 498,
          width: 1500,
          height: 84,
          borderRadius: 12,
          background: '#18181b',
          border: '1px solid rgba(255,255,255,0.14)',
          opacity: 1 - prog(f, 0, 10),
          display: 'flex',
          alignItems: 'center',
          gap: 26,
          padding: '0 26px',
          fontFamily: mono,
          fontSize: 30,
          fontWeight: 600,
        }}
      >
        <span style={{ color: C.green, fontWeight: 700 }}>GET</span>
        <span>
          <span style={{ color: C.brand }}>{'{{baseUrl}}'}</span>/users/:userId
        </span>
      </div>
      {f < 60 && <Pointer x={mix(1300, sendX - 10, pointer)} y={mix(760, sendY - 4, pointer)} clickAt={40} opacity={1 - prog(f, 50, 58)} />}
      <Ping x={okX} y={okY} at={beat(5)} color={C.green} r={90} />
      <LeftShade opacity={prog(f, 96, 112) * (1 - prog(f, 150, 166))} />
      <div style={{ position: 'absolute', left: 110, top: 220, width: 600 }}>
        <MaskBlock at={96} outAt={textOut}>
          <Kicker delay={96}>{t.reqK}</Kicker>
        </MaskBlock>
        <Mask text={t.reqH} size={76} at={98} hl={t.reqHl} outAt={textOut} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start', marginTop: 36 }}>
          {auths.map((a, i) => (
            <div key={a} style={{ opacity: 1 - prog(f, textOut + i * 2, textOut + i * 2 + 8), transform: `scale(${bump(f, 112 + i * 6 + 4, 0.1)})` }}>
              <Chip delay={112 + i * 6} size={24} color={C.brand}>
                {a}
              </Chip>
            </div>
          ))}
        </div>
      </div>
    </Scene>
  )
}

/* ───────────── 5 · Contratos: «cumple» en verde; la API cambia en el golpe y la cámara sigue los fallos ───────────── */
const CT_W = 2200
const CT_KEYS: CamKey[] = [
  [0, 1197, 349, 3],
  [22, 400, 863, 0.5],
  [44, 400, 863, 0.52],
  [60, 1505, 992, 1.35],
  [92, 1505, 992, 1.4],
  [100, 1531, 992, 1.4],
  [122, 440, 1191, 1.45],
  [150, 440, 1191, 1.5],
  [178, 66, 1153, 9],
]
export const Contracts: React.FC = () => {
  const f = useCurrentFrame()
  const t = useT()
  const shot = useShot()
  const cam = camAt(f, CT_KEYS)
  const broken = f >= beat(6)
  const flash = 1 - prog(f, beat(6), beat(6) + 8)
  const [bx, by] = toScreen(cam, broken ? 1531 : 1505, 992)
  const [lx, ly] = toScreen(cam, 440, 1191)
  const sh = shake(f, beat(6), 14)
  return (
    <Scene>
      <div style={{ position: 'absolute', inset: 0, transform: `translateX(${sh}px)` }}>
        <Camera keys={CT_KEYS}>
          <Shot src={shot(broken ? 'contract-fail' : 'contract')} w={CT_W} />
        </Camera>
      </div>
      {broken && flash > 0 && <AbsoluteFill style={{ background: `rgba(239,68,68,${0.28 * flash})` }} />}
      <Ping x={bx} y={by} at={beat(4) + 2} color={C.green} r={110} />
      <Ping x={bx} y={by} at={beat(6) + 4} color="#ef4444" r={110} />
      {/* Chips que acompañan a la cámara */}
      <div style={{ position: 'absolute', left: bx - 280, top: by + 80, opacity: 1 - prog(f, beat(6) - 6, beat(6)) }}>
        <Chip color={C.green} delay={beat(4) + 6} size={36}>
          {t.contractChecked}
        </Chip>
      </div>
      <div style={{ position: 'absolute', left: bx - 280, top: by + 80, opacity: 1 - prog(f, 112, 120) }}>
        <Chip color="#ef4444" delay={beat(6) - 2} size={36}>
          {t.contractChange}
        </Chip>
      </div>
      <div style={{ position: 'absolute', left: lx - 60, top: ly + 150, opacity: 1 - prog(f, 150, 160) }}>
        <Chip color={C.brand} delay={124} size={36}>
          {t.contractCaught}
        </Chip>
      </div>
      <LeftShade opacity={prog(f, 12, 26) * (1 - prog(f, 44, 56))} />
      <div style={{ position: 'absolute', left: 110, top: 260, width: 620 }}>
        <MaskBlock at={beat(1)} outAt={40}>
          <Kicker delay={beat(1)}>{t.contractK}</Kicker>
        </MaskBlock>
        <Mask text={t.contractH} size={84} at={beat(1) + 2} hl={t.contractHl} outAt={38} />
        <MaskBlock at={beat(2)} outAt={42} style={{ marginTop: 24 }}>
          <div style={{ fontSize: 30, lineHeight: 1.45, color: C.muted }}>{t.contractSub}</div>
        </MaskBlock>
      </div>
    </Scene>
  )
}

/* ───────────── 6 · Tests y runner: la ✗ gira a ✓ y se vuelve terminal; el contador sube a ritmo ───────────── */
const TERM = { x: 120, y: 330, w: 780, h: 330 }
const DESK_W = 1600
const DESK_H = DESK_W / 1.5814
const DESK_Z = 0.725
const DESK_RECT = { x: 700, y: 540 - (DESK_H * DESK_Z) / 2, w: DESK_W * DESK_Z, h: DESK_H * DESK_Z }
export const TestsRunner: React.FC = () => {
  const f = useCurrentFrame()
  const t = useT()
  const { fps } = useVideoConfig()
  const flip = prog(f, 0, 12, easeInOut)
  const m = prog(f, 12, 30, easeInOut)
  const toDesk = prog(f, 154, 179, easeInOut)
  const lines = [`pm.test('${t.testName}', () => {`, '  pm.response.to.have.status(200)', '})']
  const starts = [32, 0, 0]
  for (let i = 1; i < lines.length; i++) starts[i] = typedAt(lines[i - 1], starts[i - 1], 52, fps) + 2
  const n = Math.max(0, Math.min(10, Math.floor((f - beat(5)) / (BEAT / 2)) + 1))
  const tenAt = beat(5) + 9 * (BEAT / 2)
  const cmd = 'cartero run blog.json -r junit'
  // La caja: círculo (la ✗/✓) → terminal → ventana de la app de escritorio
  const circle = { x: 960 - 160, y: 540 - 160, w: 320, h: 320 }
  const box = {
    x: mix(mix(circle.x, TERM.x, m), DESK_RECT.x, toDesk),
    y: mix(mix(circle.y, TERM.y, m), DESK_RECT.y, toDesk),
    w: mix(mix(circle.w, TERM.w, m), DESK_RECT.w, toDesk),
    h: mix(mix(circle.h, TERM.h, m), DESK_RECT.h, toDesk),
  }
  const green = flip > 0.5
  const iconOpacity = 1 - prog(f, 14, 24)
  const content = prog(f, 26, 34) * (1 - prog(f, 150, 156))
  return (
    <Scene>
      <div
        style={{
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          borderRadius: mix(mix(160, 14, m), 16, toDesk),
          background: m > 0.6 ? '#0f0f11' : green ? C.green : '#ef4444',
          border: m > 0.6 ? '1px solid rgba(255,255,255,0.13)' : 'none',
          boxShadow: m > 0.6 ? '0 30px 80px -20px rgba(0,0,0,0.8)' : `0 0 80px ${green ? C.green : '#ef4444'}`,
          transform: `rotateY(${flip < 0.5 ? flip * 180 : (1 - flip) * 180}deg) scale(${bump(f, 12, 0.08)})`,
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: iconOpacity, color: '#fff', fontSize: 200, fontWeight: 800 }}>
          {green ? '✓' : '✕'}
        </div>
        <div style={{ opacity: content, fontFamily: mono }}>
          <div style={{ height: 36, display: 'flex', alignItems: 'center', gap: 7, padding: '0 14px', background: '#18181b', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
              <span key={c} style={{ width: 10, height: 10, borderRadius: 99, background: c }} />
            ))}
            <span style={{ flex: 1, textAlign: 'center', fontSize: 13, color: C.muted, marginRight: 40 }}>post-response.js</span>
          </div>
          <div style={{ padding: '22px 26px', fontSize: 24, lineHeight: 1.65 }}>
            {lines.map((l, i) => (
              <div key={l} style={{ whiteSpace: 'pre', minHeight: 40 }}>
                <Type text={l} delay={starts[i]} cps={52} caret={i === 2} />
              </div>
            ))}
            <div style={{ marginTop: 14, color: C.green, transform: `scale(${bump(f, beat(4) + 6, 0.1)})`, transformOrigin: 'left center' }}>
              <MaskBlock at={beat(4) + 2}>
                ✓ {t.testName} · {t.testPass}
              </MaskBlock>
            </div>
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 1010, top: 210, width: 820 }}>
        <MaskBlock at={beat(2)} outAt={148}>
          <Kicker delay={beat(2)}>{t.runnerK}</Kicker>
        </MaskBlock>
        <Mask text={t.runnerH1} size={86} at={beat(2) + 2} hl={t.runnerHl} outAt={148} />
        <Mask text={t.runnerH2} size={86} at={beat(3)} outAt={150} />
        <MaskBlock at={beat(5) - 6} outAt={154} style={{ marginTop: 30 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 22 }}>
            <span
              style={{
                fontSize: 170,
                fontWeight: 800,
                letterSpacing: '-0.05em',
                color: n === 10 ? C.green : C.text,
                display: 'inline-block',
                fontVariantNumeric: 'tabular-nums',
                transform: `scale(${bump(f, tenAt, 0.14, 14) * (n < 10 ? bump(f, beat(5) + (n - 1) * (BEAT / 2), 0.04, 6) : 1)})`,
                transformOrigin: 'left bottom',
                textShadow: n === 10 ? `0 0 ${40 * (1 - prog(f, tenAt, tenAt + 20))}px ${C.green}` : 'none',
              }}
            >
              {n}/10
            </span>
            <span style={{ fontSize: 36, color: C.muted, fontWeight: 600 }}>{t.testsPassed}</span>
          </div>
        </MaskBlock>
        <MaskBlock at={124} outAt={152} style={{ marginTop: 20 }}>
          <div style={{ fontSize: 26, color: C.muted, marginBottom: 12, fontWeight: 500 }}>{t.sameCi}</div>
          <Terminal width={700}>
            <Prompt />
            <Type text={cmd} delay={128} cps={40} />
          </Terminal>
        </MaskBlock>
      </div>
    </Scene>
  )
}

/* ───────────── 7 · App de escritorio (en el respiro de la música): la cámara sigue hasta el mock local ───────────── */
const DESK_KEYS: CamKey[] = [
  [0, 359, 506, DESK_Z],
  [66, 390, 500, 0.78],
  [92, 320, 144, 2.6],
  [104, 320, 144, 2.75],
]
export const Desktop: React.FC = () => {
  const f = useCurrentFrame()
  const t = useT()
  const shot = useShot()
  const cam = camAt(f, DESK_KEYS)
  const [px, py] = toScreen(cam, 352, 144)
  const reveal = prog(f, 0, 12)
  // El icono verde del mock crece hasta llenar la pantalla: la escena siguiente sale de ahí
  const grow = prog(f, 100, 120, easeIn)
  return (
    <Scene>
      {/* La caja que llega de la terminal; la captura aparece dentro */}
      <div style={{ position: 'absolute', left: DESK_RECT.x, top: DESK_RECT.y, width: DESK_RECT.w, height: DESK_RECT.h, borderRadius: 16, background: '#0f0f11', border: '1px solid rgba(255,255,255,0.13)', opacity: 1 - prog(f, 6, 14) }} />
      <Camera keys={DESK_KEYS}>
        <div style={{ opacity: reveal }}>
          <Shot src={shot('desktop')} w={DESK_W} />
        </div>
      </Camera>
      <LeftShade opacity={prog(f, 4, 16) * (1 - prog(f, 70, 84))} />
      <div style={{ position: 'absolute', left: 110, top: 300, width: 560 }}>
        <MaskBlock at={6} outAt={70}>
          <Kicker delay={6}>{t.desktopK}</Kicker>
        </MaskBlock>
        <Mask text={t.desktopH} size={96} at={8} hl={t.desktopHl} outAt={68} dur={22} />
        <MaskBlock at={24} outAt={72} dur={24} style={{ marginTop: 26 }}>
          <div style={{ fontSize: 30, lineHeight: 1.45, color: C.muted }}>{t.desktopSub}</div>
        </MaskBlock>
      </div>
      <div style={{ position: 'absolute', left: px + 90, top: py + 70, opacity: 1 - prog(f, 98, 104) }}>
        <Chip color={C.green} delay={beat(5) + 4} size={36}>
          {t.desktopMock}
        </Chip>
      </div>
      <Ping x={px} y={py} at={beat(6)} color={C.green} r={80} />
      {grow > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 960 - 1200 * grow,
            top: 540 - 1200 * grow,
            width: 2400 * grow,
            height: 2400 * grow,
            borderRadius: 9999,
            background: C.green,
          }}
        />
      )}
    </Scene>
  )
}

/* ───────────── 8 · Mocks y monitores (vuelve la música): las ventanas entran de golpe ───────────── */
const MON = { x: 960, y: 290, w: 830 }
const DOCS = { x: 960, y: 140, w: 860 }
export const MocksMonitors: React.FC = () => {
  const f = useCurrentFrame()
  const t = useT()
  const shrink = prog(f, 0, 10, easeIn)
  const burst = prog(f, 8, 30)
  const l = useIn(beat(1), 13)
  const r = useIn(beat(2), 13)
  const out = prog(f, 150, 176, easeInOut)
  const alerts: [string, string][] = [
    ['Email', '#e4e4e7'],
    ['Slack', '#e01e5a'],
    ['Discord', '#5865f2'],
    ['Telegram', '#26a5e4'],
    ['Webhooks', C.brand],
  ]
  return (
    <Scene>
      <div style={{ position: 'absolute', top: 80, width: '100%' }}>
        <Mask text={t.mocksH} size={84} at={4} hl={t.mocksHl} align="center" outAt={148} />
      </div>
      <div style={{ position: 'absolute', left: 130, top: 260, transform: `translateX(${(1 - l) * -900 - out * 1200}px) rotate(${-3 * l}deg) scale(${bump(f, beat(1) + 8, 0.04)})` }}>
        <Browser src="mocks" width={830} url="mock.cartero.local" />
        <MaskBlock at={40} style={{ marginTop: 22, fontSize: 28, color: C.muted, fontWeight: 600, textAlign: 'center' }}>
          {t.mocksCap}
        </MaskBlock>
      </div>
      {/* El monitor se convierte en la ventana de documentación de la escena siguiente */}
      <div
        style={{
          position: 'absolute',
          left: mix(MON.x, DOCS.x, out),
          top: mix(MON.y, DOCS.y, out),
          transform: `translateX(${(1 - r) * 900}px) rotate(${mix(3 * r, 2.5, out)}deg) scale(${bump(f, beat(2) + 8, 0.04)})`,
        }}
      >
        <div style={{ position: 'relative' }}>
          <Browser src="monitors" width={mix(MON.w, DOCS.w, out)} url="cartero.local/monitors" />
          <div style={{ position: 'absolute', inset: 0, opacity: prog(f, 160, 176) }}>
            <Browser src="docs" width={mix(MON.w, DOCS.w, out)} url="docs.cartero.local/blog-api" />
          </div>
        </div>
        <MaskBlock at={50} outAt={150} style={{ marginTop: 22, fontSize: 28, color: C.muted, fontWeight: 600, textAlign: 'center' }}>
          {t.monitorsCap}
        </MaskBlock>
      </div>
      <div style={{ position: 'absolute', top: 925, width: '100%', display: 'flex', justifyContent: 'center', gap: 16, alignItems: 'center', opacity: 1 - prog(f, 148, 158) }}>
        <MaskBlock at={beat(6) - 6} style={{ fontSize: 26, color: C.muted, marginRight: 8, fontWeight: 600 }}>
          {t.alertsTo}
        </MaskBlock>
        {alerts.map(([a, c], i) => (
          <div key={a} style={{ transform: `scale(${bump(f, beat(6) + i * (BEAT / 2) + 5, 0.12)})` }}>
            <Chip color={c} delay={beat(6) + i * (BEAT / 2)} size={24}>
              {a}
            </Chip>
          </div>
        ))}
      </div>
      {/* El círculo verde de la escena anterior se cierra y estalla en el golpe */}
      {shrink < 1 && (
        <div
          style={{
            position: 'absolute',
            left: 960 - 1200 * (1 - shrink),
            top: 540 - 1200 * (1 - shrink),
            width: 2400 * (1 - shrink),
            height: 2400 * (1 - shrink),
            borderRadius: 9999,
            background: C.green,
          }}
        />
      )}
      {f >= 8 && burst < 1 && (
        <div
          style={{
            position: 'absolute',
            left: 960 - 300,
            top: 540 - 300,
            width: 600,
            height: 600,
            borderRadius: 999,
            border: `6px solid ${C.green}`,
            opacity: 1 - burst,
            transform: `scale(${0.1 + burst * 2})`,
          }}
        />
      )}
    </Scene>
  )
}

/* ───────────── 9 · Equipos: la cámara acompaña al cursor; los avatares se vuelven la burbuja del chat ───────────── */
const AVATAR_Y = 800
export const Teams: React.FC = () => {
  const f = useCurrentFrame()
  const t = useT()
  const front = useIn(beat(1), 14)
  const people: [string, string][] = [
    ['AM', '#f97316'],
    ['JS', '#22c55e'],
    ['LK', '#38bdf8'],
  ]
  const cx = interpolate(f, [55, 120], [1480, 1240], { ...clamp, easing: easeInOut })
  const cy = interpolate(f, [55, 120], [560, 760], { ...clamp, easing: easeInOut })
  const cur = useIn(50, 18)
  // Cámara que sigue al cursor (solo el grupo de ventanas)
  const follow = prog(f, 40, 120, easeInOut)
  const gx = -(cx - 1360) * 0.18 * follow
  const gy = -(cy - 640) * 0.18 * follow
  const merge = prog(f, 126, 150, easeInOut)
  return (
    <Scene>
      <div style={{ position: 'absolute', inset: 0, transform: `translate(${gx}px, ${gy}px) scale(${1 + follow * 0.04})`, transformOrigin: '1360px 600px' }}>
        <div style={{ position: 'absolute', left: DOCS.x, top: DOCS.y, transform: 'rotate(2.5deg)', opacity: 1 - prog(f, 126, 140) }}>
          <Browser src="docs" width={DOCS.w} url="docs.cartero.local/blog-api" />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 880,
            top: 470,
            transform: `translate(${(1 - front) * 300 + merge * 900}px, ${(1 - front) * 200}px) rotate(${-2 * front}deg) scale(${bump(f, beat(1) + 8, 0.04)})`,
            opacity: front,
          }}
        >
          <Browser src="collab" width={560} url="cartero.local/w/team" />
        </div>
        <div style={{ position: 'absolute', left: cx, top: cy, opacity: cur * (1 - prog(f, 124, 132)), transform: `scale(${cur})` }}>
          <svg width="34" height="34" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.6))' }}>
            <path d="M4 2l16 9-7 2-3 7z" fill="#22c55e" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <div style={{ marginLeft: 26, marginTop: -4, padding: '5px 12px', borderRadius: 8, background: C.green, color: '#052e16', fontSize: 18, fontWeight: 700, display: 'inline-block' }}>
            {t.cursor}
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 120, top: 250, width: 720 }}>
        <MaskBlock at={4} outAt={122}>
          <Kicker delay={4}>{t.teamsK}</Kicker>
        </MaskBlock>
        <Mask text={t.teamsH1} size={86} at={6} hl={t.teamsHl} outAt={120} />
        <Mask text={t.teamsH2} size={86} at={14} outAt={122} />
        <MaskBlock at={28} outAt={124} style={{ marginTop: 26 }}>
          <div style={{ fontSize: 31, lineHeight: 1.45, color: C.muted }}>{t.teamsSub}</div>
        </MaskBlock>
      </div>
      {/* Avatares: entran en tres golpes y al final se juntan en la burbuja del chat */}
      {people.map(([p, c], i) => {
        const s = useIn(beat(3 + i), 12)
        const x = mix(120 + i * 64, 560 + i * 18, merge)
        const y = mix(AVATAR_Y, 400, merge)
        return (
          <div
            key={p}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: 72,
              height: 72,
              borderRadius: 99,
              background: '#27272a',
              border: `3px solid ${c}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              fontWeight: 700,
              transform: `scale(${s * bump(f, beat(3 + i) + 4, 0.15) * (1 - merge * 0.6)})`,
              boxShadow: '0 0 0 4px #0c0c0e',
            }}
          >
            {p}
          </div>
        )
      })}
      <div style={{ position: 'absolute', left: 120 + 3 * 64 + 28, top: AVATAR_Y + 22, fontSize: 24, color: C.muted, fontWeight: 600, opacity: 1 - prog(f, 120, 128) }}>
        <MaskBlock at={beat(5) + 6}>
          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 99, background: C.green, marginRight: 10 }} />
          {t.editing}
        </MaskBlock>
      </div>
    </Scene>
  )
}

/* ───────────── 10 · MCP: la burbuja nace de los avatares; al final todo se recoge en el centro ───────────── */
export const Mcp: React.FC = () => {
  const f = useCurrentFrame()
  const t = useT()
  const { fps } = useVideoConfig()
  const ask = t.mcpAsk
  const bubble = prog(f, 0, 14)
  const typedEnd = typedAt(ask, 10, 44, fps)
  const reply = useIn(typedEnd + 6, 14)
  const passAt = typedEnd + 14
  const win = useIn(beat(1), 16)
  const collapse = prog(f, 128, 150, easeIn)
  return (
    <Scene>
      <AbsoluteFill style={{ transform: `scale(${1 - collapse * 0.92})`, opacity: 1 - prog(f, 140, 150), transformOrigin: '960px 540px' }}>
        <div style={{ position: 'absolute', top: 92, width: '100%' }}>
          <MaskBlock at={2}>
            <Kicker delay={2} style={{ justifyContent: 'center' }}>
              {t.mcpK}
            </Kicker>
          </MaskBlock>
          <Mask text={t.mcpH} size={92} at={0} hl={t.mcpHl} align="center" />
        </div>
        <div style={{ position: 'absolute', left: 140, top: 380, width: 760, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              alignSelf: 'flex-end',
              maxWidth: 620,
              padding: '22px 28px',
              borderRadius: '22px 22px 6px 22px',
              background: '#27272a',
              fontSize: 28,
              lineHeight: 1.4,
              transform: `scale(${0.3 + bubble * 0.7})`,
              transformOrigin: 'center',
              opacity: bubble,
            }}
          >
            <Type text={ask} delay={10} cps={44} caret={false} />
          </div>
          <div
            style={{
              opacity: reply,
              transform: `translateY(${(1 - reply) * 24}px)`,
              maxWidth: 680,
              padding: '22px 28px',
              borderRadius: '22px 22px 22px 6px',
              background: 'rgba(249,115,22,0.10)',
              border: '1px solid rgba(249,115,22,0.35)',
              fontSize: 28,
              lineHeight: 1.45,
            }}
          >
            <div style={{ fontFamily: mono, fontSize: 19, color: C.brand, marginBottom: 10 }}>⚙ {t.mcpTool}</div>
            {t.mcpR1}
            <span style={{ color: C.green, fontWeight: 700, display: 'inline-block', transform: `scale(${bump(f, passAt, 0.12)})` }}>{t.mcpR2}</span>
            {t.mcpR3}
          </div>
          <MaskBlock at={104} style={{ fontSize: 26, color: C.muted, fontWeight: 600, marginTop: 6 }}>
            {t.mcpFoot}
          </MaskBlock>
        </div>
        <div style={{ position: 'absolute', left: 990, top: 360, perspective: 2200 }}>
          <div style={{ transform: `translateX(${(1 - win) * 500}px) rotateY(${-12 + win * 6}deg)`, opacity: win }}>
            <Browser src="mcp" width={800} url="cartero.local/settings/mcp" />
          </div>
        </div>
      </AbsoluteFill>
    </Scene>
  )
}

/* ───────────── 11 · Resumen: las tarjetas salen del centro a medio golpe y vuelven a juntarse en el sello ───────────── */
export const Recap: React.FC = () => {
  const f = useCurrentFrame()
  const t = useT()
  const items = t.recap
  const gather = prog(f, 96, 116, easeIn)
  const stampIn = prog(f, 108, 120)
  return (
    <Scene>
      <div style={{ position: 'absolute', top: 110, width: '100%' }}>
        <Mask text={t.recapH} size={92} at={0} hl={t.recapHl} align="center" outAt={92} />
      </div>
      {items.map(([title, desc], i) => {
        const at = 2 + i * (BEAT / 2)
        const s = useIn(at, 14)
        const col = i % 4
        const row = Math.floor(i / 4)
        const gx = 150 + col * (390 + 20)
        const gy = 330 + row * (250 + 24)
        const x = mix(960 - 195, gx, s) * (1 - gather) + (960 - 195) * gather
        const y = mix(540 - 125, gy, s) * (1 - gather) + (540 - 125) * gather
        return (
          <div
            key={title}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: 390,
              height: 250,
              boxSizing: 'border-box',
              padding: '30px 30px 28px',
              borderRadius: 20,
              background: 'linear-gradient(180deg, rgba(39,39,42,0.92), rgba(24,24,27,0.92))',
              border: '1px solid rgba(255,255,255,0.1)',
              opacity: Math.min(1, s * 1.4) * (1 - gather),
              transform: `scale(${(0.6 + s * 0.4) * bump(f, at + 8, 0.06) * (1 - gather * 0.7)})`,
            }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 11, background: 'rgba(249,115,22,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <span style={{ color: C.brand, fontSize: 24, fontWeight: 800 }}>✓</span>
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</div>
            <div style={{ fontSize: 22, color: C.muted, marginTop: 8 }}>{desc}</div>
          </div>
        )
      })}
      <div style={{ position: 'absolute', top: 870, width: '100%', textAlign: 'center', fontSize: 34, fontWeight: 600, color: C.muted }}>
        <MaskBlock at={72} outAt={92}>
          <span style={{ color: C.text }}>{t.recapFoot1}</span>
          {t.recapFoot2}
        </MaskBlock>
      </div>
      {stampIn > 0 && (
        <div style={{ position: 'absolute', left: 960 - 171 / 2, top: 540 - 171 / 2, opacity: stampIn, transform: `scale(${0.4 + stampIn * 0.6})` }}>
          <Stamp size={171} punch={stampIn} braces={stampIn} id="recap" />
        </div>
      )}
    </Scene>
  )
}

/* ───────────── 12 · Llamada a la acción: el sello sube, «Cartero» se revela y el comando se escribe ───────────── */
export const Cta: React.FC = () => {
  const f = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const t = useT()
  const up = prog(f, 8, 28, easeInOut)
  const l1 = 'git clone https://github.com/elrincondeisma/cartero'
  const l2 = 'docker compose up -d'
  const t1 = 66
  const t2 = typedAt(l1, t1, 44, fps) + 6
  const okAt = typedAt(l2, t2, 32, fps) + 8
  const gh = useIn(beat(11), 13)
  const end = interpolate(f, [durationInFrames - 24, durationInFrames], [1, 0], clamp)
  const size = mix(171, 96, up)
  const sx = mix(960 - 171 / 2, 960 - 300, up)
  const sy = mix(540 - 171 / 2, 160, up)
  return (
    <AbsoluteFill style={{ fontFamily: inter, color: C.text, opacity: end }}>
      <div style={{ position: 'absolute', left: sx, top: sy, transform: `scale(${bump(f, 0, 0.14, 12)})` }}>
        <Stamp size={size} id="cta" glow={30} />
      </div>
      <div style={{ position: 'absolute', left: 960 - 300 + 120, top: 160 - 4 }}>
        <Mask text="Cartero" at={20} size={92} dur={18} />
      </div>
      <div style={{ position: 'absolute', top: 330, width: '100%' }}>
        <Mask text={t.ctaH} size={76} at={beat(2) + 4} hl={t.ctaHl} align="center" />
      </div>
      <div style={{ position: 'absolute', top: 500, width: '100%', display: 'flex', justifyContent: 'center' }}>
        <MaskBlock at={56}>
          <Terminal width={1120}>
            <div>
              <Prompt />
              <Type text={l1} delay={t1} cps={44} caret={f < t2} />
            </div>
            <div style={{ minHeight: 40 }}>
              {f >= t2 && (
                <>
                  <Prompt />
                  <Type text={l2} delay={t2} cps={32} />
                </>
              )}
            </div>
            <div style={{ color: C.green, minHeight: 40, transform: `scale(${bump(f, okAt + 4, 0.05)})`, transformOrigin: 'left center' }}>
              {f >= okAt && <MaskBlock at={okAt}>{t.running}</MaskBlock>}
            </div>
          </Terminal>
        </MaskBlock>
      </div>
      <div style={{ position: 'absolute', top: 850, width: '100%', display: 'flex', justifyContent: 'center' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 22,
            padding: '20px 22px 20px 32px',
            borderRadius: 999,
            background: '#18181b',
            border: '1px solid rgba(255,255,255,0.16)',
            opacity: gh,
            transform: `scale(${(0.8 + gh * 0.2) * bump(f, beat(11) + 6, 0.08)})`,
            boxShadow: '0 0 80px -10px rgba(249,115,22,0.45)',
          }}
        >
          <svg width="40" height="40" viewBox="0 0 16 16" fill="#fff">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          <span style={{ fontSize: 36, fontWeight: 600, fontFamily: mono, letterSpacing: '-0.02em' }}>github.com/elrincondeisma/cartero</span>
          <span style={{ marginLeft: 6, padding: '12px 26px', borderRadius: 999, background: 'linear-gradient(180deg,#fb923c,#ea580c)', fontSize: 28, fontWeight: 700 }}>{t.star}</span>
        </div>
      </div>
    </AbsoluteFill>
  )
}
