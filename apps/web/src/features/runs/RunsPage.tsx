import { Zap } from 'lucide-react'
import { useState } from 'react'
import { useRuns } from '@/api/hooks'
import { Empty, Spinner, cx, formatMs, timeAgo } from '@/components/ui'
import { RunStatusBadge, RunView } from '../runner/RunView'
import { useWs } from '../workspace/context'

export function RunsPage() {
  const { ws } = useWs()
  const { data: runs, isLoading } = useRuns(ws)
  const [selected, setSelected] = useState<string>()
  const current = selected ?? runs?.[0]?.id

  return (
    <div className="flex h-full">
      <div className="flex w-96 shrink-0 flex-col border-r border-app bg-soft">
        <div className="border-b border-app px-4 py-3">
          <h2 className="font-semibold">Ejecuciones</h2>
          <p className="text-xs text-muted">Runner, monitores y CLI. Sin límite de ejecuciones.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {isLoading && <Spinner className="m-3" />}
          {runs?.length === 0 && <Empty icon={<Zap />} title="Aún no hay ejecuciones">Ejecuta una colección desde su menú, o con la CLI: cartero run.</Empty>}
          {runs?.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelected(r.id)}
              className={cx('mb-0.5 flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left', current === r.id ? 'bg-app shadow-sm ring-1 ring-[var(--border)]' : 'hover:bg-muted')}
            >
              <div className="flex items-center gap-2">
                <RunStatusBadge status={r.status} />
                <span className="flex-1 truncate font-medium">{r.name}</span>
              </div>
              <div className="flex gap-3 text-[11px] text-muted">
                <span>{timeAgo(r.startedAt)}</span>
                <span>{r.source === 'monitor' ? 'Monitor' : r.source === 'cli' ? 'CLI' : (r.user ?? 'App')}</span>
                {r.stats && (
                  <>
                    <span>
                      {r.stats.assertions - r.stats.failedAssertions}/{r.stats.assertions} tests
                    </span>
                    <span>{formatMs(r.stats.totalTime)}</span>
                  </>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1">{current ? <RunView key={current} runId={current} /> : null}</div>
    </div>
  )
}
