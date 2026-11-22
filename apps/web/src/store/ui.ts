import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PresenceUser } from '@/api/types'

export type Section = 'collections' | 'environments' | 'history' | 'mocks' | 'monitors' | 'runs' | 'settings'

interface UiState {
  theme: 'light' | 'dark'
  section: Section
  /** Entorno activo por workspace */
  activeEnv: Record<string, string | null>
  sidebarWidth: number
  responseHeight: number
  expanded: Record<string, boolean>
  settingsTab: string
  openSettings: (tab?: string) => void
  toggleTheme: () => void
  setSection: (s: Section) => void
  setActiveEnv: (ws: string, envId: string | null) => void
  setSidebarWidth: (w: number) => void
  setResponseHeight: (h: number) => void
  toggleExpanded: (id: string, value?: boolean) => void
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      section: 'collections',
      activeEnv: {},
      sidebarWidth: 290,
      responseHeight: 0.5,
      expanded: {},
      settingsTab: 'workspace',
      openSettings: (tab = 'workspace') => set({ section: 'settings', settingsTab: tab }),
      toggleTheme: () => {
        const theme = get().theme === 'dark' ? 'light' : 'dark'
        document.documentElement.classList.toggle('dark', theme === 'dark')
        localStorage.setItem('cartero-theme', theme)
        set({ theme })
      },
      setSection: (section) => set({ section }),
      setActiveEnv: (ws, envId) => set({ activeEnv: { ...get().activeEnv, [ws]: envId } }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      setResponseHeight: (responseHeight) => set({ responseHeight }),
      toggleExpanded: (id, value) => set({ expanded: { ...get().expanded, [id]: value ?? !get().expanded[id] } }),
    }),
    { name: 'cartero-ui', partialize: (s) => ({ section: s.section, settingsTab: s.settingsTab, activeEnv: s.activeEnv, sidebarWidth: s.sidebarWidth, responseHeight: s.responseHeight, expanded: s.expanded }) },
  ),
)

interface PresenceState {
  users: PresenceUser[]
  setUsers: (u: PresenceUser[]) => void
}

export const usePresence = create<PresenceState>((set) => ({ users: [], setUsers: (users) => set({ users }) }))
