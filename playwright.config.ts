import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_URL ?? 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    // La app detecta el idioma del navegador: los tests base van en español
    locale: 'es-ES',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // Permite reutilizar un Chromium ya instalado (PW_CHROMIUM=/ruta/a/chrome)
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
})
