import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight,
  Copy,
  Download,
  FilePlus,
  FileUp,
  Folder,
  FolderOpen,
  FolderPlus,
  GitFork,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react'
import { type DragEvent, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { toast } from 'sonner'
import { api, download } from '@/api/client'
import { qk, useCollection, useCollections, useWorkspaces } from '@/api/hooks'
import type { CollectionSummary, ItemRow } from '@/api/types'
import { confirm, prompt } from '@/components/dialogs'
import { Empty, IconButton, MethodBadge, Menu, type MenuItem, Spinner, cx } from '@/components/ui'
import { type TreeNode, buildTree } from '@/lib/tree'
import { useTabs } from '@/store/tabs'
import { usePresence, useUi } from '@/store/ui'
import { useOpen } from '../workspace/actions'
import { useWs } from '../workspace/context'
import { ForkDialog } from './ForkDialog'
import { ImportDialog } from './ImportDialog'
import { t } from "@/i18n";

type DropPos = 'before' | 'after' | 'inside'

export function CollectionsSidebar() {
  const { ws, canEdit } = useWs()
  const { data: collections, isLoading } = useCollections(ws)
  const [filter, setFilter] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const qc = useQueryClient()

  const create = async () => {
    const name = await prompt(t("Nueva colección"), { label: t("Nombre"), confirm: t("Crear") })
    if (!name) return
    await api.post(`/api/workspaces/${ws}/collections`, { name })
    qc.invalidateQueries({ queryKey: qk.collections(ws) })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 pt-2.5 pb-2">
        <span className="flex-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{t("Colecciones")}</span>
        {canEdit && (
          <>
            <IconButton label={t("Importar")} data-tour="import" onClick={() => setImportOpen(true)}>
              <FileUp className="size-4" />
            </IconButton>
            <IconButton label={t("Nueva colección")} onClick={create}>
              <Plus className="size-4" />
            </IconButton>
          </>
        )}
      </div>
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("Filtrar peticiones")}
            className="h-7 w-full rounded-md border border-app bg-app pr-2 pl-7 text-xs outline-none focus:border-brand-500"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {isLoading && <Spinner className="m-4" />}
        {collections?.length === 0 && (
          <Empty title={t("Aún no hay colecciones")}>
            {t("Crea una o importa desde Postman, Insomnia, OpenAPI o cURL.")}{canEdit && (
              <div className="mt-3 flex justify-center gap-2">
                <button onClick={() => setImportOpen(true)} className="text-brand-600 hover:underline">
                  {t("Importar")}</button>
                <span>·</span>
                <button onClick={create} className="text-brand-600 hover:underline">
                  {t("Crear colección")}</button>
              </div>
            )}
          </Empty>
        )}
        {collections?.map((c) => (
          <CollectionNode key={c.id} collection={c} filter={filter.trim().toLowerCase()} />
        ))}
      </div>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  )
}

