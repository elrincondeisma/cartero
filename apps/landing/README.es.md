> 🌐 [English](README.md) · **Español**

# Landing de Cartero

Web estática en Astro, en inglés (`/`) y español (`/es/`).

```bash
pnpm --filter @cartero/landing dev       # http://localhost:4321
pnpm --filter @cartero/landing build     # genera dist/ (HTML estático)
```

Al publicarla, define:

| Variable | Para qué |
|---|---|
| `SITE_URL` | Dominio final (canonical, hreflang, sitemap y Open Graph). Por defecto `https://cartero.elrincondeisma.com` |
| `PUBLIC_REPO_URL` | URL del repositorio en GitHub |

`dist/` se sirve en cualquier hosting estático: GitHub Pages, Cloudflare Pages, Netlify o un Nginx.

- **Textos:** en `src/i18n/ui.ts`. Para añadir un idioma, añade su bloque ahí, su ruta en `src/pages/<idioma>/` y el idioma en `astro.config.mjs`.
- **Vídeo de la hero:** `public/video/cartero-{es,en}.mp4`, generado desde `video/` con `pnpm render:all`.
- **Capturas:** son reales y se regeneran con la app en marcha:

```bash
PW_CHROMIUM=/ruta/a/chrome npx playwright test -c playwright.screens.config.ts   # src/assets/screens/*.png
CAPTURE_LANG=en PW_CHROMIUM=/ruta/a/chrome npx playwright test -c playwright.screens.config.ts   # src/assets/screens/en/*.png
node scripts/og-image.mjs                                                      # public/og.png
```

> Astro está fijado en 7.4.1 porque las versiones posteriores exigen Node ≥ 22.23.4.
