import { createContext, useContext } from 'react'
import type { Role, Workspace } from '@/api/types'

export interface WorkspaceCtx {
  ws: string
  workspace: Workspace
  role: Role
  canEdit: boolean
  isAdmin: boolean
  me: { id: string; name: string; email: string }
}

export const WorkspaceContext = createContext<WorkspaceCtx | null>(null)

export function useWs(): WorkspaceCtx {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWs fuera de WorkspaceContext')
  return ctx
}
