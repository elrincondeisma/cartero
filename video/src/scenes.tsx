import type React from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { useT } from './i18n'
import { Browser, C, Chip, Fade, Kicker, Logo, Prompt, Scene, Terminal, Type, Words, inter, lerp, mono, typedAt, useIn } from './kit'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/* 1 · Gancho (0–4 s, la música aún no ha entrado) */
export const Hook: React.FC = () => {
  const f = useCurrentFrame()
  const strike = lerp(f, 78, 92, 0, 1)
  const s2 = useIn(52)
  const t = useT()
  return (
    <Scene out={10}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <Words text={t.hook1} size={104} stagger={7} delay={4} />
        <div style={{ marginTop: 34, fontSize: 56, fontWeight: 600, color: C.muted, letterSpacing: '-0.02em', opacity: s2, transform: `translateY(${(1 - s2) * 20}px)` }}>
          {t.hook2}{' '}
          <span style={{ position: 'relative', whiteSpace: 'nowrap', color: interpolate(strike, [0, 1], [0, 1]) > 0.5 ? '#71717a' : C.text }}>
            {t.paywall}
            <span
              style={{
                position: 'absolute',
                left: -6,
                top: '54%',
                height: 7,
                borderRadius: 4,
                width: `calc(${strike * 100}% + ${strike * 12}px)`,
                background: C.brand,
                boxShadow: `0 0 20px ${C.brand}`,
              }}
            />
          </span>
          .
        </div>
      </AbsoluteFill>
    </Scene>
  )
}

/* 2 · Logo (entra con el golpe de la música) */
export const Reveal: React.FC = () => {
  const f = useCurrentFrame()
  const logo = useIn(0, 11)
  const draw = useIn(2, 200)
  const word = useIn(8, 16)
  const ring = lerp(f, 0, 40, 0, 1)
  const t = useT()
  return (
    <Scene>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 44 }}>
          <div style={{ position: 'relative', transform: `scale(${logo}) rotate(${(1 - logo) * -25}deg)` }}>
            <div
              style={{
                position: 'absolute',
                inset: -20,
                borderRadius: 60,
                border: `3px solid ${C.brand}`,
                opacity: 1 - ring,
                transform: `scale(${1 + ring * 1.4})`,
              }}
            />
            <div style={{ filter: 'drop-shadow(0 0 60px rgba(249,115,22,0.6))' }}>
              <Logo size={200} draw={draw} />
            </div>
          </div>
          <div style={{ fontSize: 190, fontWeight: 800, letterSpacing: '-0.055em', opacity: word, transform: `translateX(${(1 - word) * 60}px)`, clipPath: `inset(0 ${(1 - word) * 100}% 0 0)` }}>
            Cartero
          </div>
        </div>
        <Fade delay={26} style={{ marginTop: 40 }}>
          <div style={{ fontSize: 50, fontWeight: 500, color: C.muted, letterSpacing: '-0.02em' }}>
            {t.tagPre}<span style={{ color: C.text, fontWeight: 700 }}>{t.tagHl}</span>{t.tagPost}
          </div>
        </Fade>
      </AbsoluteFill>
    </Scene>
  )
}

/* 3 · Importar */
export const Import: React.FC = () => {
  const f = useCurrentFrame()
  const win = useIn(6, 22)
  const toast = useIn(112, 14)
  const t = useT()
  const formats: [string, string][] = [
    ['Postman', '#ff6c37'],
    ['OpenAPI', '#6ba539'],
    ['cURL', '#38bdf8'],
    ['Insomnia', '#a855f7'],
  ]
  return (
    <Scene>
      <div style={{ position: 'absolute', left: 120, top: 250, width: 760 }}>
        <Kicker>{t.importK}</Kicker>
        <Words text={t.importH} size={92} hl={t.importHl} delay={4} />
        <Fade delay={26} style={{ marginTop: 28, fontSize: 31, lineHeight: 1.45, color: C.muted, width: 680 }}>
          {t.importSub}
        </Fade>
        <div style={{ display: 'flex', gap: 14, marginTop: 44 }}>
          {formats.map(([name, color], i) => (
            <Chip key={name} color={color} delay={46 + i * 9} size={25}>
              {name}
            </Chip>
          ))}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 930, top: 210, perspective: 2200 }}>
        <div style={{ transform: `translateX(${(1 - win) * 500}px) rotateY(${-16 + win * 8 - f * 0.02}deg)`, opacity: win, transformOrigin: 'left center' }}>
          <Browser src="import" width={940} url="cartero.local/import" />
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 1240,
          top: 830,
          opacity: toast,
          transform: `translateY(${(1 - toast) * 30}px) scale(${0.9 + toast * 0.1})`,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '18px 26px',
          borderRadius: 14,
          background: '#18181b',
          border: '1px solid rgba(34,197,94,0.4)',
          boxShadow: '0 20px 50px -10px rgba(0,0,0,0.7)',
          fontSize: 26,
          fontWeight: 600,
        }}
      >
        <span style={{ color: C.green, fontSize: 30 }}>✓</span> {t.importToast}
      </div>
    </Scene>
  )
}

