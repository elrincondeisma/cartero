import type { QueryParam, Request, RequestItem, ResponseExample } from '@cartero/core'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Code2, MessageSquare, RefreshCw, Save, Send } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ApiError, api } from '@/api/client'
import { qk, useCollection } from '@/api/hooks'
import type { ExecuteResult, ItemRow } from '@/api/types'
import { prompt } from '@/components/dialogs'
import { KeyValueEditor, type KVRow } from '@/components/KeyValueEditor'
import { Button, IconButton, SubTabs, cx } from '@/components/ui'
import { VarInput } from '@/components/VarInput'
import { METHODS, setQueryParams, setRawUrl, urlObject } from '@/lib/request'
import { ancestors, rowToRequestItem } from '@/lib/tree'
import { useKnownVariables } from '@/lib/vars'
import { type Tab, useResults, useTabs } from '@/store/tabs'
import { useUi } from '@/store/ui'
import { useWs } from '../workspace/context'
import { AuthEditor } from './AuthEditor'
import { BodyEditor } from './BodyEditor'
import { CollabPanel } from './CollabPanel'
import { ExamplesEditor } from './ExamplesEditor'
import { ResponsePane } from './ResponsePane'
import { SaveDialog } from './SaveDialog'
import { ScriptsEditor, scriptCount } from './ScriptsEditor'
import { SettingsEditor } from './SettingsEditor'
import { SnippetDialog } from './SnippetDialog'

type ReqTab = Extract<Tab, { kind: 'request' }>
type Sub = 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'examples' | 'settings'

/** Datos del ítem que se guardan en la fila (todo menos id y name). */
export function itemData(item: RequestItem): ItemRow['data'] {
  const { id: _id, name: _name, ...rest } = item as any
  return rest
}

