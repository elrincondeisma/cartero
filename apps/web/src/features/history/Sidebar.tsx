import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { api } from '@/api/client'
import { qk, useHistory } from '@/api/hooks'
import type { HistoryRow } from '@/api/types'
import { confirm } from '@/components/dialogs'
import { Badge, Empty, IconButton, MethodBadge, Spinner, statusTone } from '@/components/ui'
import { useOpen } from '../workspace/actions'
import { useWs } from '../workspace/context'

function dayLabel(d: Date) {
  const today = new Date()
  const yest = new Date(Date.now() - 86400_000)
  if (d.toDateString() === today.toDateString()) return 'Hoy'
  if (d.toDateString() === yest.toDateString()) return 'Ayer'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

export function HistorySidebar() {
  const { ws } = useWs()
  const { data, isLoading } = useHistory(ws)
  const open = useOpen()
  const qc = useQueryClient()

  const groups = useMemo(() => {
    const out = new Map<string, HistoryRow[]>()
    for (const h of data ?? []) {
      const label = dayLabel(new Date(h.createdAt))
      out.set(label, [...(out.get(label) ?? []), h])
    }
    return [...out]
  }, [data])

  const reopen = (h: HistoryRow) => {
    const { collectionId, ...item } = h.request
    open.newRequest({ ...item, id: undefined, name: item.name ?? h.url }, collectionId)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 pt-2.5 pb-2">
        <span className="flex-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Historial</span>
        {!!data?.length && (
          <IconButton
            label="Borrar historial"
            onClick={async () => {
              if (!(await confirm('Borrar historial', 'Se borrará tu historial de peticiones en este workspace.', { confirm: 'Borrar', danger: true }))) return
              await api.del(`/api/workspaces/${ws}/history`)
              qc.invalidateQueries({ queryKey: qk.history(ws) })
            }}
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {isLoading && <Spinner className="m-3" />}
        {data?.length === 0 && <Empty title="Sin historial">Cada petición que envíes aparecerá aquí.</Empty>}
        {groups.map(([label, rows]) => (
          <div key={label} className="mb-2">
            <div className="px-2 py-1 text-[11px] font-medium text-muted capitalize">{label}</div>
            {rows.map((h) => (
              <button key={h.id} onClick={() => reopen(h)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted" title={h.url}>
                <MethodBadge method={h.method} className="w-10 shrink-0 text-right" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{h.url.replace(/^https?:\/\//, '')}</span>
                {h.status ? (
                  <Badge tone={statusTone(h.status)} className="font-mono">
                    {h.status}
                  </Badge>
                ) : (
                  <Badge tone="red">ERR</Badge>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
