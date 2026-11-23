import { describe, expect, it } from 'vitest'
import { countryFrom, dashboardAuthorized, MAX_BYTES, parseReport } from './telemetry'

const report = {
  schema: 1,
  instanceId: '3f2b8c1e-4a5d-4e6f-9a0b-1c2d3e4f5a6b',
  sentAt: '2026-11-24T10:00:00.000Z',
  since: '2026-11-23T10:00:00.000Z',
  install: { version: '0.3.0', channel: 'stable', mode: 'docker-compose', os: 'linux', arch: 'x64', node: '22', postgres: '17', redis: true, inlineWorker: true, installDays: 3 },
  config: { google: false, github: true, smtp: true },
  size: { users: 4, collections: 10 },
  usage: { requestsSent: 120, 'runs.app': 3, 'import.openapi-3': 1, 'mcp.listar_workspaces': 2 },
  errors: { 'POST /api/workspaces/:ws/import 500': 1 },
}

const body = (r: unknown) => JSON.stringify(r)

describe('colector de telemetría', () => {
  it('acepta un informe válido', () => {
    const r = parseReport(body(report))
    expect(r.ok).toBe(true)
  })

  it('rechaza JSON roto, esquemas desconocidos y cuerpos enormes', () => {
    expect(parseReport('{')).toMatchObject({ ok: false, status: 400 })
    expect(parseReport(body({ ...report, schema: 2 }))).toMatchObject({ ok: false, status: 400 })
    expect(parseReport('x'.repeat(MAX_BYTES + 1))).toMatchObject({ ok: false, status: 413 })
  })

  it('no admite texto libre: ni en claves, ni en valores', () => {
    expect(parseReport(body({ ...report, usage: { 'import.ana@empresa.com': 1 } })).ok).toBe(false)
    expect(parseReport(body({ ...report, install: { ...report.install, version: 'https://x.example/?q=1' } })).ok).toBe(false)
    expect(parseReport(body({ ...report, size: { users: 'muchos' } })).ok).toBe(false)
    expect(parseReport(body({ ...report, config: { smtp: 'smtp://user:pass@host' } })).ok).toBe(false)
    expect(parseReport(body({ ...report, instanceId: 'mi-servidor' })).ok).toBe(false)
  })

  it('el país sale de Vercel y nunca de la IP', () => {
    expect(countryFrom(new Headers({ 'x-vercel-ip-country': 'ES', 'x-forwarded-for': '1.2.3.4' }))).toBe('ES')
    expect(countryFrom(new Headers({ 'x-forwarded-for': '1.2.3.4' }))).toBeNull()
    expect(countryFrom(new Headers({ 'x-vercel-ip-country': '<script>' }))).toBeNull()
  })

  it('el panel exige la contraseña', () => {
    process.env.TELEMETRY_DASHBOARD_PASSWORD = 'clave-larga'
    const auth = (u: string, p: string) => new Headers({ authorization: `Basic ${btoa(`${u}:${p}`)}` })
    expect(dashboardAuthorized(new Headers())).toBe(false)
    expect(dashboardAuthorized(auth('ismael', 'otra'))).toBe(false)
    expect(dashboardAuthorized(auth('ismael', 'clave-larga'))).toBe(true)
    delete process.env.TELEMETRY_DASHBOARD_PASSWORD
    expect(dashboardAuthorized(auth('ismael', 'clave-larga'))).toBe(false)
  })
})