export function RequestTab({ tab }: { tab: ReqTab }) {
  const { ws, canEdit } = useWs()
  const qc = useQueryClient()
  const update = useCallback((patch: Partial<ReqTab>) => useTabs.getState().update(ws, tab.key, patch), [ws, tab.key])
  const draft = tab.draft
  const req = draft.request
  const known = useKnownVariables(ws, tab.collectionId)
  const { data: col } = useCollection(tab.collectionId ?? undefined)
  const result = useResults((s) => s.results[tab.key])
  const setResult = useResults((s) => s.set)
  const env = useUi((s) => s.activeEnv[ws] ?? null)
  const heightFrac = useUi((s) => s.responseHeight)
  const setHeightFrac = useUi((s) => s.setResponseHeight)
  const [sub, setSub] = useState<Sub>(() => (req.body?.mode && req.body.mode !== 'none' ? 'body' : 'params'))
  const [saveOpen, setSaveOpen] = useState(false)
  const [snippetOpen, setSnippetOpen] = useState(false)
  const [panel, setPanel] = useState<false | 'comments' | 'history'>(false)
  const container = useRef<HTMLDivElement>(null)

  const setReq = (fn: (r: Request) => Request) => update({ draft: { ...draft, request: fn(req) }, dirty: true })
  const setItem = (patch: Partial<RequestItem>) => update({ draft: { ...draft, ...patch }, dirty: true })

  // Sincroniza con el servidor cuando otra persona guarda
  const row = col?.items.find((i) => i.id === tab.itemId)
  useEffect(() => {
    if (!row || tab.baseVersion === undefined) return
    if (row.version > tab.baseVersion) {
      if (!tab.dirty) update({ draft: rowToRequestItem(row), baseVersion: row.version, title: row.name, remoteChanged: false })
      else if (!tab.remoteChanged) update({ remoteChanged: true })
    }
  }, [row?.version])

  const breadcrumb = useMemo(() => (col && tab.itemId ? ancestors(col.items, tab.itemId) : []), [col, tab.itemId])
  const url = urlObject(req.url)

  // --- Enviar ---
  const send = async () => {
    if (!url.raw.trim()) return toast.error('Escribe una URL')
    const abort = new AbortController()
    setResult(tab.key, { loading: true, abort })
    try {
      const r = await api.post<ExecuteResult>(`/api/workspaces/${ws}/execute`, {
        collectionId: tab.collectionId ?? null,
        item: { ...draft, id: tab.itemId ?? draft.id },
        environmentId: env,
      })
      if (abort.signal.aborted) return
      setResult(tab.key, { loading: false, result: r })
      if (r.variablesChanged.length) {
        qc.invalidateQueries({ queryKey: qk.environments(ws) })
        qc.invalidateQueries({ queryKey: qk.globals(ws) })
        if (tab.collectionId) qc.invalidateQueries({ queryKey: qk.collection(tab.collectionId) })
      }
      qc.invalidateQueries({ queryKey: qk.history(ws) })
    } catch (e) {
      if (!abort.signal.aborted) setResult(tab.key, { loading: false, error: (e as Error).message })
    }
  }

  // --- Guardar ---
  const save = async (force = false) => {
    if (!canEdit) return toast.error('Tienes acceso de solo lectura')
    if (!tab.itemId) return setSaveOpen(true)
    try {
      const saved = await api.patch<ItemRow>(`/api/items/${tab.itemId}`, {
        name: draft.name,
        data: itemData(draft),
        ...(force ? {} : { version: tab.baseVersion }),
      })
      update({ baseVersion: saved.version, dirty: false, remoteChanged: false, title: saved.name })
      qc.invalidateQueries({ queryKey: qk.collection(saved.collectionId) })
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error('Otra persona ha guardado cambios en esta petición', {
          duration: 15_000,
          action: { label: 'Sobrescribir', onClick: () => save(true) },
          cancel: { label: 'Ver la suya', onClick: () => reloadFromServer() },
        })
      } else toast.error((e as Error).message)
    }
  }

  const saveNew = async (target: { collectionId: string; parentId: string | null; name: string }) => {
    const created = await api.post<ItemRow>(`/api/collections/${target.collectionId}/items`, {
      type: 'request',
      name: target.name,
      parentId: target.parentId,
      data: itemData(draft),
    })
    const newTab: ReqTab = {
      key: `req:${created.id}`,
      kind: 'request',
      itemId: created.id,
      collectionId: created.collectionId,
      title: created.name,
      draft: rowToRequestItem(created),
      baseVersion: created.version,
      dirty: false,
    }
    const prev = useResults.getState().results[tab.key]
    if (prev) setResult(newTab.key, prev)
    useTabs.getState().rekey(ws, tab.key, newTab)
    useUi.getState().toggleExpanded(created.collectionId, true)
    if (target.parentId) useUi.getState().toggleExpanded(target.parentId, true)
    qc.invalidateQueries({ queryKey: qk.collection(created.collectionId) })
    qc.invalidateQueries({ queryKey: qk.collections(ws) })
    toast.success('Petición guardada')
  }

  const reloadFromServer = () => {
    if (row) update({ draft: rowToRequestItem(row), baseVersion: row.version, dirty: false, remoteChanged: false, title: row.name })
  }

  const saveExample = async () => {
    const ex = result?.result?.execution
    if (!ex?.response) return
    const name = await prompt('Guardar como ejemplo', { label: 'Los ejemplos documentan la API y alimentan los mock servers', value: `${ex.response.code} ${ex.response.status}`, confirm: 'Guardar' })
    if (!name) return
    const example: ResponseExample = {
      id: crypto.randomUUID(),
      name,
      originalRequest: structuredClone(req),
      status: ex.response.status,
      code: ex.response.code,
      header: ex.response.headers,
      cookie: [],
      body: ex.response.body ?? '',
      _postman_previewlanguage: ex.response.contentType?.includes('json') ? 'json' : 'text',
      responseTime: Math.round(ex.response.time),
    }
    update({ draft: { ...draft, response: [...(draft.response ?? []), example] }, dirty: true })
    toast.success(tab.itemId ? 'Ejemplo añadido. Guarda la petición para conservarlo.' : 'Ejemplo añadido')
  }

  // Atajos de teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'Enter') {
        e.preventDefault()
        void send()
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Divisor redimensionable entre petición y respuesta
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const rect = container.current!.getBoundingClientRect()
    const move = (ev: MouseEvent) => setHeightFrac(Math.min(0.85, Math.max(0.15, 1 - (ev.clientY - rect.top) / rect.height)))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'row-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const onPasteUrl = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!/^\s*curl\s/i.test(text)) return
    e.preventDefault()
    try {
      const parsed = await api.post<RequestItem>('/api/tools/curl', { text })
      update({ draft: { ...draft, request: parsed.request }, dirty: true })
      if (parsed.request.body) setSub('body')
      toast.success('cURL importado')
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const headersCount = req.header?.filter((h) => !h.disabled && h.key).length ?? 0
  const paramsCount = url.query?.filter((q) => !q.disabled && q.key).length ?? 0

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Cabecera: ruta + nombre + acciones */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-app px-3">
          <div className="flex min-w-0 flex-1 items-center gap-1 text-[12.5px]">
            {col && <span className="shrink-0 text-muted">{col.name}</span>}
            {breadcrumb.map((f) => (
              <span key={f.id} className="flex shrink-0 items-center gap-1 text-muted">
                <ChevronRight className="size-3" />
                {f.name}
              </span>
            ))}
            {col && <ChevronRight className="size-3 shrink-0 text-muted" />}
            <input
              value={draft.name}
              onChange={(e) => update({ draft: { ...draft, name: e.target.value }, title: e.target.value, dirty: true })}
              className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 font-medium outline-none hover:bg-muted focus:bg-muted"
              readOnly={!canEdit}
            />
          </div>
          {tab.remoteChanged && (
            <Button size="sm" variant="outline" icon={<RefreshCw className="size-3.5" />} onClick={reloadFromServer} className="border-amber-500 text-amber-700 dark:text-amber-400">
              Hay cambios de otra persona
            </Button>
          )}
          {tab.itemId && tab.collectionId && (
            <IconButton label="Comentarios y cambios" active={!!panel} onClick={() => setPanel(panel ? false : 'comments')}>
              <MessageSquare className="size-4" />
            </IconButton>
          )}
          <IconButton label="Código" onClick={() => setSnippetOpen(true)}>
            <Code2 className="size-4" />
          </IconButton>
          {canEdit && (
            <Button size="sm" variant={tab.dirty ? 'outline' : 'ghost'} icon={<Save className="size-3.5" />} onClick={() => save()} title="Guardar (Ctrl+S)">
              Guardar
            </Button>
          )}
        </div>

        {/* Barra de URL */}
        <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
          <div className="flex h-9 min-w-0 flex-1 items-stretch rounded-lg border border-app bg-app focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
            <select
              value={req.method}
              onChange={(e) => setReq((r) => ({ ...r, method: e.target.value }))}
              className={cx('w-28 rounded-l-lg border-r border-app bg-soft pl-2.5 font-mono text-[12.5px] font-semibold outline-none', `method-${req.method}`)}
              aria-label="Método"
            >
              {METHODS.includes(req.method) ? null : <option value={req.method}>{req.method}</option>}
              {METHODS.map((m) => (
                <option key={m} value={m} className={`method-${m}`}>
                  {m}
                </option>
              ))}
            </select>
            <VarInput
              value={url.raw ?? ''}
              onChange={(v) => setReq((r) => ({ ...r, url: setRawUrl(r.url, v) }))}
              onPaste={onPasteUrl}
              known={known}
              placeholder="https://api.ejemplo.com/v1/recurso  — o pega un comando cURL"
              className="h-full"
            />
          </div>
          <Button variant="primary" className="h-9 px-5" icon={<Send className="size-3.5" />} onClick={send} loading={result?.loading} title="Enviar (Ctrl+Enter)">
            Enviar
          </Button>
        </div>

        {/* Editor + respuesta */}
        <div ref={container} className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-col" style={{ flex: `${1 - heightFrac} 1 0` }}>
            <SubTabs
              value={sub}
              onChange={setSub}
              tabs={[
                { id: 'params', label: 'Params', count: paramsCount },
                { id: 'auth', label: 'Autorización', dot: !!draft.request.auth && draft.request.auth.type !== 'noauth' },
                { id: 'headers', label: 'Cabeceras', count: headersCount },
                { id: 'body', label: 'Body', dot: !!req.body?.mode && req.body.mode !== 'none' },
                { id: 'scripts', label: 'Scripts', count: scriptCount(draft.event) },
                { id: 'examples', label: 'Ejemplos', count: draft.response?.length ?? 0 },
                { id: 'settings', label: 'Ajustes', dot: !!draft.protocolProfileBehavior },
              ]}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
              {sub === 'params' && (
                <div className="h-full space-y-4 overflow-auto p-3">
                  <section>
                    <h4 className="mb-1.5 text-xs font-medium text-muted">Query params</h4>
                    <KeyValueEditor
                      rows={(url.query ?? []).map((q) => ({ ...q, key: q.key ?? '', value: q.value ?? '' })) as KVRow[]}
                      onChange={(rows) => setReq((r) => ({ ...r, url: setQueryParams(r.url, rows as QueryParam[]) }))}
                      known={known}
                    />
                  </section>
                  {(url.variable?.length ?? 0) > 0 && (
                    <section>
                      <h4 className="mb-1.5 text-xs font-medium text-muted">Variables de ruta</h4>
                      <KeyValueEditor
                        rows={url.variable as KVRow[]}
                        onChange={(rows) => setReq((r) => ({ ...r, url: { ...urlObject(r.url), variable: rows.filter((x) => url.variable!.some((v) => v.key === x.key)) } }))}
                        known={known}
                        readOnly
                      />
                    </section>
                  )}
                </div>
              )}
              {sub === 'auth' && (
                <div className="h-full overflow-auto">
                  <AuthEditor auth={req.auth} onChange={(auth) => setReq((r) => ({ ...r, auth: auth ?? undefined }))} known={known} />
                </div>
              )}
              {sub === 'headers' && (
                <div className="h-full overflow-auto p-3">
                  <KeyValueEditor rows={(req.header ?? []) as KVRow[]} onChange={(rows) => setReq((r) => ({ ...r, header: rows }))} known={known} />
                  <p className="mt-2 text-[11px] text-muted">
                    Cartero añade automáticamente User-Agent, Accept, Host, Content-Length y la cabecera de autorización. Puedes sobrescribirlas aquí.
                  </p>
                </div>
              )}
              {sub === 'body' && <BodyEditor body={req.body} onChange={(body) => setReq((r) => ({ ...r, body }))} known={known} />}
              {sub === 'scripts' && <ScriptsEditor events={draft.event} onChange={(event) => setItem({ event })} />}
              {sub === 'examples' && <ExamplesEditor examples={draft.response ?? []} onChange={(response) => setItem({ response })} />}
              {sub === 'settings' && <SettingsEditor value={draft.protocolProfileBehavior} onChange={(protocolProfileBehavior) => setItem({ protocolProfileBehavior })} />}
            </div>
          </div>
          <div onMouseDown={startDrag} className="h-1.5 shrink-0 cursor-row-resize border-t border-app hover:bg-brand-500/30" />
          <div className="min-h-0" style={{ flex: `${heightFrac} 1 0` }}>
            <ResponsePane
              execution={result?.result?.execution}
              console={result?.result?.console}
              loading={result?.loading}
              error={result?.error ?? result?.result?.error}
              onSaveExample={canEdit ? saveExample : undefined}
              onCancel={() => {
                result?.abort?.abort()
                setResult(tab.key, { loading: false })
              }}
            />
          </div>
        </div>
      </div>
      {panel && tab.collectionId && <CollabPanel collectionId={tab.collectionId} itemId={tab.itemId} onClose={() => setPanel(false)} initial={panel} />}
      <SaveDialog open={saveOpen} onOpenChange={setSaveOpen} defaultName={draft.name} onSave={saveNew} />
      <SnippetDialog open={snippetOpen} onOpenChange={setSnippetOpen} request={req} collectionId={tab.collectionId} />
    </div>
  )
}