/* 4 · Peticiones */
export const Request: React.FC = () => {
  const f = useCurrentFrame()
  const win = useIn(10, 24)
  const t = useT()
  const auths = ['Bearer', 'OAuth 2.0', 'AWS SigV4', 'Digest', 'API Key']
  return (
    <Scene>
      <div style={{ position: 'absolute', top: 92, width: '100%', textAlign: 'center' }}>
        <Kicker style={{ justifyContent: 'center' }}>{t.reqK}</Kicker>
        <Words text={t.reqH} size={80} delay={2} hl={t.reqHl} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 330,
          top: 340,
          perspective: 2400,
        }}
      >
        <div style={{ maskImage: 'linear-gradient(to bottom, #000 60%, transparent 92%)', transform: `translateY(${(1 - win) * 500}px) rotateX(${(1 - win) * 30 + 6}deg) scale(${1 + f * 0.0006})`, transformOrigin: 'center top', opacity: win }}>
          <Browser src="request-dark" width={1400} url="cartero.local/w/demo" />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 1560, top: 600, display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'flex-start' }}>
        <Chip color={C.green} delay={62} size={30}>
          200 OK
        </Chip>
        <Chip color={C.brand300} delay={70} size={30}>
          {t.reqTiming}
        </Chip>
      </div>
      <div style={{ position: 'absolute', left: 40, top: 520, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start' }}>
        {auths.map((a, i) => (
          <Chip key={a} delay={80 + i * 6} size={24} color={C.brand}>
            {a}
          </Chip>
        ))}
      </div>
    </Scene>
  )
}

/* 5 · Tests y scripts */
export const Scripts: React.FC = () => {
  const { fps } = useVideoConfig()
  const win = useIn(4, 22)
  const t = useT()
  const lines = [`pm.test('${t.testName}', () => {`, '  pm.response.to.have.status(200)', '})']
  const starts = [30, 0, 0]
  for (let i = 1; i < lines.length; i++) starts[i] = typedAt(lines[i - 1], starts[i - 1], 40, fps) + 3
  const done = typedAt(lines[2], starts[2], 40, fps) + 8
  const pass = useIn(done, 14)
  return (
    <Scene>
      <div style={{ position: 'absolute', left: 120, top: 200, width: 800 }}>
        <Kicker>{t.scriptsK}</Kicker>
        <Words text={t.scriptsH} size={86} code={['pm.*']} delay={2} />
        <Terminal width={760} title="post-response.js" style={{ marginTop: 50 }}>
          {lines.map((l, i) => (
            <div key={l} style={{ whiteSpace: 'pre', minHeight: 40 }}>
              <Type text={l} delay={starts[i]} cps={40} caret={i === lines.length - 1 || false} />
            </div>
          ))}
          <div style={{ marginTop: 14, color: C.green, opacity: pass, transform: `translateX(${(1 - pass) * -20}px)` }}>✓ {t.testName} · {t.testPass}</div>
        </Terminal>
      </div>
      <div style={{ position: 'absolute', left: 980, top: 170, perspective: 2200 }}>
        <div style={{ transform: `translateX(${(1 - win) * 400}px) rotateY(${-12 + win * 6}deg)`, opacity: win }}>
          <Browser src="scripts" width={840} url="cartero.local/w/demo" />
        </div>
      </div>
    </Scene>
  )
}

