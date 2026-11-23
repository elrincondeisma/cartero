import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useVideoConfig } from 'remotion'
import { type Lang, LangCtx } from './i18n'
import { Background } from './kit'
import { BEAT } from './motion'
import { Contracts, Cta, Desktop, Hook, Import, Mcp, MocksMonitors, Recap, Request, Reveal, Teams, TestsRunner } from './scenes'

/**
 * Escaleta en fotogramas (30 fps). La música va a 120 BPM: cada escena dura compases
 * enteros (60 fotogramas = 4 golpes), así los cortes caen en el golpe. El sello aterriza
 * con la entrada fuerte (4 s) y la app de escritorio ocupa el respiro (32–36 s).
 */
export const SCENES = [
  { C: Hook, d: 120 },
  { C: Reveal, d: 120 },
  { C: Import, d: 180 },
  { C: Request, d: 180 },
  { C: Contracts, d: 180 },
  { C: TestsRunner, d: 180 },
  { C: Desktop, d: 120 },
  { C: MocksMonitors, d: 180 },
  { C: Teams, d: 150 },
  { C: Mcp, d: 150 },
  { C: Recap, d: 120 },
  { C: Cta, d: 270 },
]
export const TOTAL = SCENES.reduce((a, s) => a + s.d, 0)
const START = SCENES.reduce<number[]>((acc, s, i) => [...acc, i ? acc[i - 1] + SCENES[i - 1].d : 0], [])
const at = (scene: number, f: number) => START[scene] + Math.round(f)
const half = BEAT / 2

/** «Pop» en cada entrada que cae en un golpe (fotogramas absolutos). */
const POPS = [
  ...[0, 1, 2, 3].map((i) => at(0, i * BEAT + 1)),
  at(0, 5 * BEAT),
  ...[3, 4, 5, 6].map((b) => at(2, b * BEAT)),
  at(2, 8 * BEAT + 8),
  ...[0, 1, 2, 3, 4].map((i) => at(3, 112 + i * 6)),
  at(4, 4 * BEAT + 6),
  at(4, 6 * BEAT - 2),
  at(4, 124),
  at(5, 4 * BEAT + 2),
  at(6, 5 * BEAT + 4),
  ...[0, 1, 2, 3, 4].map((i) => at(7, 6 * BEAT + i * half)),
  ...[3, 4, 5].map((b) => at(8, b * BEAT)),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => at(10, 2 + i * half)),
  at(11, 11 * BEAT),
]

/** Golpes graves en los momentos clave: el sello, el contrato roto, el 10/10 y el cierre. */
const HITS = [at(1, 0), at(4, 6 * BEAT), at(5, 5 * BEAT + 9 * half), at(7, 0), at(11, 0)]

export const Promo: React.FC<{ lang?: Lang }> = ({ lang = 'en' }) => {
  const { durationInFrames } = useVideoConfig()
  return (
    <LangCtx.Provider value={lang}>
      <AbsoluteFill>
        <Background />
        {SCENES.map(({ C, d }, i) => (
          <Sequence key={i} from={START[i]} durationInFrames={d} premountFor={30}>
            <C />
          </Sequence>
        ))}
        <Audio
          src={staticFile('audio/music.mp3')}
          volume={(f) => interpolate(f, [0, 8, durationInFrames - 50, durationInFrames - 4], [0, 0.9, 0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
        />
        {START.slice(1).map((s) => (
          <Sequence key={`w${s}`} from={s - 8} durationInFrames={30}>
            <Audio src={staticFile('audio/whoosh.mp3')} volume={0.26} />
          </Sequence>
        ))}
        {POPS.map((p, i) => (
          <Sequence key={`p${i}-${p}`} from={p} durationInFrames={20}>
            <Audio src={staticFile('audio/pop.mp3')} volume={0.2} />
          </Sequence>
        ))}
        {HITS.map((p) => (
          <Sequence key={`h${p}`} from={p} durationInFrames={20}>
            <Audio src={staticFile('audio/pop.mp3')} volume={0.45} playbackRate={0.6} />
          </Sequence>
        ))}
      </AbsoluteFill>
    </LangCtx.Provider>
  )
}
