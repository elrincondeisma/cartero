import { defineConfig } from '@playwright/test'

/**
 * Por defecto las pruebas levantan sus propias instancias aisladas (scripts/e2e-servers.sh):
 * nunca tocan la base de datos de desarrollo. Con E2E_URL se prueban contra una instancia que ya esté en marcha.
 */
const external = process.env.E2E_URL

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  webServer: external
    ? undefined
    : [
        { command: 'bash scripts/e2e-servers.sh', url: 'http://127.0.0.1:3201/api/health', timeout: 180_000, reuseExistingServer: false },
        // Lo arranca la línea anterior; esta solo espera a que responda
        { command: 'sleep 86400', url: 'http://127.0.0.1:3202/api/health', timeout: 180_000, reuseExistingServer: true },
      ],
  use: {
    baseURL: external ?? 'http://127.0.0.1:3201',
    viewport: { width: 1440, height: 900 },
    // La app detecta el idioma del navegador: los tests base van en español
    locale: 'es-ES',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // Permite reutilizar un Chromium ya instalado (PW_CHROMIUM=/ruta/a/chrome)
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
})
