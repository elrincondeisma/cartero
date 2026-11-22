import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useQueries } from '@tanstack/react-query'
import {
  Activity,
  BookOpen,
  Bot,
  Clock,
  FileUp,
  FolderTree,
  Keyboard,
  Moon,
  Plus,
  Search,
  Server,
  Settings,
  Variable,
  Wand2,
  Zap,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { api } from '@/api/client'
import { qk, useCollections, useEnvironments } from '@/api/hooks'
import type { CollectionDetail } from '@/api/types'
import { MethodBadge, cx } from '@/components/ui'
import { useUi } from '@/store/ui'
import { useTour } from '../onboarding/Tour'
import { useOpen } from '../workspace/actions'
import { useWs } from '../workspace/context'

interface PaletteState {
  open: boolean
  setOpen: (v: boolean) => void
  /** Acciones externas que la paleta puede lanzar */
  onImport?: () => void
  onShortcuts?: () => void
  register: (a: { onImport?: () => void; onShortcuts?: () => void }) => void
}

export const usePalette = create<PaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  register: (a) => set(a),
}))

interface Entry {
  id: string
  group: string
  label: string
  hint?: string
  icon: ReactNode
  keywords?: string
  run: () => void
}

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function CommandPalette() {
  const { ws } = useWs()
  const { open, setOpen, onImport, onShortcuts } = usePalette()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const { data: collections } = useCollections(ws)
  const { data: envs } = useEnvironments(ws)
  const details = useQueries({
    queries: (open ? (collections ?? []) : []).map((c) => ({
      queryKey: qk.collection(c.id),
      queryFn: () => api.get<CollectionDetail>(`/api/collections/${c.id}`),
      staleTime: 30_000,
    })),
  })
  const go = useOpen()
  const ui = useUi()
  const startTour = useTour((s) => s.start)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!usePalette.getState().open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
    }
  }, [open])

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [
      { id: 'a-new', group: 'Acciones', label: 'Nueva petición', hint: 'Ctrl+T', icon: <Plus />, run: () => go.newRequest() },
      { id: 'a-import', group: 'Acciones', label: 'Importar (Postman, Insomnia, OpenAPI, cURL)', icon: <FileUp />, run: () => onImport?.() },
      { id: 'a-theme', group: 'Acciones', label: ui.theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro', icon: <Moon />, run: ui.toggleTheme },
      { id: 'a-tour', group: 'Acciones', label: 'Repetir el recorrido guiado', icon: <Wand2 />, run: startTour },
      { id: 'a-keys', group: 'Acciones', label: 'Atajos de teclado', hint: '?', icon: <Keyboard />, run: () => onShortcuts?.() },
      { id: 'a-manual', group: 'Acciones', label: 'Abrir el manual', icon: <BookOpen />, run: () => window.open('/ayuda', '_blank') },
      { id: 'a-mcp', group: 'Acciones', label: 'Conectar con un asistente de IA (MCP)', icon: <Bot />, keywords: 'claude cursor ia ai', run: () => ui.openSettings('ai') },
      { id: 's-col', group: 'Ir a', label: 'Colecciones', icon: <FolderTree />, run: () => ui.setSection('collections') },
      { id: 's-env', group: 'Ir a', label: 'Entornos', icon: <Variable />, run: () => ui.setSection('environments') },
      { id: 's-his', group: 'Ir a', label: 'Historial', icon: <Clock />, run: () => ui.setSection('history') },
      { id: 's-run', group: 'Ir a', label: 'Ejecuciones', icon: <Zap />, run: () => ui.setSection('runs') },
      { id: 's-mock', group: 'Ir a', label: 'Mock servers', icon: <Server />, run: () => ui.setSection('mocks') },
      { id: 's-mon', group: 'Ir a', label: 'Monitores', icon: <Activity />, run: () => ui.setSection('monitors') },
      { id: 's-set', group: 'Ir a', label: 'Ajustes', icon: <Settings />, run: () => ui.setSection('settings') },
    ]
    out.push({ id: 'e-none', group: 'Entornos', label: 'Sin entorno', icon: <Variable />, keywords: 'desactivar entorno', run: () => ui.setActiveEnv(ws, null) })
    for (const e of envs ?? [])
      out.push({
        id: `e-${e.id}`,
        group: 'Entornos',
        label: `Activar «${e.name}»`,
        hint: ui.activeEnv[ws] === e.id ? 'activo' : undefined,
        icon: <Variable />,
        keywords: e.name,
        run: () => ui.setActiveEnv(ws, e.id),
      })
    for (const d of details) {
      const col = d.data
      if (!col) continue
      out.push({ id: `c-${col.id}`, group: 'Colecciones', label: col.name, icon: <FolderTree />, run: () => go.collection(col.id, col.name) })
      out.push({ id: `r-${col.id}`, group: 'Colecciones', label: `Ejecutar «${col.name}»`, icon: <Zap />, keywords: 'runner run', run: () => go.runner(col.id, col.name) })
      const folders = new Map(col.items.filter((i) => i.type === 'folder').map((f) => [f.id, f.name]))
      for (const i of col.items) {
        if (i.type !== 'request') continue
        const url = (i.data.request?.url as any)?.raw ?? i.data.request?.url ?? ''
        out.push({
          id: `q-${i.id}`,
          group: 'Peticiones',
          label: i.name,
          hint: [col.name, i.parentId && folders.get(i.parentId)].filter(Boolean).join(' / '),
          icon: <MethodBadge method={i.data.request?.method ?? 'GET'} className="w-10 text-right" />,
          keywords: `${url} ${i.data.request?.method}`,
          run: () => go.request(i),
        })
      }
    }
    return out
  }, [details, envs, go, ui, ws, onImport, onShortcuts, startTour])

  const results = useMemo(() => {
    const tokens = normalize(q).split(/\s+/).filter(Boolean)
    if (!tokens.length) return entries.filter((e) => e.group !== 'Peticiones').concat(entries.filter((e) => e.group === 'Peticiones').slice(0, 8))
    const scored = entries
      .map((e) => {
        const hay = normalize(`${e.label} ${e.hint ?? ''} ${e.keywords ?? ''}`)
        if (!tokens.every((t) => hay.includes(t))) return null
        const label = normalize(e.label)
        const score = (label.startsWith(tokens[0]) ? 3 : 0) + (label.includes(tokens.join(' ')) ? 2 : 0) + (e.group === 'Peticiones' ? 1 : 0)
        return { e, score }
      })
      .filter(Boolean) as { e: Entry; score: number }[]
    return scored.sort((a, b) => b.score - a.score).slice(0, 60).map((s) => s.e)
  }, [entries, q])

  useEffect(() => setSel(0), [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const run = (e?: Entry) => {
    if (!e) return
    setOpen(false)
    setTimeout(e.run, 10)
  }

  let lastGroup = ''
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[150] bg-black/30" />
        <DialogPrimitive.Content className="fixed top-[14vh] left-1/2 z-[150] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-app bg-app shadow-2xl outline-none">
          <DialogPrimitive.Title className="sr-only">Buscar</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-app px-4">
            <Search className="size-4 text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSel((s) => Math.min(results.length - 1, s + 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSel((s) => Math.max(0, s - 1))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  run(results[sel])
                }
              }}
              placeholder="Busca peticiones, colecciones, entornos o acciones…"
              className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted"
            />
            <kbd className="rounded border border-app px-1.5 font-mono text-[10px] text-muted">Esc</kbd>
          </div>
          <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
            {results.length === 0 && <div className="p-6 text-center text-muted">Sin resultados para «{q}»</div>}
            {results.map((e, i) => {
              const header = e.group !== lastGroup
              lastGroup = e.group
              return (
                <div key={e.id}>
                  {header && <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold text-muted uppercase">{e.group}</div>}
                  <button
                    data-index={i}
                    onMouseMove={() => setSel(i)}
                    onClick={() => run(e)}
                    className={cx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left', i === sel && 'bg-brand-500/10')}
                  >
                    <span className="flex w-10 shrink-0 justify-end text-muted [&>svg]:size-4">{e.icon}</span>
                    <span className="truncate">{e.label}</span>
                    {e.hint && <span className="ml-auto shrink-0 truncate pl-3 text-xs text-muted">{e.hint}</span>}
                  </button>
                </div>
              )
            })}
          </div>
          <div className="flex gap-4 border-t border-app px-4 py-2 text-[11px] text-muted">
            <span>↑↓ moverse</span>
            <span>↵ abrir</span>
            <span>Ctrl+K abrir/cerrar</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
