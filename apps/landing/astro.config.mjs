import { readdirSync } from 'node:fs'
import sitemap from '@astrojs/sitemap'
import starlight from '@astrojs/starlight'
import vercel from '@astrojs/vercel'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'
import { GROUPS } from './scripts/docs-groups.mjs'

// Número de capítulo → slug de la página (el nombre en inglés de docs/manual, sin el número)
const slugs = Object.fromEntries(
  readdirSync(new URL('../../docs/manual', import.meta.url))
    .filter((f) => /^\d\d-.+\.md$/.test(f))
    .map((f) => [f.slice(0, 2), f.slice(3, -3)]),
)

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://cartero.elrincondeisma.com',
  // Todo es estático salvo el colector de telemetría y su panel (prerender = false)
  adapter: vercel(),
  // Starlight toma de aquí los idiomas: inglés en /docs y español en /es/docs
  i18n: {
    locales: ['en', 'es'],
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    starlight({
      title: { en: 'Cartero docs', es: 'Manual de Cartero' },
      logo: { src: './src/assets/logo.svg', alt: 'Cartero' },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/docs.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/elrincondeisma/cartero' }],
      lastUpdated: false,
      sidebar: [
        { label: 'Overview', translations: { es: 'Inicio' }, slug: 'docs' },
        ...GROUPS.map((g) => ({
          label: g.en,
          translations: { es: g.es },
          items: g.items.map((n) => ({ slug: `docs/${slugs[n]}` })),
        })),
      ],
    }),
    sitemap({ i18n: { defaultLocale: 'en', locales: { es: 'es-ES', en: 'en-US' } } }),
  ],
  vite: {
    plugins: [tailwindcss()],
    // Vista previa accesible por Tailscale
    preview: { allowedHosts: ['.ts.net', 'localhost'] },
    server: { allowedHosts: ['.ts.net', 'localhost'] },
  },
})
