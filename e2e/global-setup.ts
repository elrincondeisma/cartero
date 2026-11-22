/**
 * Deja la instancia de pruebas (:3201) instalada, como si alguien hubiera pasado el asistente:
 * una cuenta admin, registro abierto y el asistente terminado. Así las pruebas pueden registrarse.
 */
export default async function globalSetup() {
  if (process.env.E2E_URL) return // pruebas contra una instancia externa: no se toca
  const base = 'http://127.0.0.1:3201'
  const r = await fetch(`${base}/api/setup/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Admin E2E', email: 'admin@e2e.test', password: 'password123', publicUrl: base }),
  })
  if (r.status === 409) return
  if (!r.ok) throw new Error(`No se pudo preparar la instancia de pruebas: ${r.status} ${await r.text()}`)
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0]
  const s = await fetch(`${base}/api/admin/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ setupCompleted: true, allowRegistration: true }),
  })
  if (!s.ok) throw new Error(`No se pudo terminar la instalación de pruebas: ${s.status}`)
}
