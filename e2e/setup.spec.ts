import { expect, test } from '@playwright/test'

/**
 * Asistente de instalación de principio a fin, en la instancia VACÍA que levanta scripts/e2e-servers.sh (:3202).
 * Contra otra instancia vacía: SETUP_BASE_URL=http://… npx playwright test e2e/setup.spec.ts
 * Con SHOTS_DIR guarda una captura de cada paso.
 */
const base = process.env.SETUP_BASE_URL ?? (process.env.E2E_URL ? undefined : 'http://127.0.0.1:3202')
const shots = process.env.SHOTS_DIR
test.skip(!base, 'Necesita una instancia vacía (SETUP_BASE_URL)')
test.use({ baseURL: base, locale: 'es-ES', viewport: { width: 1440, height: 900 } })

test('instalación paso a paso en una instancia nueva', async ({ page }) => {
  test.setTimeout(120_000)
  const shot = async (name: string) => {
    await page.waitForTimeout(700)
    if (shots) await page.screenshot({ path: `${shots}/setup-${name}.png` })
  }
  const next = () => page.getByRole('button', { name: 'Continuar' }).click()

  // Cualquier ruta lleva al asistente
  await page.goto('/login')
  await expect(page).toHaveURL(/\/setup$/)
  await expect(page.getByRole('heading', { name: 'Vamos a dejar Cartero listo' })).toBeVisible()
  await expect(page.getByText('Estás usando la clave de cifrado de desarrollo')).toBeVisible()
  await shot('1-bienvenida')
  await page.getByRole('button', { name: 'Empezar' }).click()

  // Cuenta de administrador
  await expect(page.getByRole('heading', { name: 'Crea la cuenta de administrador' })).toBeVisible()
  await page.getByLabel('Nombre').fill('Ada Lovelace')
  await page.getByLabel('Email').fill('ada@empresa.com')
  await page.getByLabel('Contraseña').fill('Sup3r-secret!')
  await shot('2-admin')
  await page.getByRole('button', { name: 'Crear cuenta y continuar' }).click()

  // Instancia: la URL detectada ya viene puesta
  await expect(page.getByRole('heading', { name: 'Tu instancia' })).toBeVisible()
  await expect(page.getByLabel('URL pública')).toHaveValue(new URL(base!).origin)
  await page.getByLabel('Nombre de la instancia').fill('Acme APIs')
  await shot('3-instancia')
  await next()

  // Acceso: solo la empresa
  await expect(page.getByRole('heading', { name: '¿Quién puede crear una cuenta?' })).toBeVisible()
  await page.getByRole('radio', { name: /Solo mi empresa/ }).click()
  await page.getByLabel('Dominios permitidos').fill('empresa.com')
  await shot('4-acceso')
  await next()

  // Google y GitHub: se salta
  await expect(page.getByRole('heading', { name: 'Entrar con Google y GitHub' })).toBeVisible()
  await expect(page.getByText(`${new URL(base!).origin}/api/auth/oauth/google/callback`).or(page.locator(`input[value="${new URL(base!).origin}/api/auth/oauth/google/callback"]`))).toBeVisible()
  await shot('5-social')
  await page.getByRole('button', { name: 'Saltar este paso' }).click()

  // Email: más tarde
  await expect(page.getByRole('heading', { name: 'Email' })).toBeVisible()
  await shot('6-email')
  await page.getByRole('button', { name: 'Lo haré más tarde' }).click()

  // Seguridad: expuesta a Internet
  await expect(page.getByRole('heading', { name: '¿Dónde va a estar Cartero?' })).toBeVisible()
  await page.getByRole('radio', { name: /Expuesta a Internet/ }).click()
  await shot('7-seguridad')
  await next()

  // Resumen
  await expect(page.getByRole('heading', { name: '¡Cartero está listo!' })).toBeVisible()
  await expect(page.getByText('Acme APIs')).toBeVisible()
  await expect(page.getByText('Solo empresa.com')).toBeVisible()
  await expect(page.getByText('Bloqueadas')).toBeVisible()
  await shot('8-listo')
  await page.getByRole('button', { name: 'Entrar en Cartero' }).click()

  // Dentro: bienvenida de la app y los ajustes guardados en Administración
  await expect(page.getByRole('heading', { name: /Hola, Ada/ })).toBeVisible()
  await page.goto('/admin?tab=security')
  await expect(page.getByRole('radio', { name: /Expuesta a Internet/ })).toHaveAttribute('aria-checked', 'true')
  await shot('9-admin-seguridad')
  await page.getByRole('tab', { name: 'Sistema' }).click()
  await expect(page.getByText('Clave de desarrollo')).toBeVisible()
  await shot('10-admin-sistema')

  // Ya instalada: /setup ya no crea cuentas y el registro respeta el dominio
  const r = await page.request.post('/api/setup/admin', { data: { name: 'X', email: 'x@otra.com', password: 'password123' } })
  expect(r.status()).toBe(409)
  const reg = await page.request.post('/api/auth/register', { data: { name: 'X', email: 'x@otra.com', password: 'password123' } })
  expect(reg.status()).toBe(403)
})
