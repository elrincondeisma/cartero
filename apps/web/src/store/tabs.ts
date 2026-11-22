import type { RequestItem } from '@cartero/core'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ExecuteResult } from '@/api/types'

export type Tab =
  | {
      key: string
      kind: 'request'
      itemId?: string
      collectionId?: string | null
      title: string
      draft: RequestItem
      baseVersion?: number
      dirty: boolean
      /** El servidor tiene una versión más nueva mientras había cambios locales */
      remoteChanged?: boolean
    }
  | { key: string; kind: 'folder'; itemId: string; collectionId: string; title: string }
  | { key: string; kind: 'collection'; collectionId: string; title: string }
  | { key: string; kind: 'environment'; envId: string; title: string }
  | { key: string; kind: 'globals'; title: string }
  | { key: string; kind: 'runner'; collectionId: string; folderId?: string; title: string }
  | { key: string; kind: 'run'; runId: string; title: string }

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never
export type NewTab = DistributiveOmit<Tab, 'key'> & { key?: string }

interface TabsState {
  /** Pestañas por workspace */
  byWs: Record<string, { tabs: Tab[]; active?: string }>
  open: (ws: string, tab: NewTab, opts?: { replacePreview?: boolean }) => string
  close: (ws: string, key: string) => void
  closeOthers: (ws: string, key: string) => void
  setActive: (ws: string, key: string) => void
  update: (ws: string, key: string, patch: Partial<Tab>) => void
  /** Reemplaza la pestaña de una petición sin guardar por la ya guardada */
  rekey: (ws: string, oldKey: string, tab: Tab) => void
  removeWhere: (ws: string, pred: (t: Tab) => boolean) => void
}

export function tabKey(tab: NewTab): string {
  if (tab.key) return tab.key
  switch (tab.kind) {
    case 'request':
      return tab.itemId ? `req:${tab.itemId}` : `new:${crypto.randomUUID()}`
    case 'folder':
      return `folder:${tab.itemId}`
    case 'collection':
      return `col:${tab.collectionId}`
    case 'environment':
      return `env:${tab.envId}`
    case 'globals':
      return 'globals'
    case 'runner':
      return `runner:${tab.collectionId}:${tab.folderId ?? ''}`
    case 'run':
      return `run:${tab.runId}`
  }
}

export const useTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      byWs: {},
      open: (ws, tab) => {
        const key = tabKey(tab)
        const cur = get().byWs[ws] ?? { tabs: [] }
        const exists = cur.tabs.some((t) => t.key === key)
        set({
          byWs: {
            ...get().byWs,
            [ws]: { tabs: exists ? cur.tabs : [...cur.tabs, { ...tab, key } as Tab], active: key },
          },
        })
        return key
      },
      close: (ws, key) => {
        const cur = get().byWs[ws]
        if (!cur) return
        const idx = cur.tabs.findIndex((t) => t.key === key)
        const tabs = cur.tabs.filter((t) => t.key !== key)
        const active = cur.active === key ? (tabs[Math.min(idx, tabs.length - 1)]?.key ?? undefined) : cur.active
        set({ byWs: { ...get().byWs, [ws]: { tabs, active } } })
      },
      closeOthers: (ws, key) => {
        const cur = get().byWs[ws]
        if (!cur) return
        set({ byWs: { ...get().byWs, [ws]: { tabs: cur.tabs.filter((t) => t.key === key || (t.kind === 'request' && t.dirty)), active: key } } })
      },
      setActive: (ws, key) => {
        const cur = get().byWs[ws]
        if (!cur) return
        set({ byWs: { ...get().byWs, [ws]: { ...cur, active: key } } })
      },
      update: (ws, key, patch) => {
        const cur = get().byWs[ws]
        if (!cur) return
        set({
          byWs: { ...get().byWs, [ws]: { ...cur, tabs: cur.tabs.map((t) => (t.key === key ? ({ ...t, ...patch } as Tab) : t)) } },
        })
      },
      rekey: (ws, oldKey, tab) => {
        const cur = get().byWs[ws]
        if (!cur) return
        const tabs = cur.tabs.filter((t) => t.key !== tab.key).map((t) => (t.key === oldKey ? tab : t))
        set({ byWs: { ...get().byWs, [ws]: { tabs, active: cur.active === oldKey ? tab.key : cur.active } } })
      },
      removeWhere: (ws, pred) => {
        const cur = get().byWs[ws]
        if (!cur) return
        const tabs = cur.tabs.filter((t) => !pred(t))
        const active = tabs.some((t) => t.key === cur.active) ? cur.active : tabs.at(-1)?.key
        set({ byWs: { ...get().byWs, [ws]: { tabs, active } } })
      },
    }),
    { name: 'cartero-tabs', version: 1 },
  ),
)

/** Resultados de envío (no se persisten: pueden ser grandes). */
interface ResultsState {
  results: Record<string, { loading: boolean; result?: ExecuteResult; error?: string; abort?: AbortController }>
  set: (key: string, v: ResultsState['results'][string]) => void
}

export const useResults = create<ResultsState>((set) => ({
  results: {},
  set: (key, v) => set((s) => ({ results: { ...s.results, [key]: v } })),
}))
