import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Lock, Plus, Server, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { qk, useCollections, useEnvironments, useMocks } from '@/api/hooks'
import type { MockRow } from '@/api/types'
import { confirm } from '@/components/dialogs'
import { Badge, Button, Checkbox, Dialog, Empty, Field, IconButton, Input, MethodBadge, Select, Spinner, cx, statusTone, timeAgo } from '@/components/ui'
import { useWs } from '../workspace/context'

export function MocksPage() {
  const { ws, canEdit } = useWs()
  const { data: mocks, isLoading } = useMocks(ws)
  const [selected, setSelected] = useState<string>()
  const [createOpen, setCreateOpen] = useState(false)
  const current = mocks?.find((m) => m.id === (selected ?? mocks?.[0]?.id))

  return (
    <div className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col border-r border-app bg-soft">
        <div className="flex items-center border-b border-app px-4 py-3">
          <div className="flex-1">
            <h2 className="font-semibold">Mock servers</h2>
            <p className="text-xs text-muted">Responden con los ejemplos guardados.</p>
          </div>
          {canEdit && (
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreateOpen(true)}>
              Nuevo
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {isLoading && <Spinner className="m-3" />}
          {mocks?.length === 0 && <Empty icon={<Server />} title="Sin mock servers">Simula tu API antes de que exista, o para que el frontend no dependa del backend.</Empty>}
          {mocks?.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelected(m.id)}
              className={cx('mb-0.5 flex w-full flex-col rounded-md px-3 py-2 text-left', current?.id === m.id ? 'bg-app shadow-sm ring-1 ring-[var(--border)]' : 'hover:bg-muted')}
            >
              <span className="flex items-center gap-1.5 font-medium">
                {m.name}
                {m.isPrivate && <Lock className="size-3 text-muted" />}
              </span>
              <span className="text-xs text-muted">{m.collection}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1">{current ? <MockDetail key={current.id} mock={current} /> : !isLoading && <Empty icon={<Server />} title="Elige o crea un mock server" />}</div>
      <MockDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={setSelected} />
    </div>
  )
}

function MockDetail({ mock }: { mock: MockRow }) {
  const { ws, canEdit } = useWs()
  const qc = useQueryClient()
  const url = `${location.origin}/mock/${mock.slug}`
  const { data: logs, isLoading } = useQuery({
    queryKey: ['mock-logs', mock.id],
    queryFn: () => api.get<{ id: string; method: string; path: string; status: number; matchedExample: string | null; createdAt: string }[]>(`/api/mocks/${mock.id}/logs`),
    refetchInterval: 4000,
  })
  const [delay, setDelay] = useState(mock.delayMs)
  useEffect(() => setDelay(mock.delayMs), [mock.delayMs])

  const patch = async (body: Partial<MockRow>) => {
    await api.patch(`/api/mocks/${mock.id}`, body)
    qc.invalidateQueries({ queryKey: qk.mocks(ws) })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 border-b border-app p-5">
        <div className="flex items-center gap-3">
          <h2 className="flex-1 text-lg font-semibold">{mock.name}</h2>
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 className="size-3.5" />}
              onClick={async () => {
                if (!(await confirm('Eliminar mock', `La URL ${url} dejará de responder.`, { confirm: 'Eliminar', danger: true }))) return
                await api.del(`/api/mocks/${mock.id}`)
                qc.invalidateQueries({ queryKey: qk.mocks(ws) })
              }}
            >
              Eliminar
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-app bg-soft px-3 py-2">
          <span className="flex-1 truncate font-mono text-[12.5px]">{url}</span>
          <IconButton
            label="Copiar URL"
            onClick={() => {
              navigator.clipboard.writeText(url)
              toast.success('URL copiada')
            }}
          >
            <Copy className="size-3.5" />
          </IconButton>
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <Field label="Retardo simulado (ms)">
            <Input type="number" className="w-32" value={delay} min={0} max={60000} onChange={(e) => setDelay(Number(e.target.value) || 0)} onBlur={() => delay !== mock.delayMs && patch({ delayMs: delay })} disabled={!canEdit} />
          </Field>
          <Checkbox checked={mock.isPrivate} onChange={(v) => canEdit && patch({ isPrivate: v })} label="Privado (requiere x-api-key)" />
        </div>
        <details className="text-xs text-muted">
          <summary className="cursor-pointer select-none">Cómo elige la respuesta</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Busca los ejemplos guardados cuyo método y ruta coinciden (las partes <code>:param</code> y <code>{'{{var}}'}</code> valen cualquier valor).</li>
            <li>Desempata por query params y prefiere respuestas 2xx.</li>
            <li>
              Fuerza un ejemplo con las cabeceras <code>x-mock-response-name</code>, <code>x-mock-response-code</code> o <code>x-mock-response-id</code>.
            </li>
            <li>
              Compara también el body con <code>x-mock-match-request-body: true</code>.
            </li>
            <li>
              Admite variables dinámicas en el body del ejemplo: <code>{'{{$randomEmail}}'}</code>, <code>{'{{$guid}}'}</code>, <code>{'{{$timestamp}}'}</code>…
            </li>
          </ul>
        </details>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-2 text-xs font-semibold text-muted uppercase">Llamadas recibidas</div>
        {isLoading && <Spinner className="m-4" />}
        {logs?.length === 0 && (
          <p className="px-5 text-muted">
            Aún no hay llamadas. Prueba: <code className="font-mono">curl {url}/tu-ruta</code>
          </p>
        )}
        <table className="w-full text-[12.5px]">
          <tbody>
            {logs?.map((l) => (
              <tr key={l.id} className="border-t border-app">
                <td className="w-20 py-1.5 pl-5">
                  <MethodBadge method={l.method} />
                </td>
                <td className="py-1.5 font-mono text-xs">{l.path}</td>
                <td className="py-1.5">
                  <Badge tone={statusTone(l.status)}>{l.status}</Badge>
                </td>
                <td className="py-1.5 text-xs text-muted">{l.matchedExample ?? 'sin coincidencia'}</td>
                <td className="py-1.5 pr-5 text-right text-xs text-muted">{timeAgo(l.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MockDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const { ws } = useWs()
  const { data: collections } = useCollections(ws)
  const { data: envs } = useEnvironments(ws)
  const [name, setName] = useState('')
  const [collectionId, setCollectionId] = useState('')
  const [envId, setEnvId] = useState('')
  const [isPrivate, setPrivate] = useState(false)
  const [delay, setDelay] = useState(0)
  const qc = useQueryClient()

  useEffect(() => {
    if (open && collections?.length && !collectionId) setCollectionId(collections[0].id)
  }, [open, collections])

  const submit = async () => {
    try {
      const m = await api.post<MockRow>(`/api/workspaces/${ws}/mocks`, { name: name || collections?.find((c) => c.id === collectionId)?.name, collectionId, environmentId: envId || null, isPrivate, delayMs: delay })
      qc.invalidateQueries({ queryKey: qk.mocks(ws) })
      onCreated(m.id)
      onOpenChange(false)
      setName('')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nuevo mock server"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit} disabled={!collectionId}>
            Crear
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Colección" hint="Responderá con los ejemplos guardados en sus peticiones.">
          <Select value={collectionId} onChange={(e) => setCollectionId(e.target.value)} className="w-full">
            {collections?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={collections?.find((c) => c.id === collectionId)?.name} />
        </Field>
        <Field label="Entorno" hint="Para resolver {{variables}} en las URLs y bodies de los ejemplos.">
          <Select value={envId} onChange={(e) => setEnvId(e.target.value)} className="w-full">
            <option value="">Ninguno</option>
            {envs?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Retardo simulado (ms)">
          <Input type="number" value={delay} onChange={(e) => setDelay(Number(e.target.value) || 0)} />
        </Field>
        <Checkbox checked={isPrivate} onChange={setPrivate} label="Privado: exige un token de API en la cabecera x-api-key" />
      </div>
    </Dialog>
  )
}
