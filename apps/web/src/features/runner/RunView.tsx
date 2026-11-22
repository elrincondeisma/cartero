import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Download, Square } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/api/client'
import { qk, useRun } from '@/api/hooks'
import type { ConsoleEntry, Execution, RunRow } from '@/api/types'
import { Badge, Button, MethodBadge, Spinner, SubTabs, cx, formatBytes, formatMs, statusTone } from '@/components/ui'
import { ConsoleView, HeaderTable, TestList } from '../request/ResponsePane'
import { locale, t } from "@/i18n";

export function RunStatusBadge({ status }: { status: RunRow['status'] }) {
  const map: Record<RunRow['status'], { tone: 'green' | 'red' | 'amber' | 'blue' | 'neutral'; label: string }> = {
    running: { tone: 'blue', label: t("En curso") },
    passed: { tone: 'green', label: 'OK' },
    failed: { tone: 'red', label: t("Fallos") },
    error: { tone: 'red', label: t("Error") },
    aborted: { tone: 'amber', label: t("Cancelado") },
  }
  const s = map[status]
  return <Badge tone={s.tone}>{s.label}</Badge>
}

/** Resultado de una ejecución: en vivo (SSE) mientras corre y desde la BD cuando termina. */
export function RunView({ runId }: { runId: string }) {
  const { data: run, isLoading } = useRun(runId)
  const qc = useQueryClient()
  const [live, setLive] = useState<Execution[]>([])
  const [liveConsole, setLiveConsole] = useState<ConsoleEntry[]>([])
  const [current, setCurrent] = useState<string>()
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed'>('all')
  const [view, setView] = useState<'results' | 'console'>('results')

  useEffect(() => {
    if (!run || run.status !== 'running') return
    const es = new EventSource(`/api/runs/${runId}/events`)
    const execs: Execution[] = []
    const logs: ConsoleEntry[] = []
    es.addEventListener('run', (ev) => {
      const e = JSON.parse((ev as MessageEvent).data)
      if (e.type === 'execution') {
        execs.push(e.execution)
        setLive([...execs])
        setCurrent(undefined)
      } else if (e.type === 'beforeItem') setCurrent(e.name)
      else if (e.type === 'console') {
        logs.push(e.entry)
        setLiveConsole([...logs])
      }
    })
    es.addEventListener('end', () => {
      es.close()
      qc.invalidateQueries({ queryKey: qk.run(runId) })
      qc.invalidateQueries({ queryKey: ['runs'] })
    })
    es.onerror = () => {
      es.close()
      setTimeout(() => qc.invalidateQueries({ queryKey: qk.run(runId) }), 1000)
    }
    return () => es.close()
  }, [run?.status, runId, qc])

  const executions = run?.status === 'running' ? live : (run?.result?.executions ?? [])
  const logs = run?.status === 'running' ? liveConsole : (run?.result?.console ?? [])
  const stats = useMemo(() => {
    const tests = executions.flatMap((e) => e.tests)
    const times = executions.map((e) => e.response?.time ?? 0).filter(Boolean)
    return {
      requests: executions.length,
      passed: tests.filter((tItem) => tItem.passed).length,
      failed: tests.filter((tItem) => !tItem.passed && !tItem.skipped).length,
      errors: executions.filter((e) => e.error).length,
      avg: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0,
    }
  }, [executions])

  const filtered = executions.filter((e) => {
    const failed = !!e.error || e.tests.some((tItem) => !tItem.passed && !tItem.skipped)
    return filter === 'all' || (filter === 'failed' ? failed : !failed)
  })

  if (isLoading || !run)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )

  const exportReport = () => {
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `run-${run.id}.json`
    a.click()
  }

  const duration = run.finishedAt ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime() : Date.now() - new Date(run.startedAt).getTime()

  return (
    <div className="@container flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-app px-4 py-3">
        <div className="flex items-center gap-2">
          <RunStatusBadge status={run.status} />
          <span className="font-semibold">{run.name}</span>
          <span className="text-xs text-muted">
            {new Date(run.startedAt).toLocaleString(locale)} · {run.source === 'monitor' ? 'monitor' : run.source === 'cli' ? 'CLI' : run.source === 'desktop' ? t('Escritorio') : (run.user ?? '')}
          </span>
        </div>
        <Stat label={t("Peticiones")} value={stats.requests} />
        <Stat label={t("Tests OK")} value={stats.passed} tone="text-green-600 dark:text-green-400" />
        <Stat label={t("Tests fallidos")} value={stats.failed} tone={stats.failed ? 'text-red-600 dark:text-red-400' : undefined} />
        <Stat label={t("Errores")} value={stats.errors} tone={stats.errors ? 'text-red-600 dark:text-red-400' : undefined} />
        <Stat label={t("Media")} value={formatMs(stats.avg)} />
        <Stat label={t("Duración")} value={formatMs(duration)} />
        <div className="ml-auto flex gap-2">
          {run.status === 'running' ? (
            <Button size="sm" variant="outline" icon={<Square className="size-3.5" />} onClick={() => api.post(`/api/runs/${runId}/abort`)}>
              {t("Detener")}</Button>
          ) : (
            <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={exportReport}>
              {t("Exportar JSON")}</Button>
          )}
        </div>
      </div>
      {run.result?.error && <div className="border-b border-app bg-red-500/8 px-4 py-2 text-red-700 dark:text-red-400">{run.result.error}</div>}
      <SubTabs
        value={view}
        onChange={setView}
        tabs={[
          { id: 'results', label: t("Resultados") },
          { id: 'console', label: t("Consola"), count: logs.length },
        ]}
        right={
          view === 'results' && (
            <div className="flex gap-1 text-xs">
              {(['all', 'passed', 'failed'] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={cx('rounded px-2 py-0.5', filter === f ? 'bg-muted font-medium' : 'text-muted')}>
                  {f === 'all' ? t("Todas") : f === 'passed' ? t("Correctas") : t("Con fallos")}
                </button>
              ))}
            </div>
          )
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === 'console' ? (
          <ConsoleView logs={logs} />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filtered.map((e) => (
              <ExecutionRow key={e.id} e={e} showIteration={(run.stats?.iterations ?? 1) > 1 || executions.some((x) => x.iteration > 0)} />
            ))}
            {run.status === 'running' && (
              <div className="flex items-center gap-2 px-4 py-3 text-muted">
                <Spinner className="size-3.5" /> {current ? t("Ejecutando «{0}»…", [current]) : t("Ejecutando…")}
              </div>
            )}
            {run.status !== 'running' && filtered.length === 0 && <div className="p-8 text-center text-muted">{t("No hay resultados con este filtro.")}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="leading-tight">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cx('font-semibold', tone)}>{value}</div>
    </div>
  )
}

