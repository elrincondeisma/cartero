/**
 * Importar desde Postman con su API: el usuario pega su API key, elige workspaces y colecciones,
 * y la importación va contando el progreso (NDJSON). Lo ya importado se actualiza en su sitio.
 */
import type { Collection, Variable } from '@cartero/core'
import { importPostmanCollection, importPostmanEnvironment, importPostmanGlobals } from '@cartero/importers'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, schema } from '../db/index.js'
import { assertRole } from '../lib/access.js'
import { requireUser } from '../lib/auth.js'
import { openVariables, sealVariables } from '../lib/crypto.js'
import { HttpError } from '../lib/errors.js'
import { PostmanClient, PostmanError } from '../lib/postman.js'
import { broadcast } from '../lib/realtime.js'
import { insertCollection } from '../lib/tree.js'
import { recordRevision, replaceCollectionContents } from './collections.js'

const keySchema = z.object({ apiKey: z.string().trim().min(10).max(200) })

const importSchema = keySchema.extend({
  workspaces: z
    .array(
      z.object({
        postmanId: z.string().min(1).max(100),
        name: z.string().min(1).max(200),
        /** Workspace de Cartero existente, o null para crear uno con `newName` */
        targetId: z.string().uuid().nullable(),
        newName: z.string().min(1).max(100).optional(),
        collections: z
          .array(z.object({ uid: z.string().min(1).max(200), name: z.string().max(500) }))
          .max(1000),
        environments: z
          .array(z.object({ uid: z.string().min(1).max(200), name: z.string().max(500) }))
          .max(1000),
        globals: z.boolean(),
      }),
    )
    .min(1)
    .max(100),
})

type ImportEvent =
  | { type: 'start'; total: number }
  | { type: 'progress'; done: number; total: number; label: string }
  | {
      type: 'item'
      kind: 'collection' | 'environment' | 'globals' | 'workspace'
      name: string
      action: 'created' | 'updated'
      workspaceId: string
      id?: string
      count?: number
    }
  | { type: 'warning'; kind: 'secrets'; name: string; count: number; message: string }
  | { type: 'error'; name: string; message: string }
  | { type: 'done'; calls: number; created: number; updated: number; failed: number }

function postmanFailure(e: unknown): never {
  if (e instanceof PostmanError) {
    const status = e.status === 401 ? 400 : [403, 404, 429].includes(e.status) ? e.status : 502
    throw new HttpError(status, e.message, 'postman')
  }
  throw e
}

/** Workspaces de Cartero del usuario con permiso para escribir. */
async function writableWorkspaces(userId: string) {
  return db
    .select({ id: schema.workspaces.id, name: schema.workspaces.name, role: schema.members.role })
    .from(schema.members)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.members.workspaceId))
    .where(and(eq(schema.members.userId, userId), inArray(schema.members.role, ['owner', 'admin', 'editor'])))
}

/** Dónde quedó cada uid ya importado (solo si sigue existiendo y el usuario lo ve). */
async function existingLinks(userId: string, entity: 'collection' | 'environment', uids: string[]) {
  if (!uids.length) return new Map<string, { workspaceId: string; id: string }>()
  const table = entity === 'collection' ? schema.collections : schema.environments
  const rows = await db
    .select({
      externalId: schema.importLinks.externalId,
      workspaceId: schema.importLinks.workspaceId,
      id: table.id,
    })
    .from(schema.importLinks)
    .innerJoin(table, eq(table.id, schema.importLinks.localId))
    .innerJoin(
      schema.members,
      and(eq(schema.members.workspaceId, schema.importLinks.workspaceId), eq(schema.members.userId, userId)),
    )
    .where(
      and(
        eq(schema.importLinks.provider, 'postman'),
        eq(schema.importLinks.entity, entity),
        inArray(schema.importLinks.externalId, uids),
      ),
    )
  return new Map(rows.map((r) => [r.externalId, { workspaceId: r.workspaceId, id: r.id }]))
}

async function link(
  workspaceId: string,
  entity: 'collection' | 'environment',
  externalId: string,
  localId: string,
) {
  await db
    .insert(schema.importLinks)
    .values({ workspaceId, provider: 'postman', entity, externalId, localId })
    .onConflictDoUpdate({
      target: [
        schema.importLinks.workspaceId,
        schema.importLinks.provider,
        schema.importLinks.entity,
        schema.importLinks.externalId,
      ],
      set: { localId, importedAt: new Date() },
    })
}

/** Ejecuta tareas con un máximo de `limit` a la vez, en orden de llegada. */
async function pool<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await run(items[next++])
  })
  await Promise.all(workers)
}

