import { useQueryClient } from '@tanstack/react-query'
import { Activity, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { qk, useCollections, useEnvironments, useMonitors, useRuns } from '@/api/hooks'
import type { MonitorRow, NotifyTarget } from '@/api/types'
import { confirm } from '@/components/dialogs'
import { Badge, Button, Checkbox, Dialog, Empty, Field, Input, Select, Spinner, Switch, cx, formatMs, timeAgo } from '@/components/ui'
import { RunStatusBadge, RunView } from '../runner/RunView'
import { useWs } from '../workspace/context'
import { locale, t } from "@/i18n";

const PRESETS = [
  { cron: '*/5 * * * *', label: t("Cada 5 minutos") },
  { cron: '*/15 * * * *', label: t("Cada 15 minutos") },
  { cron: '0 * * * *', label: t("Cada hora") },
  { cron: '0 */6 * * *', label: t("Cada 6 horas") },
  { cron: '0 9 * * *', label: t("Cada día a las 9:00") },
  { cron: '0 9 * * 1-5', label: t("Días laborables a las 9:00") },
  { cron: '0 9 * * 1', label: t("Cada lunes a las 9:00") },
]

function cronLabel(c: string) {
  return PRESETS.find((p) => p.cron === c)?.label ?? c
}

export function MonitorsPage() {
  const { ws, canEdit } = useWs()
  const { data: monitors, isLoading } = useMonitors(ws)
  const [selected, setSelected] = useState<string>()
  const [editing, setEditing] = useState<MonitorRow | 'new' | null>(null)
  const current = monitors?.find((m) => m.id === (selected ?? monitors?.[0]?.id))

  return (
    <div className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col border-r border-app bg-soft">
        <div className="flex items-center border-b border-app px-4 py-3">
          <div className="flex-1">
            <h2 className="font-semibold">{t("Monitores")}</h2>
            <p className="text-xs text-muted">{t("Ejecuciones programadas con avisos.")}</p>
          </div>
          {canEdit && (
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing('new')}>
              {t("Nuevo")}</Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {isLoading && <Spinner className="m-3" />}
          {monitors?.length === 0 && <Empty icon={<Activity />} title={t("Sin monitores")}>{t("Comprueba tu API cada pocos minutos y recibe un aviso en Slack, Discord, Telegram, email o webhook si algo falla.")}</Empty>}
          {monitors?.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelected(m.id)}
              className={cx('mb-0.5 flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left', current?.id === m.id ? 'bg-app shadow-sm ring-1 ring-[var(--border)]' : 'hover:bg-muted')}
            >
              <span
                className={cx(
                  'mt-1.5 size-2 shrink-0 rounded-full',
                  !m.enabled ? 'bg-zinc-400' : m.lastStatus === 'passed' ? 'bg-green-500' : m.lastStatus ? 'bg-red-500' : 'bg-blue-400',
                )}
              />
              <div className="min-w-0">
                <div className="truncate font-medium">{m.name}</div>
                <div className="text-xs text-muted">
                  {cronLabel(m.cron)} · {m.collection}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1">{current ? <MonitorDetail key={current.id} monitor={current} onEdit={() => setEditing(current)} /> : !isLoading && <Empty icon={<Activity />} title={t("Elige o crea un monitor")} />}</div>
      {editing && <MonitorDialog monitor={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={setSelected} />}
    </div>
  )
}

function MonitorDetail({ monitor, onEdit }: { monitor: MonitorRow; onEdit: () => void }) {
  const { ws, canEdit } = useWs()
  const { data: runs } = useRuns(ws, { monitorId: monitor.id })
  const [runId, setRunId] = useState<string>()
  const qc = useQueryClient()
  const finished = (runs ?? []).filter((r) => r.status !== 'running')
  const uptime = finished.length ? Math.round((finished.filter((r) => r.status === 'passed').length / finished.length) * 100) : null
  const avg = finished.length ? finished.reduce((a, r) => a + (r.stats?.totalTime ?? 0), 0) / finished.length : 0

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 border-b border-app p-5">
        <div className="flex items-center gap-3">
          <h2 className="flex-1 text-lg font-semibold">{monitor.name}</h2>
          {canEdit && (
            <>
              <Switch
                checked={monitor.enabled}
                onChange={async (v) => {
                  await api.patch(`/api/monitors/${monitor.id}`, { enabled: v })
                  qc.invalidateQueries({ queryKey: qk.monitors(ws) })
                }}
                label={<span className="text-xs text-muted">{monitor.enabled ? t("Activo") : t("Pausado")}</span>}
              />
              <Button
                size="sm"
                variant="outline"
                icon={<Play className="size-3.5" />}
                onClick={async () => {
                  await api.post(`/api/monitors/${monitor.id}/run`)
                  toast.success(t("Ejecución lanzada"))
                  setTimeout(() => qc.invalidateQueries({ queryKey: ['runs', ws] }), 800)
                }}
              >
                {t("Ejecutar ahora")}</Button>
              <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={onEdit}>
                {t("Editar")}</Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 className="size-3.5" />}
                onClick={async () => {
                  if (!(await confirm(t("Eliminar monitor"), t("Se dejará de ejecutar «{0}».", [monitor.name]), { confirm: t("Eliminar"), danger: true }))) return
                  await api.del(`/api/monitors/${monitor.id}`)
                  qc.invalidateQueries({ queryKey: qk.monitors(ws) })
                }}
              />
            </>
          )}
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Card label={t("Frecuencia")} value={cronLabel(monitor.cron)} sub={monitor.timezone} />
          <Card label={t("Disponibilidad")} value={uptime === null ? '—' : `${uptime}%`} sub={t('{0} ejecuciones', [finished.length])} />
          <Card label={t("Duración media")} value={finished.length ? formatMs(avg) : '—'} />
          <Card label={t("Próxima")} value={monitor.nextRunAt ? new Date(monitor.nextRunAt).toLocaleTimeString(locale) : monitor.enabled ? '—' : t('Pausado')} sub={monitor.lastRunAt ? t('Última {0}', [timeAgo(monitor.lastRunAt)]) : undefined} />
        </div>
        {finished.length > 1 && <Sparkline runs={finished.slice(0, 60).reverse()} />}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-72 shrink-0 overflow-y-auto border-r border-app p-2">
          {runs?.length === 0 && <p className="p-3 text-muted">{t("Sin ejecuciones todavía.")}</p>}
          {runs?.map((r) => (
            <button key={r.id} onClick={() => setRunId(r.id)} className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left', runId === r.id ? 'bg-muted' : 'hover:bg-soft')}>
              <RunStatusBadge status={r.status} />
              <span className="flex-1 text-xs">{new Date(r.startedAt).toLocaleString(locale)}</span>
              {r.stats && <span className="text-[11px] text-muted">{formatMs(r.stats.totalTime)}</span>}
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1">{runId ? <RunView key={runId} runId={runId} /> : <Empty title={t("Elige una ejecución para ver el detalle")} />}</div>
      </div>
    </div>
  )
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-app p-3">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 truncate font-semibold">{value}</div>
      {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
    </div>
  )
}

/** Gráfica mínima de duración por ejecución (verde = OK, rojo = fallo). */
function Sparkline({ runs }: { runs: { id: string; status: string; stats: { totalTime: number } | null; startedAt: string }[] }) {
  const max = Math.max(...runs.map((r) => r.stats?.totalTime ?? 0), 1)
  return (
    <div>
      <div className="mb-1 text-[11px] text-muted">{t('Duración de las últimas {0} ejecuciones', [runs.length])}</div>
      <div className="flex h-14 items-end gap-[2px]">
        {runs.map((r) => (
          <div
            key={r.id}
            title={`${new Date(r.startedAt).toLocaleString(locale)} · ${formatMs(r.stats?.totalTime ?? 0)}`}
            className={cx('min-w-[3px] flex-1 rounded-t-sm', r.status === 'passed' ? 'bg-green-500/70' : 'bg-red-500/80')}
            style={{ height: `${Math.max(6, ((r.stats?.totalTime ?? 0) / max) * 100)}%` }}
          />
        ))}
      </div>
    </div>
  )
}

const NOTIFY_TYPES: { id: NotifyTarget['type']; label: string; placeholder: string }[] = [
  { id: 'slack', label: t("Slack"), placeholder: 'https://hooks.slack.com/services/…' },
  { id: 'discord', label: t("Discord"), placeholder: 'https://discord.com/api/webhooks/…' },
  { id: 'telegram', label: t("Telegram"), placeholder: 'TOKEN_DEL_BOT:CHAT_ID' },
  { id: 'email', label: t("Email"), placeholder: 'equipo@ejemplo.com' },
  { id: 'webhook', label: t("Webhook (JSON)"), placeholder: 'https://tu-servicio/aviso' },
]

function MonitorDialog({ monitor, onClose, onSaved }: { monitor?: MonitorRow; onClose: () => void; onSaved: (id: string) => void }) {
  const { ws } = useWs()
  const { data: collections } = useCollections(ws)
  const { data: envs } = useEnvironments(ws)
  const qc = useQueryClient()
  // supportedValuesOf no incluye «UTC»: se añade para que coincida con la zona por defecto
  const tzs = useMemo<string[]>(() => ['UTC', ...((Intl as any).supportedValuesOf?.('timeZone') ?? []).filter((z: string) => z !== 'UTC')], [])
  const [name, setName] = useState(monitor?.name ?? '')
  const [collectionId, setCollectionId] = useState(monitor?.collectionId ?? '')
  const [envId, setEnvId] = useState(monitor?.environmentId ?? '')
  const [cron, setCron] = useState(monitor?.cron ?? '*/15 * * * *')
  const [tz, setTz] = useState(monitor?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC')
  const [notify, setNotify] = useState<NotifyTarget[]>(monitor?.notify ?? [])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!collectionId && collections?.length) setCollectionId(collections[0].id)
  }, [collections])

  const save = async () => {
    setSaving(true)
    try {
      const body = { name: name || t("Monitor"), environmentId: envId || null, cron, timezone: tz, notify: notify.filter((n) => n.target.trim()) }
      const m = monitor
        ? await api.patch<MonitorRow>(`/api/monitors/${monitor.id}`, body)
        : await api.post<MonitorRow>(`/api/workspaces/${ws}/monitors`, { ...body, collectionId })
      qc.invalidateQueries({ queryKey: qk.monitors(ws) })
      onSaved(m.id)
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    const r = await api.post<{ ok: boolean; errors: string[] }>(`/api/workspaces/${ws}/notify/test`, notify.filter((n) => n.target.trim()))
    r.ok ? toast.success(t("Avisos de prueba enviados")) : toast.error(r.errors.join('\n'))
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={monitor ? t("Editar monitor") : t("Nuevo monitor")}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancelar")}</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!collectionId}>
            {t("Guardar")}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("Nombre")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Salud de la API de producción")} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Colección")}>
            <Select value={collectionId} onChange={(e) => setCollectionId(e.target.value)} className="w-full" disabled={!!monitor}>
              {collections?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Entorno")}>
            <Select value={envId} onChange={(e) => setEnvId(e.target.value)} className="w-full">
              <option value="">{t("Ninguno")}</option>
              {envs?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Frecuencia")}>
            <Select value={PRESETS.some((p) => p.cron === cron) ? cron : 'custom'} onChange={(e) => e.target.value !== 'custom' && setCron(e.target.value)} className="w-full">
              {PRESETS.map((p) => (
                <option key={p.cron} value={p.cron}>
                  {p.label}
                </option>
              ))}
              <option value="custom">{t("Personalizada (cron)")}</option>
            </Select>
          </Field>
          <Field label={t("Expresión cron")} hint={t("min hora día mes día-semana")}>
            <Input value={cron} onChange={(e) => setCron(e.target.value)} className="font-mono" />
          </Field>
        </div>
        <Field label={t("Zona horaria")}>
          <Select value={tz} onChange={(e) => setTz(e.target.value)} className="w-full">
            {tzs.map((tItem: string) => (
              <option key={tItem}>{tItem}</option>
            ))}
          </Select>
        </Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{t("Avisos")}</span>
            <div className="flex gap-2">
              {notify.length > 0 && (
                <button onClick={test} className="text-xs text-brand-700 hover:underline dark:text-brand-400">
                  {t("Enviar prueba")}</button>
              )}
              <button onClick={() => setNotify([...notify, { type: 'slack', target: '', onlyOnFailure: true }])} className="text-xs text-brand-700 hover:underline dark:text-brand-400">
                {t("+ Añadir aviso")}</button>
            </div>
          </div>
          {notify.length === 0 && <p className="text-xs text-muted">{t("Sin avisos: solo verás los resultados en Cartero.")}</p>}
          <div className="space-y-2">
            {notify.map((n, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select value={n.type} onChange={(e) => setNotify(notify.map((x, j) => (j === i ? { ...x, type: e.target.value as NotifyTarget['type'] } : x)))} className="w-32">
                  {NOTIFY_TYPES.map((tItem) => (
                    <option key={tItem.id} value={tItem.id}>
                      {tItem.label}
                    </option>
                  ))}
                </Select>
                <Input
                  value={n.target}
                  placeholder={NOTIFY_TYPES.find((tItem) => tItem.id === n.type)?.placeholder}
                  onChange={(e) => setNotify(notify.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))}
                  className="flex-1 font-mono text-xs"
                />
                <Checkbox checked={!!n.onlyOnFailure} onChange={(v) => setNotify(notify.map((x, j) => (j === i ? { ...x, onlyOnFailure: v } : x)))} label={<span className="text-xs whitespace-nowrap">{t("Solo fallos")}</span>} />
                <button onClick={() => setNotify(notify.filter((_, j) => j !== i))} className="text-muted hover:text-red-500" aria-label={t("Quitar aviso")}>
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
          {notify.some((n) => n.type === 'email') && <Badge tone="amber" className="mt-2">{t("El email necesita SMTP_URL configurado en el servidor")}</Badge>}
        </div>
      </div>
    </Dialog>
  )
}
