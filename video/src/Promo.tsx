import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useVideoConfig } from 'remotion'
import { type Lang, LangCtx } from './i18n'
import { Background } from './kit'
import { BEAT } from './motion'
import { Contracts, Cta, Desktop, Hook, Import, Mcp, MocksMonitors, Recap, Request, Reveal, Teams, TestsRunner } from './scenes'
import { type Hold, HoldsCtx, holdsLength, sceneToReal } from './time'

/**
 * Escaleta (30 fps). `d` es la duración de la animación de la escena y `holds` las pausas de
 * lectura: [fotograma de la escena en que se para, fotogramas reales]. La música va a 120 BPM
 * (60 fotogramas por compás) y está alargada con compases repetidos (scripts/extend-music.sh)
 * para que el sello siga cayendo en la entrada fuerte (6 s), la app de escritorio en el
 * respiro (48–54 s) y el cierre al final.
 */
export const SCENES: { C: React.FC; d: number; holds: Hold[] }[] = [
  { C: Hook, d: 120, holds: [[101, 60]] },
  { C: Reveal, d: 120, holds: [[78, 60]] },
  { C: Import, d: 180, holds: [[104, 60], [148, 30]] },
  { C: Request, d: 180, holds: [[72, 30], [145, 60]] },
  { C: Contracts, d: 180, holds: [[48, 60], [84, 30], [140, 30]] },
  { C: TestsRunner, d: 180, holds: [[80, 30], [159, 30]] },
  { C: Desktop, d: 120, holds: [[50, 60]] },
  { C: MocksMonitors, d: 180, holds: [[70, 30], [132, 30]] },
  { C: Teams, d: 150, holds: [[100, 60]] },
  { C: Mcp, d: 150, holds: [[124, 60]] },
  { C: Recap, d: 120, holds: [[90, 60]] },
  { C: Cta, d: 270, holds: [] },
]
const REAL = SCENES.map((s) => s.d + holdsLength(s.holds))
export const TOTAL = REAL.reduce((a, d) => a + d, 0)
const START = REAL.reduce<number[]>((acc, _, i) => [...acc, i ? acc[i - 1] + REAL[i - 1] : 0], [])
/** Fotograma real de un momento de una escena (en su tiempo propio). */
const at = (scene: number, f: number) => START[scene] + sceneToReal(Math.round(f), SCENES[scene].holds)
const half = BEAT / 2

/** «Pop» en cada entrada que cae en un golpe. */
const POPS = [
  ...[0, 1, 2, 3].map((i) => at(0, i * BEAT + 1)),
  at(0, 5 * BEAT),
  ...[3, 4, 5, 6].map((b) => at(2, b * BEAT)),
  at(2, 8 * BEAT + 8),
  ...[0, 1, 2, 3, 4].map((i) => at(3, 112 + i * 6)),
  at(4, 74),
  at(4, 6 * BEAT - 2),
  at(4, 124),
  at(5, 4 * BEAT + 2),
  at(6, 5 * BEAT + 4),
  ...[0, 1, 2, 3, 4].map((i) => at(7, 6 * BEAT + i * half)),
  ...[3, 4, 5].map((b) => at(8, b * BEAT)),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => at(10, 2 + i * half)),
  at(11, 11 * BEAT),
]

/** Golpes graves: el sello, el contrato roto, el 10/10, la vuelta de la música y el cierre. */
const HITS = [at(1, 0), at(4, 6 * BEAT), at(5, 158), at(7, 0), at(11, 0)]

export const Promo: React.FC<{ lang?: Lang }> = ({ lang = 'en' }) => {
  const { durationInFrames } = useVideoConfig()
  return (
    <LangCtx.Provider value={lang}>
      <AbsoluteFill>
        <Background />
        {SCENES.map(({ C, holds }, i) => (
          <Sequence key={i} from={START[i]} durationInFrames={REAL[i]} premountFor={30}>
            <HoldsCtx.Provider value={holds}>
              <C />
            </HoldsCtx.Provider>
          </Sequence>
        ))}
        <Audio
          src={staticFile('audio/music-long.mp3')}
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
