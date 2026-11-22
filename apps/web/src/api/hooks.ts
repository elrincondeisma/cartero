import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  CollectionDetail,
  CollectionSummary,
  Comment,
  EnvironmentRow,
  HistoryRow,
  MockRow,
  MonitorRow,
  Revision,
  RunRow,
  User,
  Workspace,
} from './types'
import type { Variable } from '@cartero/core'

export const qk = {
  me: ['me'] as const,
  workspaces: ['workspaces'] as const,
  collections: (ws: string) => ['collections', ws] as const,
  collection: (id: string) => ['collection', id] as const,
  environments: (ws: string) => ['environments', ws] as const,
  globals: (ws: string) => ['globals', ws] as const,
  history: (ws: string) => ['history', ws] as const,
  runs: (ws: string, filter?: Record<string, string | undefined>) => ['runs', ws, filter ?? {}] as const,
  run: (id: string) => ['run', id] as const,
  mocks: (ws: string) => ['mocks', ws] as const,
  monitors: (ws: string) => ['monitors', ws] as const,
  revisions: (collectionId: string, itemId?: string) => ['revisions', collectionId, itemId ?? null] as const,
  comments: (collectionId: string, itemId?: string | null) => ['comments', collectionId, itemId ?? null] as const,
  members: (ws: string) => ['members', ws] as const,
  tokens: ['tokens'] as const,
}

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => api.get<User>('/api/auth/me').catch((e) => (e.status === 401 ? null : Promise.reject(e))),
    staleTime: 60_000,
  })
}

export function useWorkspaces() {
  return useQuery({ queryKey: qk.workspaces, queryFn: () => api.get<Workspace[]>('/api/workspaces') })
}

export function useCollections(ws: string) {
  return useQuery({ queryKey: qk.collections(ws), queryFn: () => api.get<CollectionSummary[]>(`/api/workspaces/${ws}/collections`) })
}

export function useCollection(id: string | undefined) {
  return useQuery({
    queryKey: qk.collection(id ?? ''),
    queryFn: () => api.get<CollectionDetail>(`/api/collections/${id}`),
    enabled: !!id,
  })
}

export function useEnvironments(ws: string) {
  return useQuery({ queryKey: qk.environments(ws), queryFn: () => api.get<EnvironmentRow[]>(`/api/workspaces/${ws}/environments`) })
}

export function useGlobals(ws: string) {
  return useQuery({ queryKey: qk.globals(ws), queryFn: () => api.get<Variable[]>(`/api/workspaces/${ws}/globals`) })
}

export function useHistory(ws: string) {
  return useQuery({ queryKey: qk.history(ws), queryFn: () => api.get<HistoryRow[]>(`/api/workspaces/${ws}/history`) })
}

export function useRuns(ws: string, filter?: { collectionId?: string; monitorId?: string }) {
  const qs = new URLSearchParams(Object.entries(filter ?? {}).filter(([, v]) => v) as [string, string][]).toString()
  return useQuery({
    queryKey: qk.runs(ws, filter),
    queryFn: () => api.get<RunRow[]>(`/api/workspaces/${ws}/runs${qs ? `?${qs}` : ''}`),
  })
}

export function useRun(id: string | undefined) {
  return useQuery({ queryKey: qk.run(id ?? ''), queryFn: () => api.get<RunRow>(`/api/runs/${id}`), enabled: !!id })
}

export function useMocks(ws: string) {
  return useQuery({ queryKey: qk.mocks(ws), queryFn: () => api.get<MockRow[]>(`/api/workspaces/${ws}/mocks`) })
}

export function useMonitors(ws: string) {
  return useQuery({ queryKey: qk.monitors(ws), queryFn: () => api.get<MonitorRow[]>(`/api/workspaces/${ws}/monitors`) })
}

export function useRevisions(collectionId: string, itemId?: string) {
  const qs = itemId ? `?itemId=${itemId}` : ''
  return useQuery({
    queryKey: qk.revisions(collectionId, itemId),
    queryFn: () => api.get<Revision[]>(`/api/collections/${collectionId}/revisions${qs}`),
  })
}

export function useComments(collectionId: string, itemId?: string | null) {
  const qs = itemId ? `?itemId=${itemId}` : ''
  return useQuery({
    queryKey: qk.comments(collectionId, itemId),
    queryFn: () => api.get<Comment[]>(`/api/collections/${collectionId}/comments${qs}`),
  })
}

export function useInvalidate() {
  const qc = useQueryClient()
  return (key: readonly unknown[]) => qc.invalidateQueries({ queryKey: key })
}

/** Mutación genérica que invalida claves al terminar. */
export function useApiMutation<TVars, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, invalidate: (v: TVars) => readonly (readonly unknown[])[] = () => []) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (_d, v) => {
      for (const k of invalidate(v)) qc.invalidateQueries({ queryKey: k })
    },
  })
}
