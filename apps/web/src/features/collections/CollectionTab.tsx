import type { Auth, Event, Variable } from '@cartero/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import DOMPurify from 'dompurify'
import { ExternalLink, FolderTree, Play, Save, Server } from 'lucide-react'
import { marked } from 'marked'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ApiError, api } from '@/api/client'
import { qk, useCollection, useEnvironments } from '@/api/hooks'
import type { ItemRow } from '@/api/types'
import { KeyValueEditor, type KVRow } from '@/components/KeyValueEditor'
import { Badge, Button, Checkbox, Empty, Field, Input, Select, Spinner, SubTabs, Textarea, cx } from '@/components/ui'
import { buildTree, requestOrder } from '@/lib/tree'
import { useKnownVariables } from '@/lib/vars'
import { useTabs } from '@/store/tabs'
import { useUi } from '@/store/ui'
import { AuthEditor } from '../request/AuthEditor'
import { CollabPanel } from '../request/CollabPanel'
import { ScriptsEditor } from '../request/ScriptsEditor'
import { useOpen } from '../workspace/actions'
import { useWs } from '../workspace/context'
import { t } from "@/i18n";

type Sub = 'overview' | 'auth' | 'scripts' | 'variables' | 'docs' | 'activity'

interface Draft {
  name: string
  description: string
  auth: Auth | null | undefined
  event: Event[] | undefined
  variable: Variable[]
}

