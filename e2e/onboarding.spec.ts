import { expect, test } from '@playwright/test'

const shot = async (page: import('@playwright/test').Page, name: string) => {
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png` })
}

test('bienvenida con datos de ejemplo, recorrido, paleta, manual y MCP', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/register')
  await page.getByLabel('Nombre').fill('Marta Onboarding')
  await page.getByLabel('Email').fill(`onb-${Date.now()}@test.dev`)
  await page.getByLabel('Contraseña').fill('password123')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()

  // Asistente de bienvenida
  await expect(page.getByRole('heading', { name: '¡Hola, Marta!' })).toBeVisible()
  await shot(page, '20-bienvenida')
  await page.getByRole('button', { name: /Ver un ejemplo completo/ }).click()
  await expect(page.getByText('Preparando el workspace de ejemplo')).toBeVisible()
  await page.waitForTimeout(2500)
  await shot(page, '21-cargando-demo')

  // Al terminar entra en «Demo Cartero» y arranca el recorrido
  await expect(page.getByRole('dialog', { name: 'Recorrido guiado' })).toBeVisible({ timeout: 180_000 })
  await expect(page.getByRole('button', { name: /Demo Cartero/ })).toBeVisible()
  await shot(page, '22-tour-inicio')
  const titles: string[] = []
  for (let i = 0; i < 9; i++) {
    titles.push((await page.getByRole('dialog', { name: 'Recorrido guiado' }).locator('h3').textContent())!)
    if (i === 2 || i === 5) await page.waitForTimeout(450) // fin de la animación
    if (i === 2) await shot(page, '23-tour-colecciones')
    if (i === 5) await shot(page, '24-tour-entornos')
    await page.getByRole('dialog', { name: 'Recorrido guiado' }).getByRole('button', { name: /Siguiente|Empezar/ }).click()
  }
  expect(titles).toContain('Tus colecciones')
  await expect(page.getByRole('dialog', { name: 'Recorrido guiado' })).toBeHidden()

  // El árbol tiene las colecciones de ejemplo
  await expect(page.locator('aside').getByText('Blog — JSONPlaceholder')).toBeVisible()
  await expect(page.locator('aside').getByText('Petstore — importada de OpenAPI')).toBeVisible()

  // Paleta de comandos: buscar y abrir una petición
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Busca peticiones/).fill('tiempo actual')
  await shot(page, '25-paleta')
  await page.keyboard.press('Enter')
  await expect(page.locator('input[value="2. Tiempo actual"]')).toBeVisible()

  // Activar un entorno desde la paleta y enviarla
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Busca peticiones/).fill('activar madrid')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expect(page.getByText('200 OK')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /^Tests \(2\/2\)/ }).click()
  await shot(page, '26-clima')

  // Vistazo rápido a las variables
  await page.getByRole('button', { name: 'Ver variables' }).click()
  await expect(page.getByText('ciudad', { exact: true })).toBeVisible()
  await shot(page, '27-variables')
  await page.keyboard.press('Escape')

  // Atajos
  await page.locator('body').click({ position: { x: 700, y: 600 } })
  await page.keyboard.press('?')
  await expect(page.getByRole('heading', { name: 'Atajos de teclado' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Ajustes → Conectar IA (MCP)
  await page.getByRole('button', { name: 'Ayuda' }).click()
  await page.getByRole('menuitem', { name: 'Conectar con IA (MCP)' }).click()
  await page.getByRole('button', { name: 'Crear token para el asistente' }).click()
  await expect(page.getByText('claude mcp add --transport http cartero')).toBeVisible()
  await expect(page.locator('pre').filter({ hasText: 'crt_' }).first()).toBeVisible()
  await shot(page, '28-mcp')

  // Ajustes → Workspace: datos de ejemplo cargados
  await page.getByRole('button', { name: 'Workspace', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Quitar datos de ejemplo' })).toBeVisible()

  // Manual
  await page.goto('/ayuda')
  await expect(page.getByRole('heading', { name: 'Primeros pasos', level: 1 })).toBeVisible()
  await page.getByPlaceholder('Buscar en el manual').fill('x-mock-response-code')
  await page.getByRole('link', { name: /Mock servers/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Mock servers', level: 1 })).toBeVisible()
  await shot(page, '29-manual')
  await page.getByRole('link', { name: /Siguiente/ }).click()
  await expect(page.getByRole('heading', { name: 'Monitores', level: 1 })).toBeVisible()

  // Quitar los datos de ejemplo
  await page.goto('/')
  await page.getByLabel('Ajustes', { exact: true }).click()
  await page.getByRole('button', { name: 'Quitar datos de ejemplo' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Quitar' }).click()
  await expect(page.getByText('Datos de ejemplo eliminados')).toBeVisible({ timeout: 30_000 })

  expect(errors).toEqual([])
})
