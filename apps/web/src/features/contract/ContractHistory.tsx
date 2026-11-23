import type { Contract } from '@cartero/core'
import { type ContractChange, diffContracts } from '@cartero/contracts'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useRevisions } from '@/api/hooks'
import { Badge, Spinner, cx, timeAgo } from '@/components/ui'
import { revisionSummary } from '@/lib/revisions'
import { t } from '@/i18n'

function paramLabel(kind: NonNullable<ContractChange['param']>) {
  switch (kind) {
    case 'path':
      return t('Parámetro de ruta')
    case 'query':
      return t('Query')
    case 'header':
      return t('Cabecera')
  }
}

/** Lista de cambios de un contrato: primero lo que rompe al frontend, luego lo compatible. */
export function ChangeList({ changes }: { changes: ContractChange[] }) {
  if (!changes.length) return <p className="text-xs text-muted">{t('Sin cambios de estructura.')}</p>
  const sorted = [...changes].sort((a, b) => Number(b.breaking) - Number(a.breaking))
  return (
    <ul className="space-y-1">
      {sorted.map((c, i) => (
        <li
          key={i}
          className={cx(
            'flex items-baseline gap-2 rounded-md border-l-2 px-2 py-1 text-[12.5px]',
            c.breaking ? 'border-red-500 bg-red-500/5' : 'border-emerald-500 bg-emerald-500/5',
          )}
        >
          <Badge tone={c.breaking ? 'red' : 'green'} className="shrink-0">
            {c.breaking ? t('Rompe') : t('Compatible')}
          </Badge>
          <span className="shrink-0 text-muted">{c.section === 'request' ? t('Petición') : c.section}</span>
          {c.param && <span className="shrink-0 text-muted">{paramLabel(c.param)}</span>}
          {c.path !== c.section && <code className="shrink-0 font-mono text-xs">{c.path}</code>}
          <span className="min-w-0">{t(c.message, c.params)}</span>
        </li>
      ))}
    </ul>
  )
}

interface RevisionRow {
  before: { contract?: Contract } | null
  after: { contract?: Contract } | null
}

function RevisionDiff({ id }: { id: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['revision', id], queryFn: () => api.get<RevisionRow>(`/api/revisions/${id}`) })
  if (isLoading) return <Spinner className="m-2" />
  // Al crear o quitar el contrato, el resumen ya lo dice: listar cada campo sería ruido
  if (!data?.before?.contract || !data.after?.contract) return null
  return <ChangeList changes={diffContracts(data.before?.contract, data.after?.contract)} />
}

/** Versiones del contrato de una petición (quién y cuándo) con lo que cambió en cada una. */
export function ContractHistory({ collectionId, itemId }: { collectionId: string; itemId: string }) {
  const { data, isLoading } = useRevisions(collectionId, itemId, 'contract')
  return (
    <div className="h-full overflow-y-auto p-3">
      {isLoading && <Spinner className="m-3" />}
      {data?.length === 0 && <p className="py-6 text-center text-xs text-muted">{t('El contrato aún no tiene versiones guardadas.')}</p>}
      <ol className="space-y-3">
        {data?.map((r) => (
          <li key={r.id} className="rounded-md border border-app p-2.5">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] font-medium">{revisionSummary(r.summary)}</span>
              <span className="shrink-0 text-[11px] text-muted">
                {r.user ?? t('Sistema')} · {timeAgo(r.createdAt)}
              </span>
            </div>
            <RevisionDiff id={r.id} />
          </li>
        ))}
      </ol>
    </div>
  )
}