export function CollectionTab({ collectionId, folderId, tabKey }: { collectionId: string; folderId?: string; tabKey: string }) {
  const { ws, canEdit } = useWs()
  const { data: col, isLoading } = useCollection(collectionId)
  const folder = folderId ? col?.items.find((i) => i.id === folderId) : undefined
  const [sub, setSub] = useState<Sub>('overview')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [base, setBase] = useState<number | undefined>()
  const [dirty, setDirty] = useState(false)
  const known = useKnownVariables(ws, collectionId)
  const qc = useQueryClient()
  const open = useOpen()

  const sourceVersion = folderId ? folder?.version : col?.version
  useEffect(() => {
    if (!col || (folderId && !folder)) return
    if (dirty && base === sourceVersion) return
    if (folder) {
      setDraft({ name: folder.name, description: folder.data.description ?? '', auth: folder.data.auth, event: folder.data.event, variable: folder.data.variable ?? [] })
    } else {
      setDraft({ name: col.name, description: col.data.description ?? '', auth: col.data.auth, event: col.data.event, variable: col.data.variable ?? [] })
    }
    setBase(sourceVersion)
    setDirty(false)
  }, [sourceVersion, col?.id])

  const change = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d))
    setDirty(true)
  }

  const save = async () => {
    if (!draft) return
    try {
      if (folder) {
        await api.patch(`/api/items/${folder.id}`, {
          name: draft.name,
          data: { ...folder.data, description: draft.description || undefined, auth: draft.auth ?? undefined, event: draft.event, variable: draft.variable.length ? draft.variable : undefined },
          version: base,
        })
      } else {
        await api.patch(`/api/collections/${collectionId}`, {
          name: draft.name,
          data: { description: draft.description || undefined, auth: draft.auth ?? null, event: draft.event ?? null, variable: draft.variable },
          version: base,
        })
        qc.invalidateQueries({ queryKey: qk.collections(ws) })
      }
      setDirty(false)
      useTabs.getState().update(ws, tabKey, { title: draft.name })
      await qc.invalidateQueries({ queryKey: qk.collection(collectionId) })
      toast.success(t("Guardado"))
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(t("Otra persona ha cambiado esto. Se recarga su versión."))
        setDirty(false)
        qc.invalidateQueries({ queryKey: qk.collection(collectionId) })
      } else toast.error((e as Error).message)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (canEdit && dirty) void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (isLoading || !draft || !col)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  if (folderId && !folder) return <Empty title={t("Esta carpeta ya no existe")} />

  const tabs: { id: Sub; label: string; dot?: boolean; count?: number }[] = [
    { id: 'overview', label: t("Resumen") },
    { id: 'auth', label: t("Autorización"), dot: !!draft.auth },
    { id: 'scripts', label: t("Scripts"), dot: !!draft.event?.length },
    { id: 'variables', label: t("Variables"), count: draft.variable.length },
    ...(!folderId ? [{ id: 'docs' as const, label: t("Documentación") }] : []),
    { id: 'activity', label: t("Actividad") },
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-app px-4">
        <FolderTree className="size-4 text-muted" />
        <input
          value={draft.name}
          onChange={(e) => change({ name: e.target.value })}
          readOnly={!canEdit}
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-[15px] font-semibold outline-none hover:bg-muted focus:bg-muted"
        />
        {folder ? <Badge>{t("Carpeta")}</Badge> : <Badge tone="brand">{t("Colección")}</Badge>}
        <Button size="sm" variant="outline" icon={<Play className="size-3.5" />} onClick={() => open.runner(collectionId, folder ? `${col.name} / ${folder.name}` : col.name, folderId)}>
          {t("Ejecutar")}</Button>
        {canEdit && (
          <Button size="sm" variant={dirty ? 'primary' : 'ghost'} icon={<Save className="size-3.5" />} onClick={save} disabled={!dirty}>
            {t("Guardar")}</Button>
        )}
      </div>
      <SubTabs value={sub} onChange={setSub} tabs={tabs} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {sub === 'overview' && <Overview description={draft.description} onChange={(description) => change({ description })} readOnly={!canEdit} items={col.items} folderId={folderId} />}
        {sub === 'auth' && (
          <div className="h-full overflow-auto">
            <AuthEditor auth={draft.auth} onChange={(auth) => change({ auth })} known={known} allowInherit={!!folderId} readOnly={!canEdit} />
            <p className="px-4 pb-4 text-xs text-muted">
              {folderId
                ? t("Las peticiones de esta carpeta con «Heredar del padre» usarán esta autenticación.")
                : t("Todas las peticiones con «Heredar del padre» usarán esta autenticación.")}
            </p>
          </div>
        )}
        {sub === 'scripts' && (
          <div className="flex h-full flex-col">
            <p className="border-b border-app px-4 py-2 text-xs text-muted">{folderId ? t('Estos scripts se ejecutan antes/después de cada petición de la carpeta.') : t('Estos scripts se ejecutan antes/después de cada petición de la colección.')}</p>
            <div className="min-h-0 flex-1">
              <ScriptsEditor events={draft.event} onChange={(event) => change({ event })} readOnly={!canEdit} />
            </div>
          </div>
        )}
        {sub === 'variables' && <VariablesTable values={draft.variable} onChange={(variable) => change({ variable })} readOnly={!canEdit} hint={folderId ? t("Variables de carpeta: solo las ven las peticiones de esta carpeta.") : t("Variables de colección: accesibles desde cualquier petición con {{nombre}} y con pm.collectionVariables.")} />}
        {sub === 'docs' && <DocsPublisher collectionId={collectionId} collectionName={col.name} />}
        {sub === 'activity' && (
          <div className="flex h-full justify-end">
            <div className="flex-1 overflow-auto p-6 text-muted">
              <MockShortcut collectionId={collectionId} />
            </div>
            <CollabPanel collectionId={collectionId} itemId={folderId} onClose={() => setSub('overview')} initial="history" />
          </div>
        )}
      </div>
    </div>
  )
}

