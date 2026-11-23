import * as Popover from '@radix-ui/react-popover'
import { BookOpen, Bot, CircleHelp, Eye, Keyboard, Monitor, Rocket, Search, ShieldCheck, Wand2 } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useEffect, useState } from 'react'
import { useEnvironments, useGlobals } from '@/api/hooks'
import { Dialog, Menu, Tooltip } from '@/components/ui'
import { useUi } from '@/store/ui'
import { useTour } from '../onboarding/Tour'
import { DesktopDownloadDialog } from './DesktopDownload'
import { usePalette } from '../palette/CommandPalette'
import { useOpen } from '../workspace/actions'
import { useWs } from '../workspace/context'
import { lang, t } from "@/i18n";

const SHORTCUTS: [string, string][] = [
  [t("Ctrl + K"), t("Buscar peticiones, entornos y acciones")],
  [t("Ctrl + T"), t("Nueva petición")],
  [t("Ctrl + Enter"), t("Enviar la petición")],
  [t("Ctrl + S"), t('Guardar')],
  [t("Ctrl + Alt + W"), t("Cerrar la pestaña")],
  [t("Clic central"), t("Cerrar una pestaña")],
  [t("Clic derecho en pestaña"), t("Cerrar las demás")],
  [t("Ctrl + Espacio"), t("Autocompletar en scripts (API pm.*)")],
  [t("Ctrl + Enter (comentario)"), t("Enviar un comentario")],
  ['?', t("Ver estos atajos")],
  ['Esc', t("Cerrar diálogos y el recorrido")],
]

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Atajos de teclado")} description={t("En Mac, usa ⌘ en lugar de Ctrl.")}>
      <table className="w-full">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k} className="border-b border-app last:border-0">
              <td className="py-2 pr-4">
                {k.split(' + ').map((p, i) => (
                  <span key={p}>
                    {i > 0 && <span className="mx-1 text-muted">+</span>}
                    <kbd className="rounded border border-app bg-soft px-1.5 py-0.5 font-mono text-[11px]">{p}</kbd>
                  </span>
                ))}
              </td>
              <td className="py-2 text-muted">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  )
}

/** Botones de la barra superior: búsqueda (Ctrl+K) y ayuda. */
export function HelpMenu() {
  const [shortcuts, setShortcuts] = useState(false)
  const [desktop, setDesktop] = useState(false)
  const startTour = useTour((s) => s.start)
  const openSettings = useUi((s) => s.openSettings)
  const setPalette = usePalette((s) => s.setOpen)
  const register = usePalette((s) => s.register)
  const { me } = useWs()
  const nav = useNavigate()

  useEffect(() => {
    register({ onShortcuts: () => setShortcuts(true) })
    const onKey = (e: KeyboardEvent) => {
      const tItem = e.target as HTMLElement
      if (e.key === '?' && !/INPUT|TEXTAREA|SELECT/.test(tItem.tagName) && !tItem.isContentEditable && !tItem.closest('.monaco-editor')) {
        e.preventDefault()
        setShortcuts(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [register])

  return (
    <>
      <button
        data-tour="palette"
        onClick={() => setPalette(true)}
        className="flex h-7 w-56 items-center gap-2 rounded-md border border-app bg-soft px-2.5 text-xs text-muted hover:text-app"
      >
        <Search className="size-3.5" />
        <span className="flex-1 text-left">{t("Buscar…")}</span>
        <kbd className="rounded border border-app bg-app px-1 font-mono text-[10px]">{t("Ctrl K")}</kbd>
      </button>
      <Menu
        trigger={
          <button data-tour="help" className="rounded-md p-1.5 text-muted hover:bg-muted hover:text-app" aria-label={t("Ayuda")}>
            <CircleHelp className="size-4" />
          </button>
        }
        items={[
          { label: t("Manual de uso"), icon: <BookOpen />, onSelect: () => window.open('/ayuda', '_blank') },
          { label: t("Recorrido guiado"), icon: <Wand2 />, onSelect: startTour },
          { label: t("Atajos de teclado"), icon: <Keyboard />, shortcut: '?', onSelect: () => setShortcuts(true) },
          'separator',
          { label: t("Conectar con IA (MCP)"), icon: <Bot />, onSelect: () => openSettings('ai') },
          { label: t('Descargar la app de escritorio'), icon: <Monitor />, onSelect: () => setDesktop(true) },
          ...(me.role === 'admin'
            ? [
                'separator' as const,
                { label: t('Guía de administración'), icon: <ShieldCheck />, onSelect: () => window.open(`/ayuda/${lang === 'en' ? '17-admin-and-social-login' : '17-administracion-y-login-social'}`, '_blank') },
                { label: t('Asistente de instalación'), icon: <Rocket />, onSelect: () => nav('/setup') },
              ]
            : []),
        ]}
      />
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
      <DesktopDownloadDialog open={desktop} onOpenChange={setDesktop} />
    </>
  )
}

/** Vistazo rápido a las variables activas (entorno + globales). */
export function EnvQuickLook() {
  const { ws } = useWs()
  const activeEnv = useUi((s) => s.activeEnv[ws])
  const { data: envs } = useEnvironments(ws)
  const { data: globals } = useGlobals(ws)
  const env = envs?.find((e) => e.id === activeEnv)
  const open = useOpen()
  const mask = (v: any) => (v.type === 'secret' ? '••••••' : String(v.value ?? ''))

  const Table = ({ title, rows, onEdit }: { title: string; rows: any[]; onEdit: () => void }) => (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted uppercase">{title}</span>
        <button onClick={onEdit} className="text-xs text-brand-700 hover:underline dark:text-brand-400">
          {t("Editar")}</button>
      </div>
      {rows.length === 0 ? (
        <div className="py-1 text-xs text-muted">{t("Sin variables")}</div>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {rows.map((v) => (
              <tr key={v.key} className={v.disabled ? 'opacity-40' : ''}>
                <td className="py-0.5 pr-3 font-mono font-medium">{v.key}</td>
                <td className="max-w-52 truncate py-0.5 font-mono text-muted">{mask(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )

  return (
    <Popover.Root>
      <Tooltip content={t("Ver variables")}>
        <Popover.Trigger asChild>
          <button className="rounded-md p-1.5 text-muted hover:bg-muted hover:text-app" aria-label={t("Ver variables")}>
            <Eye className="size-4" />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-[60] max-h-[70vh] w-96 space-y-4 overflow-auto rounded-xl border border-app bg-app p-4 shadow-xl">
          {env ? (
            <Table title={env.name} rows={env.values} onEdit={() => open.environment(env.id, env.name)} />
          ) : (
            <div className="text-xs text-muted">{t("No hay ningún entorno activo.")}</div>
          )}
          <Table title={t("Globales")} rows={globals ?? []} onEdit={() => open.globals()} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