function CollectionNode({ collection, filter }: { collection: CollectionSummary; filter: string }) {
  const { ws, canEdit } = useWs()
  const expanded = useUi((s) => s.expanded[collection.id]) || !!filter
  const toggle = useUi((s) => s.toggleExpanded)
  const { data, isLoading } = useCollection(expanded ? collection.id : undefined)
  const tree = useMemo(() => (data ? buildTree(data.items) : []), [data])
  const qc = useQueryClient()
  const open = useOpen()
  const [forkOpen, setForkOpen] = useState(false)
  const [dropHover, setDropHover] = useState(false)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.collection(collection.id) })
    qc.invalidateQueries({ queryKey: qk.collections(ws) })
  }

  const addItem = async (type: 'folder' | 'request', parentId: string | null = null) => {
    const name = await prompt(type === 'folder' ? t("Nueva carpeta") : t("Nueva petición"), {
      label: t("Nombre"),
      value: type === 'folder' ? t("Nueva carpeta") : t("Nueva petición"),
      confirm: t("Crear"),
    })
    if (!name) return
    const row = await api.post<ItemRow>(`/api/collections/${collection.id}/items`, { type, name, parentId })
    if (parentId) toggle(parentId, true)
    toggle(collection.id, true)
    invalidate()
    if (type === 'request') open.request(row)
  }

  const menu: (MenuItem | 'separator')[] = [
    ...(canEdit
      ? [
          { label: t("Nueva petición"), icon: <FilePlus />, onSelect: () => addItem('request') },
          { label: t("Nueva carpeta"), icon: <FolderPlus />, onSelect: () => addItem('folder') },
          'separator' as const,
        ]
      : []),
    { label: t("Ejecutar colección"), icon: <Play />, onSelect: () => open.runner(collection.id, collection.name) },
    { label: t("Configuración"), icon: <Settings2 />, onSelect: () => open.collection(collection.id, collection.name) },
    'separator',
    ...(canEdit
      ? [
          {
            label: t("Renombrar"),
            icon: <Pencil />,
            onSelect: async () => {
              const name = await prompt(t("Renombrar colección"), { value: collection.name, confirm: t("Guardar") })
              if (!name) return
              await api.patch(`/api/collections/${collection.id}`, { name })
              invalidate()
            },
          },
          {
            label: t("Duplicar"),
            icon: <Copy />,
            onSelect: async () => {
              await api.post(`/api/collections/${collection.id}/duplicate`)
              invalidate()
            },
          },
        ]
      : []),
    { label: t("Fork…"), icon: <GitFork />, onSelect: () => setForkOpen(true) },
    ...(collection.forkedFrom && canEdit
      ? [
          {
            label: t("Merge en el origen"),
            icon: <GitFork />,
            onSelect: async () => {
              const ok = await confirm(t("Merge del fork"), t("La colección de origen quedará igual que este fork. Se guarda una revisión para poder deshacerlo."), {
                confirm: t("Hacer merge"),
              })
              if (!ok) return
              try {
                await api.post(`/api/collections/${collection.id}/merge`)
                toast.success(t("Merge hecho"))
                qc.invalidateQueries({ queryKey: qk.collection(collection.forkedFrom!) })
              } catch (e) {
                toast.error((e as Error).message)
              }
            },
          },
        ]
      : []),
    {
      label: t("Exportar (Postman v2.1)"),
      icon: <Download />,
      onSelect: () => download(`/api/collections/${collection.id}/export`, `${collection.name}.postman_collection.json`),
    },
    ...(canEdit
      ? [
          'separator' as const,
          {
            label: t("Eliminar"),
            icon: <Trash2 />,
            danger: true,
            onSelect: async () => {
              const ok = await confirm(t("Eliminar colección"), t("Se eliminará «{0}» con todas sus peticiones.", [collection.name]), { confirm: t("Eliminar"), danger: true })
              if (!ok) return
              await api.del(`/api/collections/${collection.id}`)
              useTabs.getState().removeWhere(ws, (tItem) => 'collectionId' in tItem && tItem.collectionId === collection.id)
              invalidate()
            },
          },
        ]
      : []),
  ]

  const filtered = filter ? filterTree(tree, filter) : tree

  return (
    <div className="mb-0.5">
      <div
        className={cx('group flex h-7 cursor-pointer items-center gap-1 rounded-md pr-1 pl-1 hover:bg-muted', dropHover && 'ring-2 ring-brand-500 ring-inset')}
        onClick={() => toggle(collection.id)}
        onDragOver={(e) => {
          if (!canEdit || !e.dataTransfer.types.includes('application/x-cartero-item')) return
          e.preventDefault()
          setDropHover(true)
        }}
        onDragLeave={() => setDropHover(false)}
        onDrop={async (e) => {
          setDropHover(false)
          const raw = e.dataTransfer.getData('application/x-cartero-item')
          if (!raw) return
          const { id, collectionId } = JSON.parse(raw)
          if (collectionId !== collection.id) return toast.error(t("Solo se puede mover dentro de la misma colección"))
          await api.post(`/api/items/${id}/move`, { parentId: null, index: tree.length })
          invalidate()
        }}
      >
        <ChevronRight className={cx('size-3.5 shrink-0 text-muted transition-transform', expanded && 'rotate-90')} />
        <span className="flex-1 truncate font-medium">{collection.name}</span>
        {collection.forkedFrom && <GitFork className="size-3 text-muted" />}
        <Menu
          trigger={
            <button onClick={(e) => e.stopPropagation()} className="invisible rounded p-0.5 text-muted group-hover:visible hover:bg-app" aria-label={t("Acciones")}>
              <MoreHorizontal className="size-4" />
            </button>
          }
          items={menu}
        />
      </div>
      {expanded && (
        <div className="ml-2.5 border-l border-app pl-1">
          {isLoading && <Spinner className="m-2 size-3.5" />}
          {data && filtered.length === 0 && <div className="px-2 py-1.5 text-xs text-muted">{filter ? t("Sin resultados") : t("Colección vacía")}</div>}
          {filtered.map((n) => (
            <ItemNode key={n.row.id} node={n} siblings={filtered} depth={0} collectionName={collection.name} onAdd={addItem} invalidate={invalidate} forceOpen={!!filter} />
          ))}
        </div>
      )}
      <ForkDialog open={forkOpen} onOpenChange={setForkOpen} collection={collection} />
    </div>
  )
}

