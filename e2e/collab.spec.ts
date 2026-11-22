import { type Browser, type Page, expect, test } from '@playwright/test'

async function register(browser: Browser, name: string, email: string, path = '/register') {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(path)
  await page.getByLabel('Nombre').fill(name)
  if (path === '/register') await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña').fill('password123')
  await page.getByRole('button', { name: 'Crear cuenta' }).click()
  await page.getByRole('button', { name: 'Saltar' }).click()
  return page
}

async function openRequest(page: Page, name: string) {
  const item = page.locator('aside').getByText(name, { exact: true })
  if (!(await item.isVisible())) await page.locator('aside').getByText('API compartida').click()
  await item.click()
}

test('colaboración: invitación, presencia, cambios en vivo y conflicto', async ({ browser }) => {
  const stamp = Date.now()
  const ana = await register(browser, 'Ana', `ana-${stamp}@test.dev`)
  await expect(ana.getByText('Empieza a probar tu API')).toBeVisible()

  // Ana crea un workspace de equipo
  await ana.getByRole('button', { name: /Mi workspace/ }).click()
  await ana.getByRole('menuitem', { name: 'Nuevo workspace de equipo' }).click()
  await ana.getByRole('dialog').getByRole('textbox').fill(`Equipo ${stamp}`)
  await ana.getByRole('dialog').getByRole('button', { name: 'Crear' }).click()
  await expect(ana.getByRole('button', { name: new RegExp(`Equipo ${stamp}`) })).toBeVisible()

  // Colección con una petición
  await ana.getByRole('button', { name: 'Nueva colección' }).click()
  await ana.getByRole('dialog').getByRole('textbox').fill('API compartida')
  await ana.getByRole('dialog').getByRole('button', { name: 'Crear' }).click()
  await ana.locator('aside').getByText('API compartida').hover()
  await ana.locator('aside').getByRole('button', { name: 'Acciones' }).first().click()
  await ana.getByRole('menuitem', { name: 'Nueva petición' }).click()
  await ana.getByRole('dialog').getByRole('textbox').fill('Ping')
  await ana.getByRole('dialog').getByRole('button', { name: 'Crear' }).click()
  await expect(ana.locator('input[value="Ping"]')).toBeVisible()

  // Invitar a Bob como editor
  await ana.getByLabel('Ajustes', { exact: true }).click()
  await ana.getByRole('button', { name: 'Miembros' }).click()
  await ana.getByPlaceholder('email@ejemplo.com').fill(`bob-${stamp}@test.dev`)
  await ana.getByRole('button', { name: 'Invitar' }).click()
  const toast = ana.getByText(/\/invite\//).first()
  await expect(toast).toBeVisible()
  const link = (await toast.textContent())!.match(/https?:\/\/\S+\/invite\/\S+/)![0]

  // Bob se registra desde el enlace y entra al workspace
  const bob = await register(browser, 'Bob', '', new URL(link).pathname)
  await expect(bob.getByRole('button', { name: new RegExp(`Equipo ${stamp}`) })).toBeVisible()

  // Ambos abren "Ping": cada uno ve al otro conectado
  await ana.getByLabel('Colecciones', { exact: true }).click()
  await openRequest(ana, 'Ping')
  await openRequest(bob, 'Ping')
  await expect(ana.getByRole('banner').getByText('B', { exact: true })).toBeVisible()
  await expect(bob.getByRole('banner').getByText('A', { exact: true })).toBeVisible()

  // Ana guarda un cambio: a Bob (sin cambios locales) le llega solo
  await ana.getByPlaceholder(/api\.ejemplo\.com/).fill('https://api.ejemplo.com/ping')
  await ana.keyboard.press('Control+s')
  await expect(bob.locator('input[spellcheck="false"]').first()).toHaveValue('https://api.ejemplo.com/ping', { timeout: 10_000 })

  // Bob edita sin guardar; Ana vuelve a guardar → Bob ve el aviso de cambios ajenos
  await bob.getByPlaceholder(/api\.ejemplo\.com/).fill('https://api.ejemplo.com/bob')
  await ana.getByPlaceholder(/api\.ejemplo\.com/).fill('https://api.ejemplo.com/ana')
  await ana.keyboard.press('Control+s')
  await expect(bob.getByRole('button', { name: 'Hay cambios de otra persona' })).toBeVisible({ timeout: 10_000 })

  // Si Bob guarda igualmente, el servidor detecta el conflicto
  await bob.keyboard.press('Control+s')
  await expect(bob.getByText('Otra persona ha guardado cambios en esta petición')).toBeVisible()

  // Bob comenta y Ana lo ve en vivo
  await bob.getByRole('button', { name: 'Comentarios y cambios' }).click()
  await bob.getByPlaceholder(/Escribe un comentario/).fill('¿Cambiamos a /health?')
  await bob.getByRole('button', { name: 'Comentar', exact: true }).click()
  await ana.getByRole('button', { name: 'Comentarios y cambios' }).click()
  await expect(ana.getByText('¿Cambiamos a /health?')).toBeVisible({ timeout: 10_000 })
  if (process.env.SHOTS_DIR) await ana.screenshot({ path: `${process.env.SHOTS_DIR}/14-colaboracion.png` })
})
