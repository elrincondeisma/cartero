import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://cartero.dev',
  i18n: {
    locales: ['es', 'en'],
    defaultLocale: 'es',
    routing: { prefixDefaultLocale: false },
  },
  integrations: [sitemap({ i18n: { defaultLocale: 'es', locales: { es: 'es-ES', en: 'en-US' } } })],
  vite: {
    plugins: [tailwindcss()],
    // Vista previa accesible por Tailscale
    preview: { allowedHosts: ['.ts.net', 'localhost'] },
    server: { allowedHosts: ['.ts.net', 'localhost'] },
  },
})