export async function postmanRoutes(app: FastifyInstance) {
  /** Comprueba la key y devuelve el usuario de Postman, su cupo y sus workspaces. */
  app.post(
    '/api/postman/connect',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const user = requireUser(req)
      const { apiKey } = keySchema.parse(req.body)
      const pm = new PostmanClient(apiKey)
      try {
        const [{ user: pmUser, usage }, workspaces] = await Promise.all([pm.me(), pm.workspaces()])
        const targets = await writableWorkspaces(user.id)
        return {
          user: {
            name: pmUser.fullName || pmUser.username,
            username: pmUser.username,
            avatar: pmUser.avatar ?? null,
            team: pmUser.teamName ?? null,
          },
          usage,
          workspaces,
          targets,
        }
      } catch (e) {
        postmanFailure(e)
      }
    },
  )

  /** Contenido de un workspace de Postman, marcando lo que ya está importado. */
  app.post(
    '/api/postman/workspaces/:id',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req) => {
      const user = requireUser(req)
      const { id } = req.params as { id: string }
      const { apiKey } = keySchema.parse(req.body)
      let w: Awaited<ReturnType<PostmanClient['workspace']>>
      try {
        w = await new PostmanClient(apiKey).workspace(id)
      } catch (e) {
        postmanFailure(e)
      }
      const [cols, envs] = await Promise.all([
        existingLinks(
          user.id,
          'collection',
          w.collections.map((c) => c.uid),
        ),
        existingLinks(
          user.id,
          'environment',
          w.environments.map((c) => c.uid),
        ),
      ])
      return {
        id: w.id,
        name: w.name,
        type: w.type,
        description: w.description ?? '',
        collections: w.collections.map((c) => ({
          uid: c.uid,
          name: c.name,
          imported: cols.get(c.uid) ?? null,
        })),
        environments: w.environments.map((e) => ({
          uid: e.uid,
          name: e.name,
          imported: envs.get(e.uid) ?? null,
        })),
        mocks: w.mocks.length,
        monitors: w.monitors.length,
        apis: w.apis.length,
      }
    },
  )

  /** Importa lo elegido. Responde en NDJSON: una línea por evento, para la barra de progreso. */
  app.post(
    '/api/postman/import',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req)
      const body = importSchema.parse(req.body)
      for (const w of body.workspaces) if (w.targetId) await assertRole(w.targetId, user.id, 'editor')
      const pm = new PostmanClient(body.apiKey)

      reply.hijack()
      reply.raw.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-cache',
        'x-accel-buffering': 'no',
      })
      const send = (e: ImportEvent) => reply.raw.write(`${JSON.stringify(e)}\n`)

      try {
        const total = body.workspaces.reduce(
          (n, w) => n + w.collections.length + w.environments.length + (w.globals ? 1 : 0),
          0,
        )
        let done = 0
        let created = 0
        let updated = 0
        let failed = 0
        send({ type: 'start', total })
        const step = (label: string) => send({ type: 'progress', done: ++done, total, label })

        const [colLinks, envLinks] = await Promise.all([
          existingLinks(
            user.id,
            'collection',
            body.workspaces.flatMap((w) => w.collections.map((c) => c.uid)),
          ),
          existingLinks(
            user.id,
            'environment',
            body.workspaces.flatMap((w) => w.environments.map((c) => c.uid)),
          ),
        ])

        for (const w of body.workspaces) {
          let target = w.targetId
          if (!target) {
            const name = w.newName ?? w.name
            target = await db.transaction(async (tx) => {
              const [row] = await tx.insert(schema.workspaces).values({ name, type: 'team' }).returning()
              await tx.insert(schema.members).values({ workspaceId: row.id, userId: user.id, role: 'owner' })
              return row.id
            })
            send({ type: 'item', kind: 'workspace', name, action: 'created', workspaceId: target })
          }
          const ws = target

          let secretsEmpty = 0
          await pool(w.collections, 4, async (c) => {
            try {
              const raw = await pm.collection(c.uid)
              const col: Collection = await importPostmanCollection(raw)
              const prev = colLinks.get(c.uid)
              if (prev && prev.workspaceId === ws) {
                await replaceCollectionContents(ws, prev.id, col, user.id, { rename: true })
                await recordRevision(prev.id, user.id, 'import', 'Actualizada desde Postman')
                broadcast(ws, {
                  type: 'collection.changed',
                  collectionId: prev.id,
                  action: 'import',
                  by: user.id,
                })
                updated++
                send({
                  type: 'item',
                  kind: 'collection',
                  name: col.info.name,
                  action: 'updated',
                  workspaceId: ws,
                  id: prev.id,
                })
              } else {
                const row = await insertCollection(ws, col, user.id)
                await recordRevision(row.id, user.id, 'import', 'Importada desde Postman')
                await link(ws, 'collection', c.uid, row.id)
                created++
                send({
                  type: 'item',
                  kind: 'collection',
                  name: row.name,
                  action: 'created',
                  workspaceId: ws,
                  id: row.id,
                })
              }
            } catch (e) {
              failed++
              send({ type: 'error', name: c.name, message: errorMessage(e) })
            }
            step(c.name)
          })

          await pool(w.environments, 4, async (en) => {
            try {
              const raw = await pm.environment(en.uid)
              const env = importPostmanEnvironment(raw)
              secretsEmpty += env.values.filter((v: any) => v.type === 'secret' && !v.value).length
              const prev = envLinks.get(en.uid)
              if (prev && prev.workspaceId === ws) {
                await db
                  .update(schema.environments)
                  .set({
                    name: env.name,
                    values: sealVariables(env.values),
                    updatedAt: new Date(),
                    version: sql`${schema.environments.version} + 1`,
                  })
                  .where(eq(schema.environments.id, prev.id))
                updated++
                send({
                  type: 'item',
                  kind: 'environment',
                  name: env.name,
                  action: 'updated',
                  workspaceId: ws,
                  id: prev.id,
                })
              } else {
                const [row] = await db
                  .insert(schema.environments)
                  .values({ workspaceId: ws, name: env.name, values: sealVariables(env.values) })
                  .returning()
                await link(ws, 'environment', en.uid, row.id)
                created++
                send({
                  type: 'item',
                  kind: 'environment',
                  name: row.name,
                  action: 'created',
                  workspaceId: ws,
                  id: row.id,
                })
              }
            } catch (e) {
              failed++
              send({ type: 'error', name: en.name, message: errorMessage(e) })
            }
            step(en.name)
          })

          if (w.globals) {
            try {
              const values = await pm.globals(w.postmanId)
              const globals: Variable[] = importPostmanGlobals({ values, _postman_variable_scope: 'globals' })
              if (globals.length) {
                const [row] = await db
                  .select({ globals: schema.workspaces.globals })
                  .from(schema.workspaces)
                  .where(eq(schema.workspaces.id, ws))
                const current = openVariables(row.globals ?? [])
                const merged = [
                  ...current.filter((g: any) => !globals.some((n) => n.key === g.key)),
                  ...globals,
                ]
                await db
                  .update(schema.workspaces)
                  .set({
                    globals: sealVariables(merged),
                    globalsVersion: sql`${schema.workspaces.globalsVersion} + 1`,
                    globalsUpdatedAt: new Date(),
                  })
                  .where(eq(schema.workspaces.id, ws))
                secretsEmpty += globals.filter((v: any) => v.type === 'secret' && !v.value).length
                send({
                  type: 'item',
                  kind: 'globals',
                  name: w.name,
                  action: 'updated',
                  workspaceId: ws,
                  count: globals.length,
                })
              }
            } catch (e) {
              failed++
              send({ type: 'error', name: `${w.name} · globales`, message: errorMessage(e) })
            }
            step('Variables globales')
          }

          if (secretsEmpty)
            send({
              type: 'warning',
              kind: 'secrets',
              name: w.name,
              count: secretsEmpty,
              message: `«${w.name}»: ${secretsEmpty} variable(s) secreta(s) han llegado vacías. Postman no comparte sus valores; rellénalas en Cartero.`,
            })
          broadcast(ws, { type: 'collections.changed', by: user.id })
          broadcast(ws, { type: 'environments.changed', by: user.id })
        }

        send({ type: 'done', calls: pm.calls, created, updated, failed })
      } catch (e) {
        req.log.error(e)
        send({ type: 'error', name: 'Cartero', message: errorMessage(e) })
        send({ type: 'done', calls: pm.calls, created: 0, updated: 0, failed: 1 })
      } finally {
        reply.raw.end()
      }
    },
  )
}

/** Mensaje legible de un error: los de Drizzle traen la consulta entera y la causa real dentro. */
function errorMessage(e: unknown): string {
  const err = e as Error & { cause?: Error }
  if (err?.cause?.message && /^Failed query/.test(err.message))
    return `Error de la base de datos: ${err.cause.message}`
  return err?.message ?? String(e)
}
