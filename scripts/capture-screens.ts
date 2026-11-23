import { type Page, expect, test } from '@playwright/test'

/**
 * Capturas reales para la landing, en español o inglés:
 *   PW_CHROMIUM=… npx playwright test -c playwright.screens.config.ts
 *   CAPTURE_LANG=en PW_CHROMIUM=… npx playwright test -c playwright.screens.config.ts
 */
const EN = process.env.CAPTURE_LANG === 'en'
const L = (es: string, en: string) => (EN ? en : es)
const OUT = `apps/landing/src/assets/screens${EN ? '/en' : ''}`

test.use({ locale: EN ? 'en-US' : 'es-ES' })

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/${name}.png` })
}

/** Solo el área principal (sin raíl ni barra superior): más legible en la landing. */
async function shotMain(page: Page, name: string) {
  await page.waitForTimeout(500)
  await page.locator('main').screenshot({ path: `${OUT}/${name}.png` })
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  if ((theme === 'dark') !== isDark) await page.getByRole('button', { name: L('Cambiar tema', 'Toggle theme') }).click()
}

async function openRequest(page: Page, collection: string, folder: string | null, name: string) {
  await page.getByLabel(L('Colecciones', 'Collections'), { exact: true }).click()
  const aside = page.locator('aside')
  const item = aside.getByText(name, { exact: true })
  if (!(await item.isVisible())) {
    const parent = folder ? aside.getByText(folder, { exact: true }) : item
    if (!(await parent.isVisible())) await aside.getByText(collection, { exact: true }).click()
    if (folder && !(await item.isVisible())) await aside.getByText(folder, { exact: true }).click()
  }
  await item.click()
}

test('capturas de la landing', async ({ page }) => {
  // Cuenta nueva con la demo cargada por la API
  await page.goto('/register')
  await page.getByLabel(L('Nombre', 'Name')).fill(L('Ana García', 'Alex Morgan'))
  await page.getByLabel('Email').fill(`screens-${Date.now()}@test.dev`)
  await page.getByLabel(L('Contraseña', 'Password')).fill('password123')
  await page.getByRole('button', { name: L('Crear cuenta', 'Create account') }).click()
  await page.getByRole('button', { name: L('Saltar', 'Skip') }).click()
  await page.evaluate(async (lang) => {
    await fetch('/api/auth/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { welcomed: true, tourDone: true } }) })
    await fetch('/api/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang }) })
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500))
      const s = await (await fetch('/api/demo')).json()
      if (s.status === 'done') return location.assign(`/w/${s.workspaceId}`)
      if (s.status === 'error') throw new Error(s.error)
    }
  }, EN ? 'en' : 'es')
  await expect(page.getByRole('button', { name: /Demo Cartero/ })).toBeVisible({ timeout: 180_000 })
  await page.evaluate(() => localStorage.setItem('cartero-ui', JSON.stringify({ state: { section: 'collections', activeEnv: {}, sidebarWidth: 290, responseHeight: 0.55, expanded: {} }, version: 0 })))
  await page.reload()

  await page.getByLabel(L('Entorno activo', 'Active environment')).selectOption({ label: 'Madrid' })

  const blog = 'Blog — JSONPlaceholder'
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    await openRequest(page, blog, L('Usuarios', 'Users'), L('Obtener usuario', 'Get user'))
    await page.getByRole('button', { name: L('Enviar', 'Send'), exact: true }).click()
    await expect(page.getByText('200 OK')).toBeVisible({ timeout: 20_000 })
    await shot(page, `request-${theme}`)
  }
  await setTheme(page, 'light')
  await page.setViewportSize({ width: 1280, height: 780 })

  // Tests y consola (clima)
  await openRequest(page, L('Clima — Open-Meteo', 'Weather — Open-Meteo'), null, L('2. Tiempo actual', '2. Current weather'))
  await page.getByRole('button', { name: L('Enviar', 'Send'), exact: true }).click()
  await expect(page.getByText('200 OK')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /^Tests \(/ }).click()
  await page.locator('main').getByRole('button', { name: /^Scripts/ }).click()
  await page.getByRole('button', { name: 'Post-response' }).click()
  await shotMain(page, 'scripts')

  // Runner
  await page.locator('aside').getByText(blog, { exact: true }).hover()
  await page.locator('aside').getByRole('button', { name: L('Acciones', 'Actions') }).first().click()
  await page.getByRole('menuitem', { name: L('Ejecutar colección', 'Run collection') }).click()
  await page.getByRole('button', { name: L('Ejecutar', 'Run') + ' 10' }).click()
  await expect(page.getByRole('button', { name: L('Exportar JSON', 'Export JSON') })).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: new RegExp(L('Crear post', 'Create post')) }).first().click()
  await shotMain(page, 'runner')

  // Contrato: generarlo desde una respuesta real y romperlo
  await openRequest(page, blog, L('Usuarios', 'Users'), L('Obtener usuario', 'Get user'))
  await page.getByRole('button', { name: L('Enviar', 'Send'), exact: true }).click()
  await expect(page.getByText('200 OK')).toBeVisible({ timeout: 20_000 })
  await page.locator('main').getByRole('button', { name: L('Contrato', 'Contract'), exact: true }).first().click()
  await page.getByRole('button', { name: L('Generar desde la última respuesta', 'Generate from last response') }).first().click()
  await page.keyboard.press('Control+s')
  await page.getByRole('button', { name: L('Enviar', 'Send'), exact: true }).click()
  await expect(page.getByText(L('Cumple el contrato', 'Matches the contract'))).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })
  await shotMain(page, 'contract')
  // El id pasa a texto y se pide un campo que la API no manda
  await page.locator('input[value="id"]').locator('xpath=../..').getByLabel(L('Tipo', 'Type')).selectOption('string')
  await page.getByRole('button', { name: L('Campo', 'Field'), exact: true }).last().click()
  await page.getByRole('button', { name: L('Enviar', 'Send'), exact: true }).click()
  const fails = L('Contrato: 2 fallos', 'Contract: 2 failures')
  await expect(page.getByText(fails)).toBeVisible({ timeout: 20_000 })
  await page.getByText(fails).click()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })
  await shotMain(page, 'contract-fail')

  // Colaboración
  await openRequest(page, blog, 'Posts', L('Crear post', 'Create post'))
  await page.getByRole('button', { name: L('Comentarios y cambios', 'Comments and changes') }).click()
  await expect(page.getByText(L('¿Validamos también', 'Should we also check'), { exact: false })).toBeVisible()
  await shotMain(page, 'collab')

  // Paleta de comandos
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(L('Busca peticiones', 'Search requests'), { exact: false }).fill('post')
  await shot(page, 'palette')
  await page.keyboard.press('Escape')

  // Importar
  await page.getByLabel(L('Colecciones', 'Collections'), { exact: true }).click()
  await page.locator('[data-tour="import"]').click()
  await shot(page, 'import')
  await page.keyboard.press('Escape')

  // Mock servers
  await page.getByLabel('Mock servers', { exact: true }).click()
  await expect(page.getByText(L('Llamadas recibidas', 'Incoming calls'), { exact: false })).toBeVisible()
  await shotMain(page, 'mocks')

  // Monitores
  await page.getByLabel(L('Monitores', 'Monitors'), { exact: true }).click()
  await page.getByText(L('Salud de httpbin', 'httpbin health')).click()
  await page.locator('main').getByRole('button', { name: /OK/ }).first().click({ timeout: 30_000 })
  await shotMain(page, 'monitors')

  // MCP
  await page.getByLabel(L('Ajustes', 'Settings'), { exact: true }).click()
  await page.getByRole('button', { name: L('Conectar IA (MCP)', 'Connect AI (MCP)'), exact: true }).click()
  await shotMain(page, 'mcp')

  // Documentación publicada
  const slug = await page.evaluate(async () => {
    const ws = (await (await fetch('/api/workspaces')).json()).find((w: any) => w.name === 'Demo Cartero').id
    const cols = await (await fetch(`/api/workspaces/${ws}/collections`)).json()
    const b = cols.find((c: any) => c.name === 'Blog — JSONPlaceholder')
    return (await (await fetch(`/api/collections/${b.id}/docs`)).json()).slug
  })
  await page.goto(`/docs/${slug}`)
  await expect(page.getByRole('heading', { name: blog, level: 1 })).toBeVisible()
  await shot(page, 'docs')

  // Limpieza
  await page.goto('/')
  await page.evaluate(() => fetch('/api/demo', { method: 'DELETE' }))
})
