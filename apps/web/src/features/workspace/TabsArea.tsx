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
import { t } from "@/i18n";

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
  const active = tabs.find((tItem) => tItem.key === state?.active) ?? tabs[0]
  const { setActive, close, closeOthers } = useTabs.getState()
  const openTab = useOpen()
  const [importOpen, setImportOpen] = useState(false)

  const tryClose = async (tab: Tab) => {
    if (tab.kind === 'request' && tab.dirty) {
      const ok = await confirm(t("Cambios sin guardar"), t("«{0}» tiene cambios sin guardar. ¿Cerrar igualmente?", [tab.title]), { confirm: t("Cerrar sin guardar"), danger: true })
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
          {tabs.map((tItem) => (
            <div
              key={tItem.key}
              role="tab"
              aria-selected={tItem.key === active?.key}
              onClick={() => setActive(ws, tItem.key)}
              onAuxClick={(e) => e.button === 1 && tryClose(tItem)}
              onContextMenu={(e) => {
                e.preventDefault()
                closeOthers(ws, tItem.key)
              }}
              title={`${tItem.title}
${t('(clic derecho: cerrar las demás)')}`}
              className={cx(
                'group relative flex max-w-56 min-w-28 cursor-pointer items-center gap-1.5 border-r border-app px-2.5 text-[12.5px] select-none',
                tItem.key === active?.key ? 'bg-app text-app' : 'text-muted hover:bg-muted/60',
              )}
            >
              {tItem.key === active?.key && <span className="absolute inset-x-0 top-0 h-0.5 bg-brand-600" />}
              <TabIcon tab={tItem} />
              <span className="truncate">{tItem.title}</span>
              <span className="ml-auto flex size-4 shrink-0 items-center justify-center">
                {tItem.kind === 'request' && tItem.dirty ? (
                  <span className="size-2 rounded-full bg-brand-500 group-hover:hidden" />
                ) : null}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void tryClose(tItem)
                  }}
                  className={cx(
                    'rounded p-0.5 hover:bg-muted',
                    tItem.kind === 'request' && tItem.dirty ? 'hidden group-hover:block' : 'invisible group-hover:visible',
                    tItem.key === active?.key && !(tItem.kind === 'request' && tItem.dirty) && 'visible',
                  )}
                  aria-label={t("Cerrar pestaña")}
                >
                  <X className="size-3" />
                </button>
              </span>
            </div>
          ))}
        </div>
        <button data-tour="new-tab" onClick={() => openTab.newRequest()} className="px-2.5 text-muted hover:bg-muted hover:text-app" aria-label={t("Nueva petición")} title={t("Nueva petición (Ctrl+T)")}>
          <Plus className="size-4" />
        </button>
        {tabs.length > 1 && (
          <Menu
            trigger={
              <button className="px-2 text-[11px] text-muted hover:bg-muted hover:text-app" aria-label={t("Opciones de pestañas")}>
                ···
              </button>
            }
            items={[
              { label: t("Cerrar las demás"), onSelect: () => active && closeOthers(ws, active.key) },
              { label: t("Cerrar las guardadas"), onSelect: () => useTabs.getState().removeWhere(ws, (tItem) => !(tItem.kind === 'request' && tItem.dirty)) },
            ]}
          />
        )}
      </div>
      <div className="min-h-0 flex-1">
        {!active && (
          <Empty icon={<Send />} title={t("Empieza a probar tu API")} action={
            <div className="flex gap-2">
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openTab.newRequest()}>
                {t("Nueva petición")}</Button>
              <Button variant="outline" icon={<FileUp className="size-4" />} onClick={() => setImportOpen(true)}>
                {t("Importar")}</Button>
            </div>
          }>
            {t("Abre una petición de la barra lateral, crea una nueva (Ctrl+T) o importa tus colecciones de Postman, Insomnia, OpenAPI o un cURL.")}</Empty>
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
