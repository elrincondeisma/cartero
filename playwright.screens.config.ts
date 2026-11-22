import { defineConfig } from '@playwright/test'

/** Capturas para la landing: npx playwright test -c playwright.screens.config.ts */
export default defineConfig({
  testDir: './scripts',
  testMatch: /capture-screens\.ts/,
  timeout: 300_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_URL ?? 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
})
