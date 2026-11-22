import { FileUp, FolderTree, Globe, Plus, Send, Variable, X, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { confirm } from '@/components/dialogs'
import { Button, Empty, MethodBadge, Menu, cx } from '@/components/ui'
import { type Tab, useTabs } from '@/store/tabs'
import { CollectionTab } from '../collections/CollectionTab'
import { ImportDialog } from '../collections/ImportDialog'
import { EnvironmentTab } from '../environments/EnvironmentTab'
import { RequestTab } from '../request/RequestTab'
import { RunView } from '../runner/RunView'
import { RunnerTab } from '../runner/RunnerTab'
import { useOpen } from './actions'
import { useWs } from './context'

function TabIcon({ tab }: { tab: Tab }) {
  switch (tab.kind) {
    case 'request':
      return <MethodBadge method={tab.draft.request.method} className="w-9 shrink-0 text-right" />
    case 'folder':
    case 'collection':
      return <FolderTree className="size-3.5 shrink-0 text-muted" />
    case 'environment':
      return <Variable className="size-3.5 shrink-0 text-muted" />
    case 'globals':
      return <Globe className="size-3.5 shrink-0 text-muted" />
    case 'runner':
    case 'run':
      return <Zap className="size-3.5 shrink-0 text-muted" />
  }
}

export function TabsArea() {
  const { ws } = useWs()
  const state = useTabs((s) => s.byWs[ws])
  const tabs = state?.tabs ?? []
  const active = tabs.find((t) => t.key === state?.active) ?? tabs[0]
  const { setActive, close, closeOthers } = useTabs.getState()
  const openTab = useOpen()
  const [importOpen, setImportOpen] = useState(false)

  const tryClose = async (tab: Tab) => {
    if (tab.kind === 'request' && tab.dirty) {
      const ok = await confirm('Cambios sin guardar', `«${tab.title}» tiene cambios sin guardar. ¿Cerrar igualmente?`, { confirm: 'Cerrar sin guardar', danger: true })
      if (!ok) return
    }
    close(ws, tab.key)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key.toLowerCase() === 't' && !e.shiftKey) {
        e.preventDefault()
        openTab.newRequest()
      } else if (e.key.toLowerCase() === 'w' && active && e.altKey) {
        e.preventDefault()
        void tryClose(active)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-stretch border-b border-app bg-soft">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {tabs.map((t) => (
            <div
              key={t.key}
              role="tab"
              aria-selected={t.key === active?.key}
              onClick={() => setActive(ws, t.key)}
              onAuxClick={(e) => e.button === 1 && tryClose(t)}
              onContextMenu={(e) => {
                e.preventDefault()
                closeOthers(ws, t.key)
              }}
              title={`${t.title}\n(clic derecho: cerrar las demás)`}
              className={cx(
                'group relative flex max-w-56 min-w-28 cursor-pointer items-center gap-1.5 border-r border-app px-2.5 text-[12.5px] select-none',
                t.key === active?.key ? 'bg-app text-app' : 'text-muted hover:bg-muted/60',
              )}
            >
              {t.key === active?.key && <span className="absolute inset-x-0 top-0 h-0.5 bg-brand-600" />}
              <TabIcon tab={t} />
              <span className="truncate">{t.title}</span>
              <span className="ml-auto flex size-4 shrink-0 items-center justify-center">
                {t.kind === 'request' && t.dirty ? (
                  <span className="size-2 rounded-full bg-brand-500 group-hover:hidden" />
                ) : null}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void tryClose(t)
                  }}
                  className={cx(
                    'rounded p-0.5 hover:bg-muted',
                    t.kind === 'request' && t.dirty ? 'hidden group-hover:block' : 'invisible group-hover:visible',
                    t.key === active?.key && !(t.kind === 'request' && t.dirty) && 'visible',
                  )}
                  aria-label="Cerrar pestaña"
                >
                  <X className="size-3" />
                </button>
              </span>
            </div>
          ))}
        </div>
        <button onClick={() => openTab.newRequest()} className="px-2.5 text-muted hover:bg-muted hover:text-app" aria-label="Nueva petición" title="Nueva petición (Ctrl+T)">
          <Plus className="size-4" />
        </button>
        {tabs.length > 1 && (
          <Menu
            trigger={
              <button className="px-2 text-[11px] text-muted hover:bg-muted hover:text-app" aria-label="Opciones de pestañas">
                ···
              </button>
            }
            items={[
              { label: 'Cerrar las demás', onSelect: () => active && closeOthers(ws, active.key) },
              { label: 'Cerrar las guardadas', onSelect: () => useTabs.getState().removeWhere(ws, (t) => !(t.kind === 'request' && t.dirty)) },
            ]}
          />
        )}
      </div>
      <div className="min-h-0 flex-1">
        {!active && (
          <Empty icon={<Send />} title="Empieza a probar tu API" action={
            <div className="flex gap-2">
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openTab.newRequest()}>
                Nueva petición
              </Button>
              <Button variant="outline" icon={<FileUp className="size-4" />} onClick={() => setImportOpen(true)}>
                Importar
              </Button>
            </div>
          }>
            Abre una petición de la barra lateral, crea una nueva (Ctrl+T) o importa tus colecciones de Postman, Insomnia, OpenAPI o un cURL.
          </Empty>
        )}
        {active?.kind === 'request' && <RequestTab key={active.key} tab={active} />}
        {active?.kind === 'folder' && <CollectionTab key={active.key} collectionId={active.collectionId} folderId={active.itemId} tabKey={active.key} />}
        {active?.kind === 'collection' && <CollectionTab key={active.key} collectionId={active.collectionId} tabKey={active.key} />}
        {active?.kind === 'environment' && <EnvironmentTab key={active.key} envId={active.envId} tabKey={active.key} />}
        {active?.kind === 'globals' && <EnvironmentTab key={active.key} globals tabKey={active.key} />}
        {active?.kind === 'runner' && <RunnerTab key={active.key} collectionId={active.collectionId} folderId={active.folderId} />}
        {active?.kind === 'run' && <RunView key={active.key} runId={active.runId} />}
      </div>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  )
}
