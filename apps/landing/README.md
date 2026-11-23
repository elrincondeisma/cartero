> 🌐 **English** · [Español](README.es.md)

# Cartero landing page

Static Astro site, in English (`/`) and Spanish (`/es/`).

```bash
pnpm --filter @cartero/landing dev       # http://localhost:4321
pnpm --filter @cartero/landing build     # builds dist/ (static HTML)
```

When you publish it, set:

| Variable | Purpose |
|---|---|
| `SITE_URL` | Final domain (canonical, hreflang, sitemap and Open Graph). Defaults to `https://cartero.elrincondeisma.com` |
| `PUBLIC_REPO_URL` | GitHub repository URL |

`dist/` can be served by any static host: GitHub Pages, Cloudflare Pages, Netlify or Nginx.

- **Copy:** in `src/i18n/ui.ts`. To add a language, add its block there, its route in `src/pages/<lang>/` and the language in `astro.config.mjs`.
- **Hero video:** `public/video/cartero-{es,en}.mp4`, generated from `video/` with `pnpm render:all`.
- **Screenshots:** they are real and are regenerated with the app running:

```bash
PW_CHROMIUM=/path/to/chrome npx playwright test -c playwright.screens.config.ts                   # src/assets/screens/*.png
CAPTURE_LANG=en PW_CHROMIUM=/path/to/chrome npx playwright test -c playwright.screens.config.ts   # src/assets/screens/en/*.png
node scripts/og-image.mjs                                                                          # public/og.png
```

> Astro is pinned to 7.4.1 because later versions require Node ≥ 22.23.4.
