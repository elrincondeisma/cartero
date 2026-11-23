import type { APIRoute } from 'astro'
import { countryFrom, MAX_BYTES, parseReport, storeReport } from '../../lib/telemetry'

// Se ejecuta en Vercel (función), no se genera al compilar
export const prerender = false

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Recibe el informe diario de una instalación de Cartero. */
export const POST: APIRoute = async ({ request }) => {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BYTES) return json(413, { error: 'too-large' })
  const parsed = parseReport(await request.text())
  if (!parsed.ok) return json(parsed.status, { error: parsed.error })
  try {
    const stored = await storeReport(parsed.report, countryFrom(request.headers))
    return json(202, { ok: true, stored })
  } catch {
    return json(503, { error: 'unavailable' })
  }
}

export const ALL: APIRoute = () => json(405, { error: 'method-not-allowed' })
