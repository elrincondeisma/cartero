import { FileSpreadsheet, Play, X } from 'lucide-react'
import Papa from 'papaparse'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useCollection, useEnvironments, useRuns } from '@/api/hooks'
import { Badge, Button, Checkbox, Field, Input, MethodBadge, Select, Spinner, cx, timeAgo } from '@/components/ui'
import { buildTree, findNode, requestOrder } from '@/lib/tree'
import { useUi } from '@/store/ui'
import { useOpen } from '../workspace/actions'
import { useWs } from '../workspace/context'
import { RunStatusBadge } from './RunView'
import { t } from "@/i18n";

export function RunnerTab({ collectionId, folderId }: { collectionId: string; folderId?: string }) {
  const { ws, canEdit } = useWs()
  const { data: col, isLoading } = useCollection(collectionId)
  const { data: envs } = useEnvironments(ws)
  const { data: runs } = useRuns(ws, { collectionId })
  const activeEnv = useUi((s) => s.activeEnv[ws])
  const open = useOpen()

  const requests = useMemo(() => {
    if (!col) return []
    const tree = buildTree(col.items)
    return requestOrder(folderId ? (findNode(tree, folderId)?.children ?? []) : tree)
  }, [col, folderId])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [envId, setEnvId] = useState(activeEnv ?? '')
  const [iterations, setIterations] = useState(1)
  const [delay, setDelay] = useState(0)
  const [bail, setBail] = useState(false)
  const [persist, setPersist] = useState(true)
  const [data, setData] = useState<{ name: string; rows: Record<string, unknown>[] } | null>(null)
  const [starting, setStarting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => setSelected(new Set(requests.map((r) => r.id))), [requests.length])

  const loadData = async (file: File) => {
    const text = await file.text()
    try {
      let rows: Record<string, unknown>[]
      if (/\.json$/i.test(file.name) || text.trim().startsWith('[')) {
        rows = JSON.parse(text)
        if (!Array.isArray(rows)) throw new Error(t("El JSON debe ser un array de objetos"))
      } else {
        const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true, dynamicTyping: false })
        const errors = parsed.errors.filter((e) => e.code !== 'UndetectableDelimiter')
        if (errors.length) throw new Error(errors[0].message)
        rows = parsed.data
      }
      setData({ name: file.name, rows })
      setIterations(rows.length)
    } catch (e) {
      toast.error(t("No se pudo leer el fichero: {0}", [(e as Error).message]))
    }
  }

  const start = async () => {
    setStarting(true)
    try {
      const allSelected = selected.size === requests.length
      const { runId } = await api.post<{ runId: string }>(`/api/collections/${collectionId}/runs`, {
        environmentId: envId || null,
        folderId: folderId ?? null,
        itemIds: allSelected ? undefined : requests.filter((r) => selected.has(r.id)).map((r) => r.id),
        iterations,
        data: data?.rows,
        delay,
        bail,
        persistVariables: persist && canEdit,
      })
      open.run(runId, `Run · ${folder?.name ?? col?.name ?? ''}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  const folder = folderId ? col?.items.find((i) => i.id === folderId) : undefined
  if (isLoading || !col)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col border-r border-app">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-app px-4">
          <span className="font-semibold">
            {col.name}
            {folder && <span className="text-muted"> / {folder.name}</span>}
          </span>
          <Badge>{t('{0} peticiones', [requests.length])}</Badge>
          <div className="ml-auto flex gap-3 text-xs">
            <button className="text-brand-700 hover:underline dark:text-brand-400" onClick={() => setSelected(new Set(requests.map((r) => r.id)))}>
              {t("Todas")}</button>
            <button className="text-brand-700 hover:underline dark:text-brand-400" onClick={() => setSelected(new Set())}>
              {t("Ninguna")}</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {requests.map((r, i) => (
            <label key={r.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-soft">
              <Checkbox
                checked={selected.has(r.id)}
                onChange={(v) => {
                  const next = new Set(selected)
                  v ? next.add(r.id) : next.delete(r.id)
                  setSelected(next)
                }}
              />
              <span className="w-6 text-right text-xs text-muted">{i + 1}</span>
              <MethodBadge method={r.data.request?.method ?? 'GET'} className="w-12" />
              <span className="flex-1 truncate">{r.name}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex w-[360px] shrink-0 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <h3 className="font-semibold">{t("Configuración")}</h3>
          <Field label={t("Entorno")}>
            <Select value={envId} onChange={(e) => setEnvId(e.target.value)} className="w-full">
              <option value="">{t("Sin entorno")}</option>
              {envs?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Iteraciones")}>
              <Input type="number" min={1} max={10000} value={iterations} onChange={(e) => setIterations(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
            <Field label={t("Retardo (ms)")}>
              <Input type="number" min={0} value={delay} onChange={(e) => setDelay(Math.max(0, Number(e.target.value) || 0))} />
            </Field>
          </div>
          <Field label={t("Datos (CSV o JSON)")} hint={t("Cada fila es una iteración. Accede a los valores con {{columna}} o pm.iterationData.get('columna').")}>
            {data ? (
              <div className="flex items-center gap-2 rounded-md border border-app px-2.5 py-1.5">
                <FileSpreadsheet className="size-4 text-muted" />
                <span className="flex-1 truncate">{data.name}</span>
                <Badge>{t('{0} filas', [data.rows.length])}</Badge>
                <button onClick={() => setData(null)} className="text-muted hover:text-app" aria-label={t("Quitar")}>
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <Button variant="outline" className="w-full" icon={<FileSpreadsheet className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                {t("Elegir fichero")}</Button>
            )}
            <input ref={fileRef} type="file" accept=".csv,.json,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && loadData(e.target.files[0])} />
          </Field>
          {data && data.rows.length > 0 && (
            <div className="max-h-32 overflow-auto rounded-md border border-app text-xs">
              <table className="w-full">
                <thead className="bg-soft">
                  <tr>
                    {Object.keys(data.rows[0]).map((k) => (
                      <th key={k} className="px-2 py-1 text-left font-medium">
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t border-app">
                      {Object.values(r).map((v, j) => (
                        <td key={j} className="truncate px-2 py-1 font-mono">
                          {String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="space-y-2">
            <Checkbox checked={bail} onChange={setBail} label={t("Parar al primer fallo")} />
            <Checkbox checked={persist && canEdit} onChange={setPersist} label={t("Guardar las variables que cambien los scripts")} />
          </div>
        </div>
        <div className="border-t border-app p-4">
          <Button variant="primary" className="h-9 w-full" icon={<Play className="size-4" />} onClick={start} loading={starting} disabled={selected.size === 0}>
            {selected.size === 1 ? t('Ejecutar 1 petición') : t('Ejecutar {0} peticiones', [selected.size])}
            {iterations > 1 ? ` × ${iterations}` : ''}
          </Button>
        </div>
        {!!runs?.length && (
          <div className="max-h-56 overflow-y-auto border-t border-app p-2">
            <div className="px-2 pb-1 text-[11px] font-semibold text-muted uppercase">{t("Ejecuciones anteriores")}</div>
            {runs.slice(0, 15).map((r) => (
              <button key={r.id} onClick={() => open.run(r.id, `Run · ${r.name}`)} className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-soft')}>
                <RunStatusBadge status={r.status} />
                <span className="flex-1 truncate text-xs">{r.name}</span>
                <span className="text-[11px] text-muted">{timeAgo(r.startedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
