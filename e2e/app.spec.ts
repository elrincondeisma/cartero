import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const shots = process.env.SHOTS_DIR
const shot = async (page: import('@playwright/test').Page, name: string) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) })
}
const email = `e2e-${Date.now()}@test.dev`

test('flujo completo: registro, importar, enviar, guardar, runner, mock', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => {
    errors.push(e.message)
    console.log('PAGEERROR', e.message, e.stack?.split('\n').slice(0, 4).join(' | '))
  })
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 300)))
  // Registro
  await page.goto('/register')
  await page.getByLabel('Nombre').fill('Ana E2E')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña').fill('password123')
  await shot(page, '01-registro')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await expect(page.getByText('Empieza a probar tu API')).toBeVisible()
  await shot(page, '02-vacio')

  // Importar colección de Postman pegando el JSON
  const fixture = readFileSync(join(import.meta.dirname, '..', 'packages', 'importers', 'fixtures', 'postman-v21.json'), 'utf8')
  const collection = JSON.parse(fixture)
  // Apuntamos baseUrl al propio servidor para tener respuestas reales
  collection.variable = [{ key: 'baseUrl', value: 'http://localhost:3000/api' }]
  await page.getByRole('button', { name: 'Importar' }).first().click()
  await page.getByRole('button', { name: 'Pegar texto' }).click()
  await page.locator('textarea').fill(JSON.stringify(collection))
  await page.getByRole('dialog').getByRole('button', { name: 'Importar' }).click()
  await expect(page.getByText('Demo API')).toBeVisible()

  // Abrir la colección y una petición
  await page.getByText('Demo API').click()
  await page.getByText('Users', { exact: true }).click()
  await page.getByText('List users').click()
  await expect(page.locator('input[value="List users"]')).toBeVisible()
  await shot(page, '03-peticion')

  // Nueva petición suelta contra /api/health
  await page.keyboard.press('Control+t')
  const urlInput = page.getByPlaceholder(/api\.ejemplo\.com/)
  await urlInput.fill('http://localhost:3000/api/health')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expect(page.getByText('200 OK')).toBeVisible()
  await expect(page.locator('.monaco-editor').last()).toContainText('"ok"')
  await shot(page, '04-respuesta')

  // Scripts: test post-response
  await page.getByRole('button', { name: /^Scripts/ }).click()
  await page.getByRole('button', { name: 'Post-response' }).click()
  await page.getByRole('button', { name: 'Código de estado 200' }).click()
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expect(page.getByRole('button', { name: 'Tests (1/1)' })).toBeVisible()
  await page.getByRole('button', { name: 'Tests (1/1)' }).click()
  await expect(page.getByText('Código de estado 200').last()).toBeVisible()
  await shot(page, '05-tests')

  // Guardar en la colección
  await page.getByRole('button', { name: 'Guardar' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').first().fill('Health')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Petición guardada')).toBeVisible()
  await expect(page.locator('aside').getByText('Health', { exact: true })).toBeVisible()

  // cURL pegado en la barra de URL
  await page.keyboard.press('Control+t')
  await page.getByPlaceholder(/api\.ejemplo\.com/).click()
  await page.evaluate(() => {
    const input = document.activeElement as HTMLInputElement
    const dt = new DataTransfer()
    dt.setData('text', `curl -X POST http://localhost:3000/api/health -H 'X-Test: 1' -d '{"a":1}'`)
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await expect(page.getByText('cURL importado')).toBeVisible()
  await expect(page.locator('select[aria-label="Método"]')).toHaveValue('POST')

  // Runner de la colección
  await page.locator('aside').getByText('Demo API').hover()
  await page.locator('aside').getByRole('button', { name: 'Acciones' }).first().click()
  await page.getByRole('menuitem', { name: 'Ejecutar colección' }).click()
  await expect(page.getByText(/peticiones$/).first()).toBeVisible()
  await shot(page, '06-runner')
  await page.getByRole('button', { name: /^Ejecutar \d+/ }).click()
  await expect(page.getByText('Peticiones', { exact: true })).toBeVisible()
  await expect(page.getByText(/^(OK|Fallos)$/).first()).toBeVisible({ timeout: 30_000 })
  await shot(page, '07-run')

  // Entornos
  await page.getByRole('button', { name: 'Entornos' }).click()
  await page.getByRole('button', { name: 'Nuevo entorno' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('Local')
  await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click()
  await expect(page.locator('input[value="Local"]')).toBeVisible()
  await shot(page, '08-entorno')

  // Mock server con los ejemplos
  await page.getByRole('button', { name: 'Mock servers' }).click()
  await page.getByRole('button', { name: 'Nuevo' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click()
  const mockUrl = await page.locator('span.font-mono').filter({ hasText: '/mock/' }).first().textContent()
  expect(mockUrl).toContain('/mock/')
  const res = await request.get(`${mockUrl!.replace('http://localhost:5173', 'http://localhost:3000')}/users`)
  expect(res.status()).toBe(200)
  expect(await res.text()).toBe('[{"id":1}]')
  await page.waitForTimeout(4500)
  await shot(page, '09-mock')

  // Monitores
  await page.getByRole('button', { name: 'Monitores' }).click()
  await page.getByRole('button', { name: 'Nuevo' }).click()
  await page.getByRole('dialog').getByPlaceholder('Salud de la API de producción').fill('Salud')
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Cada 15 minutos').first()).toBeVisible()
  await page.getByRole('button', { name: 'Ejecutar ahora' }).click()
  await page.waitForTimeout(3000)
  await shot(page, '10-monitor')

  // Ajustes
  await page.getByRole('button', { name: 'Ajustes' }).click()
  await page.getByRole('button', { name: 'Tokens de API' }).click()
  await shot(page, '11-ajustes')

  // Tema oscuro
  await page.getByRole('button', { name: 'Colecciones' }).click()
  await page.getByRole('button', { name: 'Cambiar tema' }).click()
  await page.locator('aside').getByText('List users').click()
  await shot(page, '12-oscuro')
})