function ExecutionRow({ e, showIteration }: { e: Execution; showIteration: boolean }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'tests' | 'response' | 'request'>('tests')
  const failed = e.tests.filter((tItem) => !tItem.passed && !tItem.skipped).length
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-soft">
        <ChevronRight className={cx('size-3.5 shrink-0 text-muted transition-transform', open && 'rotate-90')} />
        {showIteration && <span className="w-8 text-xs text-muted">#{e.iteration + 1}</span>}
        <MethodBadge method={e.request?.method ?? 'GET'} className="w-12" />
        <span className="w-56 truncate font-medium">{e.name}</span>
        {/* Si el panel es estrecho (p. ej. dentro de Monitores), la URL no cabe: se oculta */}
        <span className="hidden min-w-0 flex-1 truncate font-mono text-xs text-muted @3xl:block">{e.request?.url}</span>
        <span className="flex-1 @3xl:hidden" />
        {e.error ? (
          <Badge tone="red">{t("Error")}</Badge>
        ) : (
          e.response && (
            <>
              <Badge tone={statusTone(e.response.code)} className="font-mono">
                {e.response.code}
              </Badge>
              <span className="w-16 text-right text-xs text-muted">{formatMs(e.response.time)}</span>
              <span className="w-16 text-right text-xs text-muted">{formatBytes(e.response.size.body)}</span>
            </>
          )
        )}
        <span className="flex w-12 justify-end">
          {e.tests.length > 0 && (
            <Badge tone={failed ? 'red' : 'green'}>
              {e.tests.length - failed}/{e.tests.length}
            </Badge>
          )}
        </span>
      </button>
      {open && (
        <div className="border-t border-app bg-soft/50 pb-2">
          <SubTabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'tests', label: t("Tests ({0})", [e.tests.length]) },
              { id: 'response', label: t("Respuesta") },
              { id: 'request', label: t("Petición") },
            ]}
          />
          <div className="max-h-96 overflow-auto px-4 py-2">
            {e.error && <div className="mb-2 font-mono text-xs text-red-600">{e.error}</div>}
            {(e.prerequestError || e.testScriptError) && (
              <div className="mb-2 text-xs text-amber-700 dark:text-amber-400">{e.prerequestError ?? e.testScriptError}</div>
            )}
            {tab === 'tests' && (e.tests.length ? <TestList tests={e.tests} /> : <div className="text-muted">{t("Sin tests")}</div>)}
            {tab === 'response' && e.response && (
              <div className="space-y-2">
                <HeaderTable rows={e.response.headers} />
                <pre className="max-h-64 overflow-auto rounded-md bg-app p-3 font-mono text-xs whitespace-pre-wrap">
                  {e.response.body ?? t("(binario, {0})", [formatBytes(e.response.size.body)])}
                </pre>
              </div>
            )}
            {tab === 'request' && e.request && (
              <div className="space-y-2">
                <div className="font-mono text-xs break-all">
                  <b>{e.request.method}</b> {e.request.url}
                </div>
                <HeaderTable rows={e.request.headers} />
                {e.request.body && <pre className="rounded-md bg-app p-3 font-mono text-xs whitespace-pre-wrap">{e.request.body}</pre>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