/* 6 · Runner */
export const Runner: React.FC = () => {
  const f = useCurrentFrame()
  const win = useIn(4, 22)
  const n = Math.round(interpolate(f, [28, 70], [0, 10], clamp))
  const pop = useIn(70, 10)
  const cmd = 'cartero run blog.json -r junit'
  const t = useT()
  return (
    <Scene>
      <div style={{ position: 'absolute', left: 110, top: 175, perspective: 2200 }}>
        <div style={{ transform: `translateX(${(1 - win) * -400}px) rotateY(${12 - win * 6}deg)`, opacity: win }}>
          <Browser src="runner" width={830} url="cartero.local/runner" />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 1040, top: 190, width: 800 }}>
        <Kicker>{t.runnerK}</Kicker>
        <Words text={t.runnerH1} size={86} delay={2} hl={t.runnerHl} />
        <Words text={t.runnerH2} size={86} delay={12} />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 22, marginTop: 34 }}>
          <span style={{ fontSize: 170, fontWeight: 800, letterSpacing: '-0.05em', color: C.green, transform: `scale(${1 + (1 - pop) * 0 + Math.sin(pop * Math.PI) * 0.08})`, display: 'inline-block', fontVariantNumeric: 'tabular-nums' }}>
            {n}/10
          </span>
          <span style={{ fontSize: 36, color: C.muted, fontWeight: 600 }}>{t.testsPassed}</span>
        </div>
        <Fade delay={78}>
          <div style={{ fontSize: 26, color: C.muted, marginBottom: 14, fontWeight: 500 }}>{t.sameCi}</div>
          <Terminal width={720}>
            <Prompt />
            <Type text={cmd} delay={84} cps={36} />
          </Terminal>
        </Fade>
      </div>
    </Scene>
  )
}

/* 7 · Mocks y monitores */
export const MocksMonitors: React.FC = () => {
  const l = useIn(8, 20)
  const r = useIn(18, 20)
  const t = useT()
  const alerts: [string, string][] = [
    ['Email', '#e4e4e7'],
    ['Slack', '#e01e5a'],
    ['Discord', '#5865f2'],
    ['Telegram', '#26a5e4'],
    ['Webhooks', C.brand],
  ]
  return (
    <Scene>
      <div style={{ position: 'absolute', top: 80, width: '100%', textAlign: 'center' }}>
        <Words text={t.mocksH} size={84} delay={2} hl={t.mocksHl} />
      </div>
      <div style={{ position: 'absolute', left: 130, top: 260, transform: `translateX(${(1 - l) * -700}px) rotate(${-3 * l}deg)`, opacity: l }}>
        <Browser src="mocks" width={830} url="mock.cartero.local" />
        <Fade delay={40} style={{ marginTop: 22, fontSize: 28, color: C.muted, fontWeight: 600, textAlign: 'center' }}>
          {t.mocksCap}
        </Fade>
      </div>
      <div style={{ position: 'absolute', left: 960, top: 290, transform: `translateX(${(1 - r) * 700}px) rotate(${3 * r}deg)`, opacity: r }}>
        <Browser src="monitors" width={830} url="cartero.local/monitors" />
        <Fade delay={50} style={{ marginTop: 22, fontSize: 28, color: C.muted, fontWeight: 600, textAlign: 'center' }}>
          {t.monitorsCap}
        </Fade>
      </div>
      <div style={{ position: 'absolute', top: 925, width: '100%', display: 'flex', justifyContent: 'center', gap: 16, alignItems: 'center' }}>
        <Fade delay={78} y={10} style={{ fontSize: 26, color: C.muted, marginRight: 8, fontWeight: 600 }}>
          {t.alertsTo}
        </Fade>
        {alerts.map(([a, c], i) => (
          <Chip key={a} color={c} delay={82 + i * 6} size={24}>
            {a}
          </Chip>
        ))}
      </div>
    </Scene>
  )
}

