import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useVideoConfig } from 'remotion'
import { type Lang, LangCtx } from './i18n'
import { Background } from './kit'
import { Cta, Hook, Import, Mcp, MocksMonitors, Recap, Request, Reveal, Runner, Scripts, Teams } from './scenes'

/** Escaleta en fotogramas (30 fps). El logo cae justo en el golpe de la música (4 s). */
export const SCENES = [
  { C: Hook, d: 120 },
  { C: Reveal, d: 105 },
  { C: Import, d: 180 },
  { C: Request, d: 180 },
  { C: Scripts, d: 150 },
  { C: Runner, d: 150 },
  { C: MocksMonitors, d: 180 },
  { C: Teams, d: 180 },
  { C: Mcp, d: 165 },
  { C: Recap, d: 180 },
  { C: Cta, d: 300 },
]
export const TOTAL = SCENES.reduce((a, s) => a + s.d, 0)

/** Golpes de «pop» en los chips, en fotogramas absolutos. */
const POPS = [
  ...[0, 1, 2, 3].map((i) => 225 + 46 + i * 9),
  ...[0, 1].map((i) => 405 + 62 + i * 8),
  ...[0, 1, 2, 3, 4].map((i) => 885 + 82 + i * 6),
]

export const Promo: React.FC<{ lang?: Lang }> = ({ lang = 'en' }) => {
  const { durationInFrames } = useVideoConfig()
  let at = 0
  const starts = SCENES.map((s) => {
    const x = at
    at += s.d
    return x
  })
  return (
    <LangCtx.Provider value={lang}>
    <AbsoluteFill>
      <Background />
      {SCENES.map(({ C, d }, i) => (
        <Sequence key={i} from={starts[i]} durationInFrames={d} premountFor={30}>
          <C />
        </Sequence>
      ))}
      <Audio
        src={staticFile('audio/music.mp3')}
        volume={(f) => interpolate(f, [0, 8, durationInFrames - 50, durationInFrames - 4], [0, 0.9, 0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
      />
      {starts.slice(1).map((s) => (
        <Sequence key={`w${s}`} from={s - 6} durationInFrames={30}>
          <Audio src={staticFile('audio/whoosh.mp3')} volume={0.32} />
        </Sequence>
      ))}
      {POPS.map((p) => (
        <Sequence key={`p${p}`} from={p} durationInFrames={20}>
          <Audio src={staticFile('audio/pop.mp3')} volume={0.22} />
        </Sequence>
      ))}
    </AbsoluteFill>
    </LangCtx.Provider>
  )
}
