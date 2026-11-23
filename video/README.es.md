> 🌐 [English](README.md) · **Español**

# Cartero · vídeo promocional

Vídeo de un minuto con motion design, en inglés y español, hecho con [Remotion](https://remotion.dev). Usa capturas reales de la app (`public/shots`, las mismas que la landing) y música generada con ElevenLabs.

```bash
cd video
pnpm install --ignore-workspace
pnpm dev        # Remotion Studio
pnpm render     # inglés: out/cartero-promo-en.mp4 (1920×1080, 30 fps)
pnpm render:es  # español: out/cartero-promo-es.mp4
pnpm render:all # los dos a -14 LUFS, más las versiones ligeras y las portadas para la hero de la landing
```

Las escenas están en `src/scenes.tsx`, los textos de los dos idiomas en `src/i18n.ts` y la escaleta en `src/Promo.tsx`.

Las piezas de movimiento están en `src/motion.tsx`:
- **Ritmo**: la música va a 120 BPM, así que `beat(n)` es el golpe n de la escena (15 fotogramas cada uno) y cada escena dura compases enteros.
- **`Mask`** y **`MaskBlock`**: textos que entran y salen bajo una máscara.
- **`Camera`**: recorre las capturas con fotogramas clave encadenados.
- **`bump`**: el énfasis en el golpe.
- **`Stamp`**: el logo animable.

Ninguna escena se funde: cada una termina transformando un objeto en el primero de la siguiente.

Pausas de lectura: cada escena de `src/Promo.tsx` tiene `holds`. En cada pausa la escena se queda quieta mientras el fondo sigue, para que dé tiempo a leer. Las escenas leen su tiempo con `useFrame()` (`src/time.ts`). Las pausas suman compases enteros y la música se alarga con compases repetidos (`scripts/extend-music.sh`, que genera `public/audio/music-long.mp3`). Las capturas de cada idioma están en `public/shots/en` y `public/shots/es`.