/* 8 · Equipos y documentación */
export const Teams: React.FC = () => {
  const f = useCurrentFrame()
  const back = useIn(6, 22)
  const front = useIn(18, 20)
  const people: [string, string][] = [
    ['AM', '#f97316'],
    ['JS', '#22c55e'],
    ['LK', '#38bdf8'],
  ]
  const cx = lerp(f, 60, 130, 1480, 1240, (t) => t * t * (3 - 2 * t))
  const cy = lerp(f, 60, 130, 560, 760, (t) => t * t * (3 - 2 * t))
  const cur = useIn(55, 18)
  const t = useT()
  return (
    <Scene>
      <div style={{ position: 'absolute', left: 120, top: 250, width: 720 }}>
        <Kicker>{t.teamsK}</Kicker>
        <Words text={t.teamsH1} size={86} delay={2} hl={t.teamsHl} />
        <Words text={t.teamsH2} size={86} delay={10} />
        <Fade delay={28} style={{ marginTop: 28, fontSize: 31, lineHeight: 1.45, color: C.muted }}>
          {t.teamsSub}
        </Fade>
        <div style={{ display: 'flex', marginTop: 40 }}>
          {people.map(([p, c], i) => {
            const s = useIn(40 + i * 6, 12)
            return (
              <div
                key={p}
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 99,
                  marginLeft: i ? -8 : 0,
                  background: '#27272a',
                  border: `3px solid ${c}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  fontWeight: 700,
                  transform: `scale(${s})`,
                  boxShadow: '0 0 0 4px #0c0c0e',
                }}
              >
                {p}
              </div>
            )
          })}
          <Fade delay={60} y={0} style={{ alignSelf: 'center', marginLeft: 20, fontSize: 24, color: C.muted, fontWeight: 600 }}>
            <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 99, background: C.green, marginRight: 10 }} />{t.editing}
          </Fade>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 960, top: 140, transform: `translate(${(1 - back) * 400}px, ${(1 - back) * -60}px) rotate(${2.5 * back}deg)`, opacity: back }}>
        <Browser src="docs" width={860} url="docs.cartero.local/blog-api" />
      </div>
      <div style={{ position: 'absolute', left: 880, top: 470, transform: `translate(${(1 - front) * 300}px, ${(1 - front) * 200}px) rotate(${-2 * front}deg)`, opacity: front }}>
        <Browser src="collab" width={560} url="cartero.local/w/team" />
      </div>
      <div style={{ position: 'absolute', left: cx, top: cy, opacity: cur, transform: `scale(${cur})` }}>
        <svg width="34" height="34" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.6))' }}>
          <path d="M4 2l16 9-7 2-3 7z" fill="#22c55e" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <div style={{ marginLeft: 26, marginTop: -4, padding: '5px 12px', borderRadius: 8, background: C.green, color: '#052e16', fontSize: 18, fontWeight: 700, display: 'inline-block' }}>
          {t.cursor}
        </div>
      </div>
    </Scene>
  )
}

/* 9 · MCP */
export const Mcp: React.FC = () => {
  const t = useT()
  const ask = t.mcpAsk
  const { fps } = useVideoConfig()
  const reply = useIn(typedAt(ask, 22, 34, fps) + 10, 16)
  const win = useIn(10, 22)
  return (
    <Scene>
      <div style={{ position: 'absolute', top: 92, width: '100%', textAlign: 'center' }}>
        <Kicker style={{ justifyContent: 'center' }}>{t.mcpK}</Kicker>
        <Words text={t.mcpH} size={92} delay={2} hl={t.mcpHl} />
      </div>
      <div style={{ position: 'absolute', left: 140, top: 380, width: 760, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <Fade delay={16} style={{ alignSelf: 'flex-end', maxWidth: 620, padding: '22px 28px', borderRadius: '22px 22px 6px 22px', background: '#27272a', fontSize: 28, lineHeight: 1.4 }}>
          <Type text={ask} delay={22} cps={34} caret={false} />
        </Fade>
        <div style={{ opacity: reply, transform: `translateY(${(1 - reply) * 24}px)`, maxWidth: 680, padding: '22px 28px', borderRadius: '22px 22px 22px 6px', background: 'rgba(249,115,22,0.10)', border: '1px solid rgba(249,115,22,0.35)', fontSize: 28, lineHeight: 1.45 }}>
          <div style={{ fontFamily: mono, fontSize: 19, color: C.brand, marginBottom: 10 }}>⚙ {t.mcpTool}</div>
          {t.mcpR1}<span style={{ color: C.green, fontWeight: 700 }}>{t.mcpR2}</span>{t.mcpR3}
        </div>
        <Fade delay={100} style={{ fontSize: 26, color: C.muted, fontWeight: 600, marginTop: 6 }}>
          {t.mcpFoot}
        </Fade>
      </div>
      <div style={{ position: 'absolute', left: 990, top: 360, perspective: 2200 }}>
        <div style={{ transform: `translateX(${(1 - win) * 400}px) rotateY(${-12 + win * 6}deg)`, opacity: win }}>
          <Browser src="mcp" width={800} url="cartero.local/settings/mcp" />
        </div>
      </div>
    </Scene>
  )
}

/* 10 · Resumen */
export const Recap: React.FC = () => {
  const t = useT()
  const items = t.recap
  return (
    <Scene>
      <div style={{ position: 'absolute', top: 110, width: '100%', textAlign: 'center' }}>
        <Words text={t.recapH} size={92} delay={0} hl={t.recapHl} />
      </div>
      <div style={{ position: 'absolute', top: 330, left: 150, width: 1620, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}>
        {items.map(([t, d], i) => {
          const s = useIn(14 + i * 5, 15)
          return (
            <div
              key={t}
              style={{
                padding: '30px 30px 28px',
                borderRadius: 20,
                background: 'linear-gradient(180deg, rgba(39,39,42,0.85), rgba(24,24,27,0.85))',
                border: '1px solid rgba(255,255,255,0.1)',
                opacity: Math.min(1, s * 1.4),
                transform: `translateY(${(1 - s) * 40}px) scale(${0.9 + s * 0.1})`,
              }}
            >
              <div style={{ width: 40, height: 40, borderRadius: 11, background: 'rgba(249,115,22,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                <span style={{ color: C.brand, fontSize: 24, fontWeight: 800 }}>✓</span>
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>{t}</div>
              <div style={{ fontSize: 22, color: C.muted, marginTop: 8 }}>{d}</div>
            </div>
          )
        })}
      </div>
      <Fade delay={70} style={{ position: 'absolute', top: 820, width: '100%', textAlign: 'center', fontSize: 34, fontWeight: 600, color: C.muted }}>
        <span style={{ color: C.text }}>{t.recapFoot1}</span>{t.recapFoot2}
      </Fade>
    </Scene>
  )
}

/* 11 · Llamada a la acción */
export const Cta: React.FC = () => {
  const f = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const top = useIn(0, 16)
  const t = useT()
  const l1 = 'git clone https://github.com/elrincondeisma/cartero'
  const l2 = 'docker compose up -d'
  const t1 = 30
  const t2 = typedAt(l1, t1, 40, fps) + 8
  const ok = useIn(typedAt(l2, t2, 30, fps) + 10, 16)
  const gh = useIn(150, 13)
  const end = interpolate(f, [durationInFrames - 24, durationInFrames], [1, 0], clamp)
  return (
    <AbsoluteFill style={{ fontFamily: inter, color: C.text, opacity: end }}>
      <div style={{ position: 'absolute', top: 120, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, opacity: top, transform: `translateY(${(1 - top) * -30}px)` }}>
          <Logo size={84} />
          <span style={{ fontSize: 80, fontWeight: 800, letterSpacing: '-0.05em' }}>Cartero</span>
        </div>
        <Words text={t.ctaH} size={76} delay={8} style={{ marginTop: 34 }} hl={t.ctaHl} />
      </div>
      <div style={{ position: 'absolute', top: 470, width: '100%', display: 'flex', justifyContent: 'center' }}>
        <Fade delay={18}>
          <Terminal width={1120}>
            <div>
              <Prompt />
              <Type text={l1} delay={t1} cps={40} caret={f < t2} />
            </div>
            <div style={{ minHeight: 40 }}>
              {f >= t2 && (
                <>
                  <Prompt />
                  <Type text={l2} delay={t2} cps={30} />
                </>
              )}
            </div>
            <div style={{ color: C.green, opacity: ok, minHeight: 40 }}>{t.running}</div>
          </Terminal>
        </Fade>
      </div>
      <div style={{ position: 'absolute', top: 820, width: '100%', display: 'flex', justifyContent: 'center' }}>
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
            transform: `scale(${0.8 + gh * 0.2})`,
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
