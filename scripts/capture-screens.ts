import { type Page, expect, test } from '@playwright/test'

const OUT = 'apps/landing/src/assets/screens'

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
  if ((theme === 'dark') !== isDark) await page.getByRole('button', { name: 'Cambiar tema' }).click()
}

async function openRequest(page: Page, collection: string, folder: string | null, name: string) {
  await page.getByLabel('Colecciones', { exact: true }).click()
  const aside = page.locator('aside')
  const item = aside.getByText(name, { exact: true })
  if (!(await item.isVisible())) {
    const parent = folder ? aside.getByText(folder, { exact: true }) : item
    if (!(await parent.isVisible())) await aside.getByText(collection, { exact: true }).click()
    if (folder && !(await item.isVisible())) await aside.getByText(folder, { exact: true }).click()
  }
  await aside.getByText(name, { exact: true }).click()
}

test('capturas de la landing', async ({ page }) => {
  // Cuenta nueva con la demo cargada por la API
  await page.goto('/register')
  await page.getByLabel('Nombre').fill('Ana García')
  await page.getByLabel('Email').fill(`screens-${Date.now()}@test.dev`)
  await page.getByLabel('Contraseña').fill('password123')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await page.getByRole('button', { name: 'Saltar' }).click()
  await page.evaluate(async () => {
    await fetch('/api/auth/me', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: { welcomed: true, tourDone: true } }) })
    await fetch('/api/demo', { method: 'POST' })
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500))
      const s = await (await fetch('/api/demo')).json()
      if (s.status === 'done') return location.assign(`/w/${s.workspaceId}`)
      if (s.status === 'error') throw new Error(s.error)
    }
  })
  await expect(page.getByRole('button', { name: /Demo Cartero/ })).toBeVisible({ timeout: 180_000 })
  await page.evaluate(() => localStorage.setItem('cartero-ui', JSON.stringify({ state: { section: 'collections', activeEnv: {}, sidebarWidth: 290, responseHeight: 0.55, expanded: {} }, version: 0 })))
  await page.reload()

  // Entorno Madrid activo
  const envSelect = page.getByLabel('Entorno activo')
  await envSelect.selectOption({ label: 'Madrid' })

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    // Hero: petición con respuesta JSON
    await openRequest(page, 'Blog — JSONPlaceholder', 'Usuarios', 'Obtener usuario')
    await page.getByRole('button', { name: 'Enviar' }).click()
    await expect(page.getByText('200 OK')).toBeVisible({ timeout: 20_000 })
    await shot(page, `request-${theme}`)
  }
  await setTheme(page, 'light')
  await page.setViewportSize({ width: 1280, height: 780 })

  // Tests y consola (clima)
  await openRequest(page, 'Clima — Open-Meteo', null, '2. Tiempo actual')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expect(page.getByText('200 OK')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /^Tests \(/ }).click()
  await page.getByRole('button', { name: /^Scripts/ }).click()
  await page.getByRole('button', { name: 'Post-response' }).click()
  await shotMain(page, 'scripts')

  // Runner
  await page.locator('aside').getByText('Blog — JSONPlaceholder', { exact: true }).hover()
  await page.locator('aside').getByRole('button', { name: 'Acciones' }).first().click()
  await page.getByRole('menuitem', { name: 'Ejecutar colección' }).click()
  await page.getByRole('button', { name: /^Ejecutar \d+/ }).click()
  await expect(page.getByRole('button', { name: 'Exportar JSON' })).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: /Crear post/ }).first().click()
  await shotMain(page, 'runner')

  // Colaboración: comentarios en «Crear post»
  await openRequest(page, 'Blog — JSONPlaceholder', 'Posts', 'Crear post')
  await page.getByRole('button', { name: 'Comentarios y cambios' }).click()
  await expect(page.getByText(/Validamos también/)).toBeVisible()
  await shotMain(page, 'collab')

  // Paleta de comandos
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Busca peticiones/).fill('post')
  await shot(page, 'palette')
  await page.keyboard.press('Escape')

  // Importar
  await page.getByLabel('Colecciones', { exact: true }).click()
  await page.locator('[data-tour="import"]').click()
  await shot(page, 'import')
  await page.keyboard.press('Escape')

  // Mock servers
  await page.getByLabel('Mock servers', { exact: true }).click()
  await expect(page.getByText('Llamadas recibidas', { exact: false })).toBeVisible()
  await shotMain(page, 'mocks')

  // Monitores
  await page.getByLabel('Monitores', { exact: true }).click()
  await page.getByText('Salud de httpbin').click()
  await page.locator('main').getByRole('button', { name: /OK/ }).first().click({ timeout: 30_000 })
  await shotMain(page, 'monitors')

  // MCP
  await page.getByLabel('Ajustes', { exact: true }).click()
  await page.getByRole('button', { name: 'Conectar IA (MCP)' }).click()
  await shotMain(page, 'mcp')

  // Documentación publicada
  const slug = await page.evaluate(async () => {
    const ws = (await (await fetch('/api/workspaces')).json()).find((w: any) => w.name === 'Demo Cartero').id
    const cols = await (await fetch(`/api/workspaces/${ws}/collections`)).json()
    const blog = cols.find((c: any) => c.name.startsWith('Blog — JSON'))
    return (await (await fetch(`/api/collections/${blog.id}/docs`)).json()).slug
  })
  await page.goto(`/docs/${slug}`)
  await expect(page.getByRole('heading', { name: 'Blog — JSONPlaceholder', level: 1 })).toBeVisible()
  await shot(page, 'docs')

  // Limpieza
  await page.goto('/')
  await page.evaluate(() => fetch('/api/demo', { method: 'DELETE' }))
})
