> 🌐 **English** · [Español](README.es.md)

# Cartero · promo video

60-second motion-design product video, in English and Spanish, made with [Remotion](https://remotion.dev), using real screenshots of the app (`public/shots`, the same ones as the landing) and music generated with ElevenLabs.

```bash
cd video
pnpm install --ignore-workspace
pnpm dev        # Remotion Studio
pnpm render     # English: out/cartero-promo-en.mp4 (1920×1080, 30 fps)
pnpm render:es  # Spanish: out/cartero-promo-es.mp4
pnpm render:all # both, at -14 LUFS, plus the light web versions and posters for the landing hero
```

Scenes live in `src/scenes.tsx`, the copy for both languages in `src/i18n.ts`, the timeline in `src/Promo.tsx`. Screenshots per language are in `public/shots/en` and `public/shots/es`.