function Overview({ description, onChange, readOnly, items, folderId }: { description: string; onChange: (v: string) => void; readOnly: boolean; items: ItemRow[]; folderId?: string }) {
  const [editing, setEditing] = useState(false)
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(description || '', { async: false }) as string), [description])
  const tree = useMemo(() => buildTree(items), [items])
  const scope = folderId ? (findChildren(tree, folderId) ?? []) : tree
  const requests = requestOrder(scope)
  const open = useOpen()
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-muted uppercase">{t("Descripción")}</h3>
          {!readOnly && (
            <button onClick={() => setEditing(!editing)} className="text-xs text-brand-700 hover:underline dark:text-brand-400">
              {editing ? t("Ver") : t("Editar")}
            </button>
          )}
        </div>
        {editing ? (
          <Textarea value={description} onChange={(e) => onChange(e.target.value)} rows={14} className="font-mono text-xs" placeholder={t("Describe la API en Markdown…")} autoFocus />
        ) : description ? (
          <div className="prose-docs" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="text-muted">{t("Sin descripción.")}{' '}{readOnly ? '' : t("Añade una en Markdown: aparecerá en la documentación publicada.")}</p>
        )}
        <h3 className="mt-8 mb-2 text-xs font-semibold text-muted uppercase">{t('Peticiones ({0})', [requests.length])}</h3>
        <div className="divide-y divide-[var(--border)] rounded-lg border border-app">
          {requests.map((r) => (
            <button key={r.id} onClick={() => open.request(r)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-soft">
              <span className={cx('w-14 font-mono text-[11px] font-semibold', `method-${r.data.request?.method ?? 'GET'}`)}>{r.data.request?.method}</span>
              <span className="flex-1 truncate">{r.name}</span>
              <span className="max-w-[45%] truncate font-mono text-xs text-muted">{(r.data.request?.url as any)?.raw ?? r.data.request?.url}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function findChildren(nodes: ReturnType<typeof buildTree>, id: string): ReturnType<typeof buildTree> | undefined {
  for (const n of nodes) {
    if (n.row.id === id) return n.children
    const f = findChildren(n.children, id)
    if (f) return f
  }
  return undefined
}

export function VariablesTable({ values, onChange, readOnly, hint }: { values: Variable[]; onChange: (v: Variable[]) => void; readOnly?: boolean; hint?: string }) {
  const [reveal, setReveal] = useState(false)
  return (
    <div className="h-full overflow-auto p-4">
      {hint && <p className="mb-3 text-xs text-muted">{hint}</p>}
      <KeyValueEditor
        rows={values as KVRow[]}
        onChange={(rows) => onChange(rows as Variable[])}
        readOnly={readOnly}
        keyPlaceholder="Variable"
        valuePlaceholder="Valor"
        extraColumn={{
          header: t("Tipo"),
          width: 'w-28',
          render: (row, update) => (
            <select
              value={row.type === 'secret' ? 'secret' : 'default'}
              onChange={(e) => update({ type: e.target.value === 'secret' ? 'secret' : undefined })}
              className="h-7 w-full bg-transparent text-xs outline-none"
              disabled={readOnly}
            >
              <option value="default">{t("Normal")}</option>
              <option value="secret">{t("Secreto")}</option>
            </select>
          ),
        }}
        renderValue={(row, update) =>
          row.type === 'secret' && !reveal ? (
            <input type="password" value={row.value ?? ''} onChange={(e) => update({ value: e.target.value })} className="h-8 w-full bg-transparent px-2.5 font-mono outline-none" readOnly={readOnly} />
          ) : undefined
        }
      />
      <div className="mt-3 flex items-center gap-4">
        <Checkbox checked={reveal} onChange={setReveal} label={<span className="text-xs text-muted">{t("Mostrar secretos")}</span>} />
        <span className="text-xs text-muted">{t("Los secretos se guardan cifrados (AES-256-GCM) en la base de datos.")}</span>
      </div>
    </div>
  )
}

function DocsPublisher({ collectionId, collectionName }: { collectionId: string; collectionName: string }) {
  const { ws, canEdit } = useWs()
  const { data: envs } = useEnvironments(ws)
  const { data: doc, isLoading, refetch } = useQuery({
    queryKey: ['docs', collectionId],
    queryFn: () => api.get<{ slug: string; published: boolean; environmentId: string | null; hasPassword: boolean } | null>(`/api/collections/${collectionId}/docs`),
  })
  const [slug, setSlug] = useState('')
  const [published, setPublished] = useState(true)
  const [envId, setEnvId] = useState('')
  const [password, setPassword] = useState('')
  const [protect, setProtect] = useState(false)

  useEffect(() => {
    setSlug(doc?.slug ?? collectionName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60))
    setPublished(doc?.published ?? true)
    setEnvId(doc?.environmentId ?? '')
    setProtect(doc?.hasPassword ?? false)
  }, [doc, collectionName])

  if (isLoading) return <Spinner className="m-6" />
  const url = `${location.origin}/docs/${doc?.slug ?? slug}`

  const save = async () => {
    try {
      await api.put(`/api/collections/${collectionId}/docs`, {
        slug,
        published,
        environmentId: envId || null,
        password: protect ? password || undefined : null,
      })
      setPassword('')
      await refetch()
      toast.success(t("Documentación actualizada"))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-xl space-y-4 p-6">
        <div>
          <h3 className="text-[15px] font-semibold">{t("Documentación pública")}</h3>
          <p className="mt-1 text-muted">{t("Publica una página con todas las peticiones, descripciones, ejemplos y fragmentos de código. Las credenciales se ocultan automáticamente.")}</p>
        </div>
        {doc && (
          <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-app bg-soft px-3 py-2 font-mono text-xs text-brand-700 hover:underline dark:text-brand-400">
            <ExternalLink className="size-3.5" />
            {url}
            {!doc.published && <Badge tone="amber">{t("No publicada")}</Badge>}
          </a>
        )}
        <Field label="URL" hint={t("Solo minúsculas, números y guiones.")}>
          <div className="flex items-center rounded-md border border-app">
            <span className="pl-2.5 text-xs text-muted">{location.origin}/docs/</span>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} className="h-8 flex-1 bg-transparent pr-2 font-mono text-xs outline-none" disabled={!canEdit} />
          </div>
        </Field>
        <Field label={t("Entorno para resolver variables")} hint={t("Las variables secretas nunca se publican.")}>
          <Select value={envId} onChange={(e) => setEnvId(e.target.value)} className="w-full" disabled={!canEdit}>
            <option value="">{t('Ninguno (mostrar {0})', ['{{variables}}'])}</option>
            {envs?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox checked={published} onChange={setPublished} label={t("Publicada")} />
        <div className="space-y-2">
          <Checkbox checked={protect} onChange={setProtect} label={t("Proteger con contraseña")} />
          {protect && <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={doc?.hasPassword ? t("(sin cambios)") : t("Contraseña")} />}
        </div>
        {canEdit && (
          <div className="flex gap-2 pt-2">
            <Button variant="primary" onClick={save} disabled={slug.length < 3 || (protect && !doc?.hasPassword && password.length < 4)}>
              {doc ? t("Guardar cambios") : t("Publicar")}
            </Button>
            {doc && (
              <Button
                variant="ghost"
                onClick={async () => {
                  await api.del(`/api/collections/${collectionId}/docs`)
                  await refetch()
                  toast.success(t("Documentación retirada"))
                }}
              >
                {t("Retirar")}</Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function MockShortcut({ collectionId }: { collectionId: string }) {
  const setSection = useUi((s) => s.setSection)
  void collectionId
  return (
    <div className="mx-auto max-w-md rounded-lg border border-app p-5 text-center">
      <Server className="mx-auto mb-2 size-6" />
      <div className="font-medium text-app">{t("¿Necesitas un mock de esta API?")}</div>
      <p className="mt-1 text-xs">{t("Crea un mock server que responde con los ejemplos guardados en las peticiones.")}</p>
      <Button size="sm" variant="outline" className="mt-3" onClick={() => setSection('mocks')}>
        {t("Ir a mock servers")}</Button>
    </div>
  )
}
