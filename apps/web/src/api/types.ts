import type { Auth, Event, ProtocolProfileBehavior, Request, ResponseExample, Variable } from '@cartero/core'

export type Role = 'owner' | 'admin' | 'editor' | 'viewer'

export interface User {
  id: string
  email: string
  name: string
}

export interface Workspace {
  id: string
  name: string
  type: 'personal' | 'team'
  role: Role
}

export interface CollectionSummary {
  id: string
  name: string
  forkedFrom: string | null
  updatedAt: string
  requests: number
}

export interface ItemRow {
  id: string
  collectionId: string
  parentId: string | null
  type: 'folder' | 'request'
  name: string
  sort: string
  version: number
  updatedAt: string
  data: {
    request?: Request
    response?: ResponseExample[]
    event?: Event[]
    variable?: Variable[]
    description?: string
    auth?: Auth | null
    protocolProfileBehavior?: ProtocolProfileBehavior
  }
}

export interface CollectionDetail {
  id: string
  workspaceId: string
  name: string
  forkedFrom: string | null
  version: number
  data: {
    auth?: Auth | null
    event?: Event[]
    variable?: Variable[]
    description?: string
  }
  items: ItemRow[]
}

export interface EnvironmentRow {
  id: string
  workspaceId: string
  name: string
  values: Variable[]
  version: number
}

export interface ExecResponse {
  code: number
  status: string
  headers: { key: string; value: string }[]
  body?: string
  bodyBase64?: string
  truncated?: boolean
  size: { body: number; header: number; total: number }
  time: number
  timings?: Record<string, number>
  cookies: { name: string; value: string; domain?: string; path?: string; expires?: string; httpOnly?: boolean; secure?: boolean }[]
  contentType?: string
}

export interface TestResult {
  name: string
  passed: boolean
  skipped: boolean
  error?: string
}

export interface Execution {
  id: string
  itemId: string
  name: string
  iteration: number
  request?: { method: string; url: string; headers: { key: string; value: string }[]; body?: string }
  response?: ExecResponse
  error?: string
  tests: TestResult[]
  prerequestError?: string
  testScriptError?: string
}

export interface ConsoleEntry {
  level: string
  messages: unknown[]
  itemId?: string
}

export interface ExecuteResult {
  execution: Execution | null
  console: ConsoleEntry[]
  error?: string
  variablesChanged: string[]
}

export interface RunStats {
  requests: number
  failedRequests: number
  assertions: number
  failedAssertions: number
  iterations: number
  totalTime: number
}

export interface RunRow {
  id: string
  name: string
  status: 'running' | 'passed' | 'failed' | 'error' | 'aborted'
  source: 'app' | 'cli' | 'monitor'
  stats: RunStats | null
  collectionId: string | null
  monitorId: string | null
  startedAt: string
  finishedAt: string | null
  user: string | null
  result?: { executions: Execution[]; console: ConsoleEntry[]; error?: string; stats: RunStats }
}

export interface HistoryRow {
  id: string
  itemId: string | null
  method: string
  url: string
  status: number | null
  time: number | null
  request: any
  createdAt: string
}

export interface MockRow {
  id: string
  name: string
  slug: string
  collectionId: string
  collection: string
  environmentId: string | null
  delayMs: number
  isPrivate: boolean
  createdAt: string
}

export interface NotifyTarget {
  type: 'email' | 'webhook' | 'slack' | 'discord' | 'telegram'
  target: string
  onlyOnFailure?: boolean
}

export interface MonitorRow {
  id: string
  name: string
  collectionId: string
  collection: string
  environmentId: string | null
  cron: string
  timezone: string
  enabled: boolean
  notify: NotifyTarget[]
  lastRunAt: string | null
  lastStatus: string | null
  nextRunAt?: number
}

export interface Revision {
  id: string
  action: string
  summary: string
  itemId: string | null
  createdAt: string
  user: string | null
  restorable: boolean
}

export interface Comment {
  id: string
  itemId: string | null
  body: string
  resolved: boolean
  createdAt: string
  userId: string
  user: string
}

export interface PresenceUser {
  id: string
  name: string
  itemId?: string
  color: string
}
