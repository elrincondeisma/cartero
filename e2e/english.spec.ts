import { type Page, expect, test } from '@playwright/test'

test.use({ locale: 'en-US' })

// Palabras que delatan texto en español sin traducir
const SPANISH = /\b(de|del|las|los|para|con|sin|una|petición|peticiones|colección|colecciones|entorno|entornos|guardar|enviar|cancelar|eliminar|crear|nueva|nuevo|ejecutar|ajustes|añadir|también|aquí|está|contraseña|miembros|historial|ejecuciones|monitores|cabeceras|respuesta|Empieza|Importar|Saltar|Buscar|editar|pausado|todas|correctas|última|cada|hace|ahora|carpeta|ejemplo|ejemplos|datos|cambios)\b/i

const shots = process.env.SHOTS_DIR
async function check(page: Page, where: string) {
  await page.waitForTimeout(300)
  const text = await page.evaluate(() => {
    // Ignora editores de código (contenido del usuario) y datos del usuario
    const clone = document.body.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.monaco-editor, [data-user-content]').forEach((n) => n.remove())
    return clone.innerText
  })
  const bad = text.split('\n').filter((l) => SPANISH.test(l))
  expect(bad, `Texto en español en «${where}»`).toEqual([])
  if (shots) await page.screenshot({ path: `${shots}/en-${where}.png` })
}

test('la interfaz completa en inglés', async ({ page }) => {
  test.setTimeout(360_000)
  await page.goto('/register')
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await check(page, 'register')
  await page.getByLabel('Name').fill('Grace Hopper')
  await page.getByLabel('Email').fill(`en-${Date.now()}@test.dev`)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('heading', { name: 'Hi, Grace!' })).toBeVisible()
  await check(page, 'welcome')
  await page.getByRole('button', { name: /Start from scratch/ }).click()

  // Recorrido completo
  const tour = page.getByRole('dialog', { name: 'Guided tour' })
  for (let i = 0; i < 9; i++) {
    await check(page, `tour-${i}`)
    await tour.getByRole('button', { name: /Next|Get started/ }).click()
  }

  await expect(page.getByRole('button', { name: /My workspace/ })).toBeVisible()
  await check(page, 'empty')

  // Petición con respuesta, tests y consola
  await page.keyboard.press('Control+t')
  await page.getByPlaceholder(/api\.example\.com/).fill('http://localhost:3000/api/health')
  await page.getByRole('button', { name: /^Scripts/ }).click()
  await page.getByRole('button', { name: 'Post-response' }).click()
  await page.getByRole('button', { name: 'Status code is 200' }).click()
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('200 OK')).toBeVisible()
  await check(page, 'request')
  for (const tab of ['Headers', 'Cookies', 'Console', 'Details']) {
    await page.getByRole('button', { name: new RegExp(`^${tab}`) }).last().click()
    await check(page, `response-${tab.toLowerCase()}`)
  }
  for (const tab of ['Authorization', 'Body', 'Examples', 'Description', 'Settings']) {
    await page.locator('main').getByRole('button', { name: new RegExp(`^${tab}`) }).first().click()
    await check(page, `editor-${tab.toLowerCase()}`)
  }
  await page.locator('main').getByRole('button', { name: /^Authorization/ }).first().click()
  await page.locator('select').filter({ hasText: 'Inherit from parent' }).selectOption('oauth2')
  await check(page, 'oauth2')

  // Guardar en una colección nueva
  await page.getByRole('button', { name: 'Collections', exact: true }).click().catch(() => {})
  await page.getByLabel('New collection').click()
  await page.getByRole('dialog').getByRole('textbox').fill('My API')
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  await check(page, 'save-dialog')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Request saved')).toBeVisible()

  // Diálogos
  await page.locator('[data-tour="import"]').click()
  await check(page, 'import')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+k')
  await check(page, 'palette')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Help' }).click()
  await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()
  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible()
  await check(page, 'shortcuts')
  await page.keyboard.press('Escape')

  // Runner y run
  await page.locator('aside').getByText('My API').hover()
  await page.locator('aside').getByRole('button', { name: 'Actions' }).first().click()
  await check(page, 'collection-menu')
  await page.getByRole('menuitem', { name: 'Run collection' }).click()
  await check(page, 'runner')
  await page.getByRole('button', { name: /^Run 1 request/ }).click()
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeVisible({ timeout: 30_000 })
  await check(page, 'run')

  // Secciones
  for (const [label, name] of [
    ['Environments', 'environments'],
    ['History', 'history'],
    ['Runs', 'runs'],
    ['Mock servers', 'mocks'],
    ['Monitors', 'monitors'],
  ]) {
    await page.getByLabel(label, { exact: true }).click()
    await check(page, name)
  }
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await check(page, 'monitor-dialog')
  await page.keyboard.press('Escape')

  await page.getByLabel('Settings', { exact: true }).click()
  for (const tab of ['Workspace', 'Members', 'API tokens', 'Connect AI (MCP)', 'My profile']) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    await check(page, `settings-${tab.toLowerCase().replace(/\W+/g, '-')}`)
  }

  // Datos de ejemplo en inglés: pantallas con contenido real
  await page.getByRole('button', { name: 'Workspace', exact: true }).click()
  await page.getByRole('button', { name: 'Load sample data' }).click()
  await expect(page.getByRole('button', { name: /Demo Cartero/ })).toBeVisible({ timeout: 180_000 })
  await page.getByLabel('Monitors', { exact: true }).click()
  await page.getByText('httpbin health').click()
  await page.locator('main').getByRole('button', { name: /OK/ }).first().click({ timeout: 60_000 })
  await check(page, 'monitor-detail')
  await page.getByLabel('Mock servers', { exact: true }).click()
  await expect(page.getByText('Incoming calls')).toBeVisible()
  await check(page, 'mock-detail')
  await page.getByLabel('Runs', { exact: true }).click()
  await page.waitForTimeout(800)
  await check(page, 'runs-list')
  await page.getByLabel('Collections', { exact: true }).click()
  await page.locator('aside').getByText('Weather — Open-Meteo').click()
  await page.locator('aside').getByText('2. Current weather').click()
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('200 OK')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /^Console/ }).click()
  await check(page, 'demo-request')
  await page.getByLabel('Settings', { exact: true }).click()
  await page.getByRole('button', { name: 'Workspace', exact: true }).click()
  await page.getByRole('button', { name: 'Remove sample data' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText('Sample data removed')).toBeVisible({ timeout: 30_000 })

  // Manual en inglés
  await page.goto('/ayuda')
  await expect(page.getByRole('heading', { name: 'Getting started', level: 1 })).toBeVisible()
  await check(page, 'manual')

  // Cambiar a español desde el perfil y volver
  await page.goto('/')
  await page.getByLabel('Settings', { exact: true }).click()
  await page.getByRole('button', { name: 'My profile', exact: true }).click()
  await page.locator('select').filter({ hasText: 'English' }).selectOption('es')
  await expect(page.getByRole('heading', { name: 'Idioma de la interfaz' })).toBeVisible()
  await page.locator('select').filter({ hasText: 'English' }).selectOption('en')
  await expect(page.getByRole('heading', { name: 'Interface language' })).toBeVisible()
})