function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  const out: TreeNode[] = []
  for (const n of nodes) {
    if (n.row.type === 'request') {
      const url = (n.row.data.request?.url as any)?.raw ?? n.row.data.request?.url ?? ''
      if (n.row.name.toLowerCase().includes(q) || String(url).toLowerCase().includes(q)) out.push(n)
    } else {
      const children = filterTree(n.children, q)
      if (children.length || n.row.name.toLowerCase().includes(q)) out.push({ ...n, children })
    }
  }
  return out
}

function ItemNode({
  node,
  siblings,
  depth,
  collectionName,
  onAdd,
  invalidate,
  forceOpen,
}: {
  node: TreeNode
  siblings: TreeNode[]
  depth: number
  collectionName: string
  onAdd: (type: 'folder' | 'request', parentId?: string | null) => void
  invalidate: () => void
  forceOpen: boolean
}) {
  const { ws, canEdit, me } = useWs()
  const { row } = node
  const isFolder = row.type === 'folder'
  const expanded = useUi((s) => s.expanded[row.id]) || forceOpen
  const toggle = useUi((s) => s.toggleExpanded)
  const activeKey = useTabs((s) => s.byWs[ws]?.active)
  const viewers = usePresence(useShallow((s) => s.users.filter((u) => u.itemId === row.id && u.id !== me.id)))
  const open = useOpen()
  const [drop, setDrop] = useState<DropPos | null>(null)
  const isActive = activeKey === (isFolder ? `folder:${row.id}` : `req:${row.id}`)

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('application/x-cartero-item', JSON.stringify({ id: row.id, collectionId: row.collectionId }))
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragOver = (e: DragEvent) => {
    if (!canEdit || !e.dataTransfer.types.includes('application/x-cartero-item')) return
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = (e.clientY - rect.top) / rect.height
    setDrop(isFolder ? (y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside') : y < 0.5 ? 'before' : 'after')
  }
  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const pos = drop
    setDrop(null)
    const raw = e.dataTransfer.getData('application/x-cartero-item')
    if (!raw || !pos) return
    const { id, collectionId } = JSON.parse(raw)
    if (id === row.id) return
    if (collectionId !== row.collectionId) return toast.error(t("Solo se puede mover dentro de la misma colección"))
    let parentId: string | null
    let index: number
    if (pos === 'inside') {
      parentId = row.id
      index = node.children.length
      toggle(row.id, true)
    } else {
      parentId = row.parentId
      const without = siblings.filter((s) => s.row.id !== id)
      const myIdx = without.findIndex((s) => s.row.id === row.id)
      index = pos === 'before' ? myIdx : myIdx + 1
    }
    try {
      await api.post(`/api/items/${id}/move`, { parentId, index })
      invalidate()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const rename = async () => {
    const name = await prompt(isFolder ? t("Renombrar carpeta") : t("Renombrar petición"), { value: row.name, confirm: t("Guardar") })
    if (!name) return
    await api.patch(`/api/items/${row.id}`, { name })
    useTabs.getState().byWs[ws]?.tabs.forEach((tItem) => {
      if ('itemId' in tItem && tItem.itemId === row.id) useTabs.getState().update(ws, tItem.key, { title: name })
    })
    invalidate()
  }

  const menu: (MenuItem | 'separator')[] = [
    ...(isFolder
      ? [
          ...(canEdit
            ? [
                { label: t("Nueva petición"), icon: <FilePlus />, onSelect: () => onAdd('request', row.id) },
                { label: t("Nueva carpeta"), icon: <FolderPlus />, onSelect: () => onAdd('folder', row.id) },
                'separator' as const,
              ]
            : []),
          { label: t("Ejecutar carpeta"), icon: <Play />, onSelect: () => open.runner(row.collectionId, `${collectionName} / ${row.name}`, row.id) },
          { label: t("Configuración"), icon: <Settings2 />, onSelect: () => open.folder(row) },
        ]
      : []),
    ...(canEdit
      ? [
          { label: t("Renombrar"), icon: <Pencil />, onSelect: rename },
          {
            label: t("Duplicar"),
            icon: <Copy />,
            onSelect: async () => {
              await api.post(`/api/items/${row.id}/duplicate`)
              invalidate()
            },
          },
          'separator' as const,
          {
            label: t("Eliminar"),
            icon: <Trash2 />,
            danger: true,
            onSelect: async () => {
              const ok = await confirm(t("Eliminar"), isFolder ? t('¿Eliminar «{0}» y todo su contenido? Puedes restaurarlo desde el historial de cambios.', [row.name]) : t('¿Eliminar «{0}»? Puedes restaurarlo desde el historial de cambios.', [row.name]), {
                confirm: t("Eliminar"),
                danger: true,
              })
              if (!ok) return
              await api.del(`/api/items/${row.id}`)
              useTabs.getState().removeWhere(ws, (tItem) => 'itemId' in tItem && tItem.itemId === row.id)
              invalidate()
            },
          },
        ]
      : []),
  ]

  return (
    <div>
      <div
        draggable={canEdit}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={() => setDrop(null)}
        onDrop={onDrop}
        onClick={() => (isFolder ? toggle(row.id) : open.request(row))}
        onDoubleClick={() => isFolder && open.folder(row)}
        className={cx(
          'group relative flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-1 pl-1.5',
          isActive ? 'bg-brand-500/10 text-app' : 'hover:bg-muted',
          drop === 'inside' && 'ring-2 ring-brand-500 ring-inset',
        )}
      >
        {drop === 'before' && <span className="absolute inset-x-1 -top-px h-0.5 rounded bg-brand-500" />}
        {drop === 'after' && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded bg-brand-500" />}
        {isFolder ? (
          <>
            <ChevronRight className={cx('size-3 shrink-0 text-muted transition-transform', expanded && 'rotate-90')} />
            {expanded ? <FolderOpen className="size-3.5 shrink-0 text-muted" /> : <Folder className="size-3.5 shrink-0 text-muted" />}
          </>
        ) : (
          <MethodBadge method={row.data.request?.method ?? 'GET'} className="w-10 shrink-0 text-right" />
        )}
        <span className="flex-1 truncate">{row.name}</span>
        {viewers.map((v) => (
          <span key={v.id} title={t("{0} está aquí", [v.name])} className="size-2 shrink-0 rounded-full" style={{ background: v.color }} />
        ))}
        {menu.length > 0 && (
          <Menu
            trigger={
              <button onClick={(e) => e.stopPropagation()} className="invisible rounded p-0.5 text-muted group-hover:visible hover:bg-app" aria-label={t("Acciones")}>
                <MoreHorizontal className="size-4" />
              </button>
            }
            items={menu}
          />
        )}
      </div>
      {isFolder && expanded && (
        <div className="ml-3 border-l border-app pl-1">
          {node.children.length === 0 && <div className="px-2 py-1 text-xs text-muted">{t("Carpeta vacía")}</div>}
          {node.children.map((c) => (
            <ItemNode key={c.row.id} node={c} siblings={node.children} depth={depth + 1} collectionName={collectionName} onAdd={onAdd} invalidate={invalidate} forceOpen={forceOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

export function useWorkspaceOptions() {
  const { data } = useWorkspaces()
  return (data ?? []).filter((w) => w.role !== 'viewer')
}
