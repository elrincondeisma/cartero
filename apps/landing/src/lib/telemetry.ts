/**
 * Colector de la telemetría anónima de Cartero: validación del informe y acceso a Neon.
 * El formato lo define apps/server/src/lib/telemetry.ts (schema 1). Aquí solo se aceptan claves
 * técnicas y números, para que no se pueda colar texto libre aunque alguien envíe un informe a mano.
 */
import { neon } from '@neondatabase/serverless'
import { z } from 'zod'

export const MAX_BYTES = 32 * 1024
/** Como mucho un informe por instancia en este intervalo (las instancias envían uno al día) */
export const MIN_INTERVAL_HOURS = 6

const key = z.string().regex(/^[a-z0-9_.:/ -]{1,120}$/i)
const count = z.number().int().min(0).max(1e12)
const counts = z.record(key, count).refine((r) => Object.keys(r).length <= 400, 'demasiadas claves')

export const reportSchema = z.object({
  schema: z.literal(1),
  instanceId: z.uuid(),
  sentAt: z.iso.datetime(),
  since: z.iso.datetime(),
  install: z
    .record(key, z.union([z.string().max(60).regex(/^[a-z0-9._+-]*$/i), z.number(), z.boolean(), z.null()]))
    .refine((r) => Object.keys(r).length <= 40, 'demasiadas claves')
    .refine((r) => typeof r.version === 'string' && typeof r.mode === 'string', 'faltan version o mode'),
  config: z.record(key, z.boolean()).refine((r) => Object.keys(r).length <= 40, 'demasiadas claves'),
  size: counts,
  usage: counts,
  errors: counts,
})

export type Report = z.infer<typeof reportSchema>

export type ParseResult = { ok: true; report: Report } | { ok: false; status: number; error: string }

/** Valida el cuerpo crudo de la petición. */
export function parseReport(body: string): ParseResult {
  if (body.length > MAX_BYTES) return { ok: false, status: 413, error: 'too-large' }
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return { ok: false, status: 400, error: 'invalid-json' }
  }
  const r = reportSchema.safeParse(json)
  if (!r.success) return { ok: false, status: 400, error: 'invalid-report' }
  return { ok: true, report: r.data }
}

/** País de Vercel (dos letras) o null. La IP no se lee nunca. */
export function countryFrom(headers: Headers): string | null {
  const c = headers.get('x-vercel-ip-country')
  return c && /^[A-Z]{2}$/.test(c) ? c : null
}

export function sql() {
  const url = process.env.DATABASE_URL ?? import.meta.env.DATABASE_URL
  if (!url) throw new Error('Falta DATABASE_URL')
  return neon(url)
}

/** Guarda el informe. Devuelve false si la instancia ya envió uno hace poco (se descarta). */
export async function storeReport(report: Report, country: string | null): Promise<boolean> {
  const db = sql()
  const recent = await db.query(
    `select 1 from telemetry_reports where instance_id = $1 and received_at > now() - make_interval(hours => $2) limit 1`,
    [report.instanceId, MIN_INTERVAL_HOURS],
  )
  if (recent.length) return false
  const version = String(report.install.version)
  const mode = String(report.install.mode)
  await db.query(
    `insert into telemetry_instances (id, version, mode, country, last_report)
     values ($1, $2, $3, $4, $5)
     on conflict (id) do update set last_seen = now(), version = $2, mode = $3, country = $4, last_report = $5`,
    [report.instanceId, version, mode, country, JSON.stringify(report)],
  )
  await db.query(`insert into telemetry_reports (instance_id, country, payload) values ($1, $2, $3)`, [
    report.instanceId,
    country,
    JSON.stringify(report),
  ])
  // De vez en cuando, borra los informes de hace más de 13 meses
  if (Math.random() < 0.02) await db.query(`delete from telemetry_reports where received_at < now() - interval '13 months'`)
  return true
}

/** Usuario y contraseña del panel (Basic). La contraseña está en TELEMETRY_DASHBOARD_PASSWORD. */
export function dashboardAuthorized(headers: Headers): boolean {
  const expected = process.env.TELEMETRY_DASHBOARD_PASSWORD ?? import.meta.env.TELEMETRY_DASHBOARD_PASSWORD
  if (!expected) return false
  const h = headers.get('authorization') ?? ''
  if (!h.startsWith('Basic ')) return false
  let decoded = ''
  try {
    decoded = atob(h.slice(6))
  } catch {
    return false
  }
  const pass = decoded.slice(decoded.indexOf(':') + 1)
  // Comparación en tiempo constante
  const a = new TextEncoder().encode(pass)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}
