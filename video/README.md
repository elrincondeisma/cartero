# Cartero · promo video

60-second motion-design product video made with [Remotion](https://remotion.dev), using real screenshots of the app (`public/shots`, the same ones as the landing) and music generated with ElevenLabs.

```bash
cd video
pnpm install --ignore-workspace
pnpm dev        # Remotion Studio
pnpm render     # out/cartero-promo.mp4 (1920×1080, 30 fps)
```

Scenes live in `src/scenes.tsx`, the timeline in `src/Promo.tsx`.
