import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  /** Vacío en cuentas creadas solo con Google o GitHub */
  passwordHash: text('password_hash'),
  /** Rol en la instancia (distinto del rol en cada workspace) */
  role: text('role').$type<InstanceRole>().notNull().default('user'),
  disabled: boolean('disabled').notNull().default(false),
  /** Preferencias de la interfaz: tour completado, etc. */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
})

export type InstanceRole = 'admin' | 'user'
export type OAuthProvider = 'google' | 'github'

/** Cuentas de Google o GitHub vinculadas a un usuario */
export const identities = pgTable(
  'user_identities',
  {
    provider: text('provider').$type<OAuthProvider>().notNull(),
    providerUserId: text('provider_user_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerUserId] }),
    index('user_identities_user_idx').on(t.userId),
  ],
)

/** Ajustes de la instancia que se cambian desde el panel de administración */
export const instanceSettings = pgTable('instance_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: updatedAt(),
})

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // sha256 del token
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
})

export const apiTokens = pgTable('api_tokens', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: createdAt(),
})

export const workspaces = pgTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  type: text('type').$type<'personal' | 'team'>().notNull().default('team'),
  globals: jsonb('globals').$type<any[]>().notNull().default([]),
  /** Versión de las globales, para sincronizar con la app de escritorio */
  globalsVersion: integer('globals_version').notNull().default(1),
  globalsUpdatedAt: timestamp('globals_updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
})

export type Role = 'owner' | 'admin' | 'editor' | 'viewer'

export const members = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<Role>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
)

export const invitations = pgTable('invitations', {
  id: id(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').$type<Role>().notNull(),
  token: text('token').notNull().unique(),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
})

export const collections = pgTable(
  'collections',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** info, auth, event, variable, protocolProfileBehavior, description */
    data: jsonb('data').$type<Record<string, any>>().notNull().default({}),
    forkedFrom: uuid('forked_from'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('collections_ws_idx').on(t.workspaceId)],
)

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    type: text('type').$type<'folder' | 'request'>().notNull(),
    name: text('name').notNull(),
    sort: text('sort').notNull(),
    /** Todo el ítem salvo name/id/item (hijos) */
    data: jsonb('data').$type<Record<string, any>>().notNull().default({}),
    version: integer('version').notNull().default(1),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('items_collection_idx').on(t.collectionId), index('items_parent_idx').on(t.parentId)],
)

export const environments = pgTable(
  'environments',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    values: jsonb('values').$type<any[]>().notNull().default([]),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('environments_ws_idx').on(t.workspaceId)],
)

export const cookieJars = pgTable(
  'cookie_jars',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jar: jsonb('jar').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
)

export const history = pgTable(
  'history',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id'),
    method: text('method').notNull(),
    url: text('url').notNull(),
    status: integer('status'),
    time: integer('time'),
    /** RequestItem enviado (sin resolver) para poder reabrirlo */
    request: jsonb('request').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('history_ws_user_idx').on(t.workspaceId, t.userId, t.createdAt)],
)

export const runs = pgTable(
  'runs',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    collectionId: uuid('collection_id').references(() => collections.id, { onDelete: 'set null' }),
    environmentId: uuid('environment_id'),
    monitorId: uuid('monitor_id'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    source: text('source').$type<'app' | 'cli' | 'monitor' | 'desktop'>().notNull(),
    name: text('name').notNull(),
    status: text('status').$type<'running' | 'passed' | 'failed' | 'error' | 'aborted'>().notNull(),
    stats: jsonb('stats'),
    result: jsonb('result'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('runs_ws_idx').on(t.workspaceId, t.startedAt),
    index('runs_monitor_idx').on(t.monitorId, t.startedAt),
  ],
)

export const mocks = pgTable('mocks', {
  id: id(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  collectionId: uuid('collection_id')
    .notNull()
    .references(() => collections.id, { onDelete: 'cascade' }),
  environmentId: uuid('environment_id'),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  delayMs: integer('delay_ms').notNull().default(0),
  isPrivate: boolean('is_private').notNull().default(false),
  createdAt: createdAt(),
})

export const mockLogs = pgTable(
  'mock_logs',
  {
    id: id(),
    mockId: uuid('mock_id')
      .notNull()
      .references(() => mocks.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    path: text('path').notNull(),
    status: integer('status').notNull(),
    matchedItemId: uuid('matched_item_id'),
    matchedExample: text('matched_example'),
    request: jsonb('request'),
    createdAt: createdAt(),
  },
  (t) => [index('mock_logs_idx').on(t.mockId, t.createdAt)],
)

export const monitors = pgTable('monitors', {
  id: id(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  collectionId: uuid('collection_id')
    .notNull()
    .references(() => collections.id, { onDelete: 'cascade' }),
  environmentId: uuid('environment_id'),
  name: text('name').notNull(),
  cron: text('cron').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  enabled: boolean('enabled').notNull().default(true),
  /** [{ type: 'email'|'webhook'|'slack'|'discord'|'telegram', target, onlyOnFailure }] */
  notify: jsonb('notify').$type<any[]>().notNull().default([]),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastStatus: text('last_status'),
  createdAt: createdAt(),
})

export const docs = pgTable('docs', {
  id: id(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  collectionId: uuid('collection_id')
    .notNull()
    .references(() => collections.id, { onDelete: 'cascade' }),
  environmentId: uuid('environment_id'),
  slug: text('slug').notNull().unique(),
  passwordHash: text('password_hash'),
  published: boolean('published').notNull().default(true),
  createdAt: createdAt(),
})

export const revisions = pgTable(
  'revisions',
  {
    id: id(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    summary: text('summary').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: createdAt(),
  },
  (t) => [index('revisions_idx').on(t.collectionId, t.createdAt)],
)

export const comments = pgTable(
  'comments',
  {
    id: id(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    resolved: boolean('resolved').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('comments_idx').on(t.collectionId, t.itemId)],
)

/** Lo borrado, para que la app de escritorio sepa qué eliminar al sincronizar. */
export const deletions = pgTable(
  'deletions',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    entity: text('entity').$type<'collection' | 'item' | 'environment'>().notNull(),
    entityId: uuid('entity_id').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.entity, t.entityId] }),
    index('deletions_ws_idx').on(t.workspaceId, t.deletedAt),
  ],
)

/**
 * Qué se importó desde otra herramienta (por ahora, la API de Postman) y dónde quedó. Sirve para
 * que una segunda importación actualice lo ya importado en lugar de duplicarlo.
 */
export const importLinks = pgTable(
  'import_links',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<'postman'>().notNull(),
    entity: text('entity').$type<'collection' | 'environment'>().notNull(),
    externalId: text('external_id').notNull(),
    localId: uuid('local_id').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.provider, t.entity, t.externalId] }),
    index('import_links_local_idx').on(t.localId),
  ],
)
