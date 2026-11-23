import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://cartero.elrincondeisma.com',
  i18n: {
    locales: ['es', 'en'],
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: false },
  },
  integrations: [sitemap({ i18n: { defaultLocale: 'en', locales: { es: 'es-ES', en: 'en-US' } } })],
  vite: {
    plugins: [tailwindcss()],
    // Vista previa accesible por Tailscale
    preview: { allowedHosts: ['.ts.net', 'localhost'] },
    server: { allowedHosts: ['.ts.net', 'localhost'] },
  },
})
