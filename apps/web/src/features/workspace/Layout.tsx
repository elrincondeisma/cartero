import { useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Boxes,
  ChevronDown,
  Clock,
  FolderTree,
  LogOut,
  Moon,
  Plus,
  Server,
  Settings,
  Sun,
  Variable,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { qk, useEnvironments, useMe, useWorkspaces } from '@/api/hooks'
import { prompt } from '@/components/dialogs'
import { Logo } from '@/components/Logo'
import { Menu, Select, Spinner, Tooltip, cx } from '@/components/ui'
import { useRealtime } from '@/lib/realtime'
import { useTabs } from '@/store/tabs'
import { type Section, usePresence, useUi } from '@/store/ui'
import { CollectionsSidebar } from '../collections/Sidebar'
import { EnvironmentsSidebar } from '../environments/Sidebar'
import { HistorySidebar } from '../history/Sidebar'
import { MocksPage } from '../mocks/MocksPage'
import { MonitorsPage } from '../monitors/MonitorsPage'
import { RunsPage } from '../runs/RunsPage'
import { SettingsPage } from '../settings/SettingsPage'
import { ImportDialog } from '../collections/ImportDialog'
import { EnvQuickLook, HelpMenu } from '../help/HelpMenu'
import { Tour } from '../onboarding/Tour'
import { Welcome } from '../onboarding/Welcome'
import { CommandPalette, usePalette } from '../palette/CommandPalette'
import { TabsArea } from './TabsArea'
import { WorkspaceContext, type WorkspaceCtx, useWs } from './context'

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'collections', label: 'Colecciones', icon: <FolderTree /> },
  { id: 'environments', label: 'Entornos', icon: <Variable /> },
  { id: 'history', label: 'Historial', icon: <Clock /> },
  { id: 'runs', label: 'Ejecuciones', icon: <Zap /> },
  { id: 'mocks', label: 'Mock servers', icon: <Server /> },
  { id: 'monitors', label: 'Monitores', icon: <Activity /> },
  { id: 'settings', label: 'Ajustes', icon: <Settings /> },
]

const FULL_PAGES: Section[] = ['runs', 'mocks', 'monitors', 'settings']

export function WorkspaceLayout() {
  const { ws = '' } = useParams()
  const { data: me } = useMe()
  const { data: workspaces, isLoading } = useWorkspaces()
  const workspace = workspaces?.find((w) => w.id === ws)
  const section = useUi((s) => s.section)
  const activeTab = useTabs((s) => s.byWs[ws]?.tabs.find((t) => t.key === s.byWs[ws]?.active))
  const currentItem = activeTab && 'itemId' in activeTab ? activeTab.itemId : undefined

  useRealtime(workspace ? ws : '', me?.id, currentItem)

  useEffect(() => {
    if (workspace) localStorage.setItem('cartero-last-ws', ws)
  }, [workspace, ws])

  const ctx = useMemo<WorkspaceCtx | null>(() => {
    if (!workspace || !me) return null
    return {
      ws,
      workspace,
      role: workspace.role,
      canEdit: workspace.role !== 'viewer',
      isAdmin: workspace.role === 'owner' || workspace.role === 'admin',
      me,
    }
  }, [workspace, me, ws])

  if (isLoading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  if (!workspace) return <Navigate to="/" replace />
  if (!ctx) return null

  return (
    <WorkspaceContext.Provider value={ctx}>
      <div className="flex h-full flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <Rail />
          {!FULL_PAGES.includes(section) && <ResizableSidebar />}
          <main className="flex min-w-0 flex-1 flex-col">
            {section === 'runs' && <RunsPage />}
            {section === 'mocks' && <MocksPage />}
            {section === 'monitors' && <MonitorsPage />}
            {section === 'settings' && <SettingsPage />}
            {!FULL_PAGES.includes(section) && <TabsArea />}
          </main>
        </div>
      </div>
      <GlobalImport />
      <CommandPalette />
      <Welcome />
      <Tour />
    </WorkspaceContext.Provider>
  )
}

/** Diálogo de importación accesible desde la paleta de comandos. */
function GlobalImport() {
  const [open, setOpen] = useState(false)
  const register = usePalette((s) => s.register)
  useEffect(() => register({ onImport: () => setOpen(true) }), [register])
  return <ImportDialog open={open} onOpenChange={setOpen} />
}

function ResizableSidebar() {
  const section = useUi((s) => s.section)
  const width = useUi((s) => s.sidebarWidth)
  const setWidth = useUi((s) => s.setSidebarWidth)
  const dragging = useRef(false)

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return
      setWidth(Math.min(560, Math.max(200, e.clientX - 52)))
    }
    const up = () => {
      dragging.current = false
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [setWidth])

  return (
    <aside data-tour="collections" className="relative flex shrink-0 flex-col border-r border-app bg-soft" style={{ width }}>
      {section === 'collections' && <CollectionsSidebar />}
      {section === 'environments' && <EnvironmentsSidebar />}
      {section === 'history' && <HistorySidebar />}
      <div
        className="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize hover:bg-brand-500/30"
        onMouseDown={() => {
          dragging.current = true
          document.body.style.cursor = 'col-resize'
        }}
      />
    </aside>
  )
}

