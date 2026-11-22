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

Las escenas están en `src/scenes.tsx`, los textos de los dos idiomas en `src/i18n.ts` y la escaleta en `src/Promo.tsx`. Las capturas de cada idioma están en `public/shots/en` y `public/shots/es`.
