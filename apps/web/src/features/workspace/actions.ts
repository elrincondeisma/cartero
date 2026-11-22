import type { RequestItem } from '@cartero/core'
import type { ItemRow } from '@/api/types'
import { rowToRequestItem } from '@/lib/tree'
import { emptyRequest } from '@/lib/request'
import { useTabs } from '@/store/tabs'
import { useUi } from '@/store/ui'
import { useWs } from './context'

/** Acciones para abrir pestañas desde cualquier sitio. */
export function useOpen() {
  const { ws } = useWs()
  const open = useTabs((s) => s.open)
  const setSection = useUi((s) => s.setSection)
  const ensureTabsVisible = () => {
    const s = useUi.getState().section
    if (s !== 'collections' && s !== 'environments' && s !== 'history') setSection('collections')
  }

  return {
    request(row: ItemRow) {
      ensureTabsVisible()
      // Si ya está abierta, no machacar el borrador
      const existing = useTabs.getState().byWs[ws]?.tabs.find((t) => t.key === `req:${row.id}`)
      if (existing) return useTabs.getState().setActive(ws, existing.key)
      open(ws, {
        kind: 'request',
        itemId: row.id,
        collectionId: row.collectionId,
        title: row.name,
        draft: rowToRequestItem(row),
        baseVersion: row.version,
        dirty: false,
      })
    },
    newRequest(init?: Partial<RequestItem>, collectionId?: string | null) {
      ensureTabsVisible()
      open(ws, {
        kind: 'request',
        title: init?.name ?? 'Nueva petición',
        collectionId: collectionId ?? null,
        draft: { name: init?.name ?? 'Nueva petición', request: emptyRequest(), ...init } as RequestItem,
        dirty: false,
      })
    },
    folder(row: ItemRow) {
      ensureTabsVisible()
      open(ws, { kind: 'folder', itemId: row.id, collectionId: row.collectionId, title: row.name })
    },
    collection(id: string, name: string) {
      ensureTabsVisible()
      open(ws, { kind: 'collection', collectionId: id, title: name })
    },
    environment(id: string, name: string) {
      ensureTabsVisible()
      open(ws, { kind: 'environment', envId: id, title: name })
    },
    globals() {
      ensureTabsVisible()
      open(ws, { kind: 'globals', title: 'Globales' })
    },
    runner(collectionId: string, title: string, folderId?: string) {
      ensureTabsVisible()
      open(ws, { kind: 'runner', collectionId, folderId, title: `Runner · ${title}` })
    },
    run(runId: string, title: string) {
      ensureTabsVisible()
      open(ws, { kind: 'run', runId, title })
    },
  }
}
