import { AlertTriangle, CheckCircle2, Copy, Download, Save, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { ConsoleEntry, Execution, ExecResponse } from '@/api/types'
import { CodeEditor } from '@/components/CodeEditor'
import { Badge, Button, Empty, IconButton, Spinner, SubTabs, Tooltip, cx, formatBytes, formatMs, statusTone } from '@/components/ui'
import { languageForContentType, prettyBody } from '@/lib/request'
import { locale, t, tj } from "@/i18n";

type View = 'body' | 'headers' | 'cookies' | 'tests' | 'console' | 'timeline'

export function ResponsePane({
  execution,
  console: logs,
  loading,
  error,
  onSaveExample,
  onCancel,
}: {
  execution?: Execution | null
  console?: ConsoleEntry[]
  loading?: boolean
  error?: string
  onSaveExample?: () => void
  onCancel?: () => void
}) {
  const [view, setView] = useState<View>('body')
  const res = execution?.response
  const tests = execution?.tests ?? []
  const passed = tests.filter((tItem) => tItem.passed).length

  if (loading)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        <Spinner className="size-6" />
        {t("Enviando petición…")}{onCancel && (
          <Button size="sm" variant="outline" onClick={onCancel}>
            {t("Cancelar")}</Button>
        )}
      </div>
    )
  if (!execution && !error)
    return (
      <Empty title={t("Respuesta")}>
        {tj('Pulsa {enviar} (Ctrl+Enter) para ver aquí la respuesta.', { enviar: <b>{t('Enviar')}</b> })}
      </Empty>
    )

  const scriptErrors = [execution?.prerequestError && t("Error en el script pre-request: {0}", [execution.prerequestError]), execution?.testScriptError && t("Error en el script post-response: {0}", [execution.testScriptError])].filter(Boolean)

  return (
    <div className="flex h-full flex-col">
      <SubTabs
        value={view}
        onChange={setView}
        tabs={[
          { id: 'body', label: t("Body") },
          { id: 'headers', label: t("Cabeceras"), count: res?.headers.length },
          { id: 'cookies', label: t("Cookies"), count: res?.cookies.length },
          { id: 'tests', label: tests.length ? t("Tests ({0}/{1})", [passed, tests.length]) : t("Tests") },
          { id: 'console', label: t("Consola"), count: logs?.length },
          { id: 'timeline', label: t("Detalles") },
        ]}
        right={
          res && (
            <div className="flex items-center gap-3 text-xs">
              <Badge tone={statusTone(res.code)} className="font-mono text-xs">
                {res.code} {res.status}
              </Badge>
              <Tooltip content={<Timings timings={res.timings} total={res.time} />}>
                <span className="text-muted">
                  <b className="text-app">{formatMs(res.time)}</b>
                </span>
              </Tooltip>
              <Tooltip content={t("Cuerpo {0} · Cabeceras {1}", [formatBytes(res.size.body), formatBytes(res.size.header)])}>
                <span className="text-muted">
                  <b className="text-app">{formatBytes(res.size.total || res.size.body)}</b>
                </span>
              </Tooltip>
              {onSaveExample && (
                <IconButton label={t("Guardar como ejemplo")} onClick={onSaveExample}>
                  <Save className="size-3.5" />
                </IconButton>
              )}
            </div>
          )
        }
      />
      {(error || execution?.error) && (
        <div className="flex items-start gap-2 border-b border-app bg-red-500/8 px-4 py-2.5 text-red-700 dark:text-red-400">
          <XCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">{t("No se pudo completar la petición")}</div>
            <div className="font-mono text-xs">{error || execution?.error}</div>
          </div>
        </div>
      )}
      {scriptErrors.map((e) => (
        <div key={e as string} className="flex items-center gap-2 border-b border-app bg-amber-500/8 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          {e}
        </div>
      ))}
      <div className="min-h-0 flex-1">
        {view === 'body' && res && <BodyView res={res} />}
        {view === 'headers' && res && <HeaderTable rows={res.headers} />}
        {view === 'cookies' && res && (
          <div className="h-full overflow-auto p-3">
            {res.cookies.length === 0 ? (
              <div className="p-4 text-center text-muted">{t("La respuesta no ha guardado cookies.")}</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    {['Nombre', 'Valor', 'Dominio', 'Ruta', 'Caduca', 'HttpOnly', 'Secure'].map((h) => (
                      <th key={h} className="px-2 py-1 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {res.cookies.map((c) => (
                    <tr key={c.name + c.domain} className="border-t border-app font-mono text-xs">
                      <td className="px-2 py-1.5">{c.name}</td>
                      <td className="max-w-80 truncate px-2 py-1.5">{c.value}</td>
                      <td className="px-2 py-1.5">{c.domain}</td>
                      <td className="px-2 py-1.5">{c.path}</td>
                      <td className="px-2 py-1.5">{c.expires ? new Date(c.expires).toLocaleString(locale) : t("Sesión")}</td>
                      <td className="px-2 py-1.5">{c.httpOnly ? t("sí") : 'no'}</td>
                      <td className="px-2 py-1.5">{c.secure ? t("sí") : 'no'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {view === 'tests' && (
          <div className="h-full overflow-auto p-3">
            {tests.length === 0 ? (
              <div className="p-4 text-center text-muted">{t("No hay tests. Añádelos en la pestaña Scripts → Post-response.")}</div>
            ) : (
              <TestList tests={tests} />
            )}
          </div>
        )}
        {view === 'console' && <ConsoleView logs={logs ?? []} />}
        {view === 'timeline' && execution && <Timeline execution={execution} />}
      </div>
    </div>
  )
}

export function TestList({ tests }: { tests: Execution['tests'] }) {
  return (
    <div className="space-y-1">
      {tests.map((tItem, i) => (
        <div key={i} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-soft">
          {tItem.skipped ? (
            <Badge>{t('OMITIDO')}</Badge>
          ) : tItem.passed ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
          ) : (
            <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
          )}
          <div className="min-w-0">
            <div>{tItem.name}</div>
            {tItem.error && <div className="font-mono text-xs text-red-600 dark:text-red-400">{tItem.error}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

function BodyView({ res }: { res: ExecResponse }) {
  const [mode, setMode] = useState<'pretty' | 'raw' | 'preview'>('pretty')
  const lang = languageForContentType(res.contentType)
  const isImage = /^image\//.test(res.contentType ?? '')
  const isHtml = lang === 'html'
  const isPdf = /pdf/.test(res.contentType ?? '')
  const pretty = useMemo(() => (res.body !== undefined ? prettyBody(res.body, lang) : ''), [res.body, lang])

  const copy = () => {
    navigator.clipboard.writeText(res.body ?? '')
    toast.success(t("Copiado"))
  }
  const downloadBody = () => {
    const blob = res.bodyBase64
      ? new Blob([Uint8Array.from(atob(res.bodyBase64), (c) => c.charCodeAt(0))], { type: res.contentType })
      : new Blob([res.body ?? ''], { type: res.contentType ?? 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `respuesta${extFor(res.contentType)}`
    a.click()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 px-3 py-1.5">
        {(['pretty', 'raw', 'preview'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cx('rounded px-2 py-0.5 text-xs', mode === m ? 'bg-muted font-medium' : 'text-muted hover:text-app')}
          >
            {m === 'pretty' ? t("Bonito") : m === 'raw' ? t("Raw") : t("Vista previa")}
          </button>
        ))}
        {mode === 'pretty' && res.body !== undefined && <span className="ml-2 text-[11px] text-muted uppercase">{lang === 'plaintext' ? 'texto' : lang}</span>}
        {res.truncated && <Badge tone="amber" className="ml-2">{t("Cuerpo truncado")}</Badge>}
        <div className="ml-auto flex">
          {res.body !== undefined && (
            <IconButton label={t("Copiar")} onClick={copy}>
              <Copy className="size-3.5" />
            </IconButton>
          )}
          <IconButton label={t("Descargar")} onClick={downloadBody}>
            <Download className="size-3.5" />
          </IconButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 border-t border-app">
        {mode === 'preview' ? (
          isImage && res.bodyBase64 ? (
            <div className="flex h-full items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--bg-muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-4">
              <img src={`data:${res.contentType};base64,${res.bodyBase64}`} alt={t("Respuesta")} className="max-h-full max-w-full" />
            </div>
          ) : isImage && res.body ? (
            <div className="flex h-full items-center justify-center p-4">
              <img src={`data:${res.contentType};charset=utf-8,${encodeURIComponent(res.body)}`} alt={t("Respuesta")} className="max-h-full max-w-full" />
            </div>
          ) : isPdf && res.bodyBase64 ? (
            <iframe title="PDF" className="h-full w-full" src={`data:application/pdf;base64,${res.bodyBase64}`} />
          ) : (
            <iframe title={t("Vista previa")} sandbox="" className="h-full w-full bg-white" srcDoc={isHtml ? res.body : `<pre style="white-space:pre-wrap;font:12px monospace">${escapeHtml(res.body ?? '')}</pre>`} />
          )
        ) : res.body !== undefined ? (
          <CodeEditor value={mode === 'pretty' ? pretty : res.body} language={mode === 'pretty' ? lang : 'plaintext'} readOnly path={`response-${mode}`} />
        ) : (
          <Empty title={t("Respuesta binaria")}>
            {t('{0} de tipo {1}. Usa «Vista previa» o descárgala.', [formatBytes(res.size.body), res.contentType ?? t('desconocido')])}
          </Empty>
        )}
      </div>
    </div>
  )
}

function extFor(ct?: string) {
  if (!ct) return '.txt'
  if (ct.includes('json')) return '.json'
  if (ct.includes('xml')) return '.xml'
  if (ct.includes('html')) return '.html'
  if (ct.includes('png')) return '.png'
  if (ct.includes('jpeg')) return '.jpg'
  if (ct.includes('pdf')) return '.pdf'
  return '.bin'
}

function escapeHtml(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
}

export function HeaderTable({ rows }: { rows: { key: string; value: string }[] }) {
  return (
    <div className="h-full overflow-auto p-3">
      <table className="w-full text-[12.5px]">
        <tbody>
          {rows.map((h, i) => (
            <tr key={i} className="border-b border-app">
              <td className="w-1/3 px-2 py-1.5 align-top font-medium">{h.key}</td>
              <td className="px-2 py-1.5 font-mono text-xs break-all">{h.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ConsoleView({ logs }: { logs: ConsoleEntry[] }) {
  if (!logs.length) return <div className="p-6 text-center text-muted">{t("Sin mensajes. Usa console.log() en tus scripts.")}</div>
  return (
    <div className="h-full overflow-auto p-2 font-mono text-xs">
      {logs.map((l, i) => (
        <div
          key={i}
          className={cx(
            'border-b border-app px-2 py-1 whitespace-pre-wrap',
            l.level === 'error' && 'text-red-600 dark:text-red-400',
            l.level === 'warn' && 'text-amber-600 dark:text-amber-400',
          )}
        >
          <span className="mr-2 text-muted">{l.level}</span>
          {l.messages.map((m) => (typeof m === 'string' ? m : JSON.stringify(m, null, 2))).join(' ')}
        </div>
      ))}
    </div>
  )
}

const PHASES: [string, string][] = [
  ['prepare', t('Preparación')],
  ['wait', t('Socket')],
  ['dns', t('DNS')],
  ['tcp', t('Conexión TCP')],
  ['secureHandshake', t('TLS')],
  ['firstByte', t('Primer byte')],
  ['download', t('Descarga')],
  ['process', t('Proceso')],
]

function Timings({ timings, total }: { timings?: Record<string, number>; total: number }) {
  if (!timings) return <span>{formatMs(total)}</span>
  return (
    <div className="space-y-0.5 py-1">
      {PHASES.filter(([k]) => timings[k] !== undefined && !Number.isNaN(timings[k])).map(([k, label]) => (
        <div key={k} className="flex justify-between gap-6">
          <span>{label}</span>
          <span className="font-mono">{formatMs(timings[k])}</span>
        </div>
      ))}
      <div className="flex justify-between gap-6 border-t border-white/20 pt-0.5 font-semibold">
        <span>{t("Total")}</span>
        <span className="font-mono">{formatMs(timings.total ?? total)}</span>
      </div>
    </div>
  )
}

function Timeline({ execution }: { execution: Execution }) {
  const req = execution.request
  const tItem = execution.response?.timings
  const total = tItem?.total ?? execution.response?.time ?? 0
  return (
    <div className="h-full space-y-5 overflow-auto p-4">
      {tItem && (
        <section>
          <h4 className="mb-2 text-xs font-semibold text-muted uppercase">{t("Tiempos")}</h4>
          <div className="space-y-1">
            {PHASES.filter(([k]) => tItem[k] !== undefined && !Number.isNaN(tItem[k])).map(([k, label]) => {
              let offset = 0
              for (const [pk] of PHASES) {
                if (pk === k) break
                offset += tItem[pk] && !Number.isNaN(tItem[pk]) ? tItem[pk] : 0
              }
              return (
                <div key={k} className="grid grid-cols-[110px_1fr_70px] items-center gap-2 text-xs">
                  <span className="text-muted">{label}</span>
                  <div className="relative h-3 rounded bg-muted">
                    <div
                      className="absolute h-3 rounded bg-brand-500"
                      style={{ left: `${(offset / total) * 100}%`, width: `${Math.max(0.5, (tItem[k] / total) * 100)}%` }}
                    />
                  </div>
                  <span className="text-right font-mono">{formatMs(tItem[k])}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}
      {req && (
        <section>
          <h4 className="mb-2 text-xs font-semibold text-muted uppercase">{t("Petición enviada")}</h4>
          <div className="mb-2 font-mono text-xs break-all">
            <b>{req.method}</b> {req.url}
          </div>
          <div className="rounded-md border border-app">
            <HeaderTable rows={req.headers} />
          </div>
          {req.body && <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-soft p-3 font-mono text-xs whitespace-pre-wrap">{req.body}</pre>}
        </section>
      )}
    </div>
  )
}