function Rail() {
  const section = useUi((s) => s.section)
  const setSection = useUi((s) => s.setSection)
  return (
    <nav data-tour="rail" className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r border-app bg-app py-2">
      {SECTIONS.map((s) => (
        <Tooltip key={s.id} content={s.label} side="right">
          <button
            onClick={() => setSection(s.id)}
            aria-label={s.label}
            className={cx(
              'flex size-9 items-center justify-center rounded-lg transition-colors [&>svg]:size-[18px]',
              section === s.id ? 'bg-brand-500/12 text-brand-600 dark:text-brand-400' : 'text-muted hover:bg-muted hover:text-app',
            )}
          >
            {s.icon}
          </button>
        </Tooltip>
      ))}
    </nav>
  )
}

function TopBar() {
  const { ws, workspace, me } = useWs()
  const { data: workspaces } = useWorkspaces()
  const { data: envs } = useEnvironments(ws)
  const activeEnv = useUi((s) => s.activeEnv[ws] ?? '')
  const setActiveEnv = useUi((s) => s.setActiveEnv)
  const theme = useUi((s) => s.theme)
  const toggleTheme = useUi((s) => s.toggleTheme)
  const users = usePresence((s) => s.users)
  const nav = useNavigate()
  const qc = useQueryClient()

  // Si el entorno activo ya no existe, desactivarlo
  useEffect(() => {
    if (envs && activeEnv && !envs.some((e) => e.id === activeEnv)) setActiveEnv(ws, null)
  }, [envs, activeEnv, ws, setActiveEnv])

  const createWorkspace = async () => {
    const name = await prompt('Nuevo workspace', { label: 'Nombre del workspace de equipo', confirm: 'Crear' })
    if (!name) return
    const w = await api.post<{ id: string }>('/api/workspaces', { name })
    await qc.invalidateQueries({ queryKey: qk.workspaces })
    nav(`/w/${w.id}`)
  }

  const logout = async () => {
    await api.post('/api/auth/logout')
    qc.clear()
    nav('/login')
  }

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-app bg-app px-3">
      <Logo />
      <div className="mx-1 h-5 w-px bg-muted" />
      <Menu
        align="start"
        trigger={
          <button className="flex items-center gap-1.5 rounded-md px-2 py-1 font-medium hover:bg-muted">
            <Boxes className="size-4 text-muted" />
            {workspace.name}
            <ChevronDown className="size-3.5 text-muted" />
          </button>
        }
        items={[
          ...(workspaces ?? []).map((w) => ({
            label: `${w.name}${w.type === 'personal' ? ' (personal)' : ''}`,
            onSelect: () => nav(`/w/${w.id}`),
          })),
          'separator' as const,
          { label: 'Nuevo workspace de equipo', icon: <Plus />, onSelect: createWorkspace },
        ]}
      />
      <div className="flex-1" />
      {users.length > 1 && (
        <div className="flex -space-x-1.5">
          {users
            .filter((u) => u.id !== me.id)
            .slice(0, 6)
            .map((u) => (
              <Tooltip key={u.id} content={`${u.name} está conectado`}>
                <span
                  className="flex size-6 items-center justify-center rounded-full border-2 border-[var(--bg)] text-[10px] font-semibold text-white"
                  style={{ background: u.color }}
                >
                  {initials(u.name)}
                </span>
              </Tooltip>
            ))}
        </div>
      )}
      <HelpMenu />
      <div data-tour="env" className="flex items-center gap-0.5">
      <Select
        value={activeEnv}
        onChange={(e) => setActiveEnv(ws, e.target.value || null)}
        className="h-7 w-48 text-xs"
        aria-label="Entorno activo"
      >
        <option value="">Sin entorno</option>
        {envs?.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </Select>
      <EnvQuickLook />
      </div>
      <Tooltip content={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}>
        <button onClick={toggleTheme} className="rounded-md p-1.5 text-muted hover:bg-muted hover:text-app" aria-label="Cambiar tema">
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </Tooltip>
      <Menu
        trigger={
          <button className="flex size-7 items-center justify-center rounded-full bg-brand-600 text-[11px] font-semibold text-white" aria-label="Cuenta">
            {initials(me.name)}
          </button>
        }
        items={[
          { label: me.email, onSelect: () => {}, disabled: true },
          'separator',
          {
            label: 'Cerrar sesión',
            icon: <LogOut />,
            onSelect: () => logout().catch((e) => toast.error(e.message)),
          },
        ]}
      />
    </header>
  )
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}
