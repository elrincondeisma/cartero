/**
 * Sincronización con la app de escritorio.
 *
 * - GET  /api/workspaces/:ws/changes?since=… → lo que ha cambiado (y lo borrado) desde el cursor.
 * - POST /api/workspaces/:ws/sync → sube cambios locales. Cada operación lleva `base`: el
 *   contenido del servidor que la app vio por última vez. Si el contenido actual es distinto,
 *   es un conflicto y se devuelve la versión del servidor para que la persona decida.
 * - POST /api/workspaces/:ws/history → sube el historial de peticiones enviadas desde la app.
 */
import { and, eq, gt, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, schema } from '../db/index.js'
import { assertRole } from '../lib/access.js'
import { requireUser } from '../lib/auth.js'
import { openVariables, sealVariables } from '../lib/crypto.js'
import { broadcast } from '../lib/realtime.js'
import { canonical, forgetDeletions, recordDeletions } from '../lib/sync.js'
import { rowToItem } from '../lib/tree.js'
import { recordContractRevision } from './collections.js'

/** Margen del cursor: lo que se guarde mientras se lee no se pierde (la app ignora repetidos). */
const CURSOR_OVERLAP_MS = 5000

const collectionContent = (r: { name: string; data: unknown }) => ({ name: r.name, data: r.data ?? {} })
const itemContent = (r: {
  collectionId: string
  parentId: string | null
  type: string
  name: string
  sort: string
  data: unknown
}) => ({
  collectionId: r.collectionId,
  parentId: r.parentId ?? null,
  type: r.type,
  name: r.name,
  sort: r.sort,
  data: r.data ?? {},
})
const envContent = (r: { name: string; values: any[] }) => ({
  name: r.name,
  values: openVariables(r.values ?? []),
})

const opSchema = z.object({
  entity: z.enum(['collection', 'item', 'environment', 'globals']),
  op: z.enum(['upsert', 'delete']),
  id: z.string().uuid().optional(),
  /** Contenido del servidor que la app vio por última vez (null = no existía) */
  base: z.any().optional(),
  /** Sube aunque el servidor haya cambiado (la persona eligió quedarse con la suya) */
  force: z.boolean().optional(),
  data: z.record(z.string(), z.any()).optional(),
})

type Result = {
  id?: string
  entity: string
  status: 'ok' | 'conflict' | 'error'
  version?: number
  remote?: unknown
  message?: string
}

export async function syncRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:ws/changes', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id)
    const { since } = z.object({ since: z.string().datetime({ offset: true }).optional() }).parse(req.query)
    const cursor = new Date(Date.now() - CURSOR_OVERLAP_MS).toISOString()
    const after = since ? new Date(since) : null

    const collections = await db
      .select()
      .from(schema.collections)
      .where(
        after
          ? and(eq(schema.collections.workspaceId, ws), gt(schema.collections.updatedAt, after))
          : eq(schema.collections.workspaceId, ws),
      )
    const allIds = (
      await db
        .select({ id: schema.collections.id })
        .from(schema.collections)
        .where(eq(schema.collections.workspaceId, ws))
    ).map((r) => r.id)
    const items = allIds.length
      ? await db
          .select()
          .from(schema.items)
          .where(
            after
              ? and(inArray(schema.items.collectionId, allIds), gt(schema.items.updatedAt, after))
              : inArray(schema.items.collectionId, allIds),
          )
      : []
    const environments = await db
      .select()
      .from(schema.environments)
      .where(
        after
          ? and(eq(schema.environments.workspaceId, ws), gt(schema.environments.updatedAt, after))
          : eq(schema.environments.workspaceId, ws),
      )
    const [w] = await db
      .select({
        globals: schema.workspaces.globals,
        version: schema.workspaces.globalsVersion,
        updatedAt: schema.workspaces.globalsUpdatedAt,
        name: schema.workspaces.name,
      })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ws))
    const deleted = after
      ? await db
          .select({ entity: schema.deletions.entity, id: schema.deletions.entityId })
          .from(schema.deletions)
          .where(and(eq(schema.deletions.workspaceId, ws), gt(schema.deletions.deletedAt, after)))
      : []
    return {
      cursor,
      full: !after,
      workspace: { name: w?.name },
      collections: collections.map((c) => ({ id: c.id, version: c.version, ...collectionContent(c) })),
      items: items.map((i) => ({ id: i.id, version: i.version, ...itemContent(i) })),
      environments: environments.map((e) => ({ id: e.id, version: e.version, ...envContent(e) })),
      globals:
        !after || (w && w.updatedAt > after)
          ? { version: w?.version ?? 1, values: openVariables(w?.globals ?? []) }
          : null,
      deleted,
    }
  })

  app.post('/api/workspaces/:ws/sync', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id, 'editor')
    const { ops } = z.object({ ops: z.array(opSchema).max(1000) }).parse(req.body)
    // Primero colecciones, luego ítems (por profundidad: los padres antes), entornos y globales;
    // los borrados al final
    const order = { collection: 0, item: 1, environment: 2, globals: 3 }
    const sorted = [...ops].sort((a, b) =>
      a.op === b.op ? order[a.entity] - order[b.entity] : a.op === 'upsert' ? -1 : 1,
    )
    const results: Result[] = []
    const touched = new Set<string>()
    let envsChanged = false

    for (const o of sorted) {
      try {
        results.push(await apply(o))
      } catch (e) {
        results.push({ id: o.id, entity: o.entity, status: 'error', message: (e as Error).message })
      }
    }

    async function apply(o: z.infer<typeof opSchema>): Promise<Result> {
      const conflict = (current: unknown) =>
        !o.force && o.base !== undefined && canonical(current) !== canonical(o.base)
      if (o.entity === 'globals') {
        const [w] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, ws))
        const current = { values: openVariables(w.globals ?? []) }
        if (conflict(current))
          return { entity: 'globals', status: 'conflict', remote: { version: w.globalsVersion, ...current } }
        const values = z.array(z.any()).parse(o.data?.values ?? [])
        const [row] = await db
          .update(schema.workspaces)
          .set({
            globals: sealVariables(values),
            globalsVersion: w.globalsVersion + 1,
            globalsUpdatedAt: new Date(),
          })
          .where(eq(schema.workspaces.id, ws))
          .returning()
        envsChanged = true
        return { entity: 'globals', status: 'ok', version: row.globalsVersion }
      }
      const id = o.id
      if (!id) return { entity: o.entity, status: 'error', message: 'Falta el id' }

      if (o.entity === 'collection') {
        const [row] = await db.select().from(schema.collections).where(eq(schema.collections.id, id))
        if (row && row.workspaceId !== ws)
          return { id, entity: o.entity, status: 'error', message: 'La colección es de otro workspace' }
        if (o.op === 'delete') {
          if (!row) return { id, entity: o.entity, status: 'ok' }
          if (conflict(collectionContent(row)))
            return {
              id,
              entity: o.entity,
              status: 'conflict',
              remote: { version: row.version, ...collectionContent(row) },
            }
          const itemIds = (
            await db
              .select({ id: schema.items.id })
              .from(schema.items)
              .where(eq(schema.items.collectionId, id))
          ).map((r) => r.id)
          await db.delete(schema.collections).where(eq(schema.collections.id, id))
          await recordDeletions(ws, 'collection', [id])
          await recordDeletions(ws, 'item', itemIds)
          touched.add('*')
          return { id, entity: o.entity, status: 'ok' }
        }
        const data = z
          .object({ name: z.string().min(1).max(200), data: z.record(z.string(), z.any()).default({}) })
          .parse(o.data)
        if (row) {
          if (conflict(collectionContent(row)))
            return {
              id,
              entity: o.entity,
              status: 'conflict',
              remote: { version: row.version, ...collectionContent(row) },
            }
          const [after] = await db
            .update(schema.collections)
            .set({ name: data.name, data: data.data, version: row.version + 1, updatedAt: new Date() })
            .where(eq(schema.collections.id, id))
            .returning()
          touched.add(id)
          return { id, entity: o.entity, status: 'ok', version: after.version }
        }
        const [created] = await db
          .insert(schema.collections)
          .values({ id, workspaceId: ws, name: data.name, data: data.data })
          .returning()
        await forgetDeletions([id])
        touched.add(id)
        return { id, entity: o.entity, status: 'ok', version: created.version }
      }

      if (o.entity === 'item') {
        const [row] = await db.select().from(schema.items).where(eq(schema.items.id, id))
        if (row) {
          const [c] = await db
            .select({ ws: schema.collections.workspaceId })
            .from(schema.collections)
            .where(eq(schema.collections.id, row.collectionId))
          if (c?.ws !== ws)
            return { id, entity: o.entity, status: 'error', message: 'El elemento es de otro workspace' }
        }
        if (o.op === 'delete') {
          if (!row) return { id, entity: o.entity, status: 'ok' }
          if (conflict(itemContent(row)))
            return {
              id,
              entity: o.entity,
              status: 'conflict',
              remote: { version: row.version, ...itemContent(row) },
            }
          const all = await db
            .select({ id: schema.items.id, parentId: schema.items.parentId })
            .from(schema.items)
            .where(eq(schema.items.collectionId, row.collectionId))
          const ids = [id]
          for (let i = 0; i < ids.length; i++) for (const r of all) if (r.parentId === ids[i]) ids.push(r.id)
          await db.delete(schema.items).where(inArray(schema.items.id, ids))
          await recordDeletions(ws, 'item', ids)
          touched.add(row.collectionId)
          return { id, entity: o.entity, status: 'ok' }
        }
        const data = z
          .object({
            collectionId: z.string().uuid(),
            parentId: z.string().uuid().nullable(),
            type: z.enum(['folder', 'request']),
            name: z.string().min(1).max(500),
            sort: z.string().min(1).max(200),
            data: z.record(z.string(), z.any()).default({}),
          })
          .parse(o.data)
        const [target] = await db
          .select({ ws: schema.collections.workspaceId })
          .from(schema.collections)
          .where(eq(schema.collections.id, data.collectionId))
        if (target?.ws !== ws)
          return {
            id,
            entity: o.entity,
            status: 'error',
            message: 'La colección destino no existe en este workspace',
          }
        if (row) {
          if (conflict(itemContent(row)))
            return {
              id,
              entity: o.entity,
              status: 'conflict',
              remote: { version: row.version, ...itemContent(row) },
            }
          const [after] = await db
            .update(schema.items)
            .set({ ...data, version: row.version + 1, updatedBy: user.id, updatedAt: new Date() })
            .where(eq(schema.items.id, id))
            .returning()
          // El contrato cambiado desde la app de escritorio también queda en el historial
          if (data.type === 'request')
            await recordContractRevision(
              data.collectionId,
              user.id,
              id,
              data.name,
              rowToItem(row),
              rowToItem(after),
            ).catch(() => {})
          touched.add(data.collectionId)
          if (row.collectionId !== data.collectionId) touched.add(row.collectionId)
          return { id, entity: o.entity, status: 'ok', version: after.version }
        }
        const [created] = await db
          .insert(schema.items)
          .values({ id, ...data, updatedBy: user.id })
          .returning()
        await forgetDeletions([id])
        if (data.type === 'request')
          await recordContractRevision(
            data.collectionId,
            user.id,
            id,
            data.name,
            null,
            rowToItem(created),
          ).catch(() => {})
        touched.add(data.collectionId)
        return { id, entity: o.entity, status: 'ok', version: created.version }
      }

      // environment
      const [row] = await db.select().from(schema.environments).where(eq(schema.environments.id, id))
      if (row && row.workspaceId !== ws)
        return { id, entity: o.entity, status: 'error', message: 'El entorno es de otro workspace' }
      if (o.op === 'delete') {
        if (!row) return { id, entity: o.entity, status: 'ok' }
        if (conflict(envContent(row)))
          return {
            id,
            entity: o.entity,
            status: 'conflict',
            remote: { version: row.version, ...envContent(row) },
          }
        await db.delete(schema.environments).where(eq(schema.environments.id, id))
        await recordDeletions(ws, 'environment', [id])
        envsChanged = true
        return { id, entity: o.entity, status: 'ok' }
      }
      const data = z
        .object({ name: z.string().min(1).max(200), values: z.array(z.any()).default([]) })
        .parse(o.data)
      envsChanged = true
      if (row) {
        if (conflict(envContent(row)))
          return {
            id,
            entity: o.entity,
            status: 'conflict',
            remote: { version: row.version, ...envContent(row) },
          }
        const [after] = await db
          .update(schema.environments)
          .set({
            name: data.name,
            values: sealVariables(data.values),
            version: row.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(schema.environments.id, id))
          .returning()
        return { id, entity: o.entity, status: 'ok', version: after.version }
      }
      const [created] = await db
        .insert(schema.environments)
        .values({ id, workspaceId: ws, name: data.name, values: sealVariables(data.values) })
        .returning()
      await forgetDeletions([id])
      return { id, entity: o.entity, status: 'ok', version: created.version }
    }

    for (const cid of touched) {
      if (cid === '*') continue
      await db
        .insert(schema.revisions)
        .values({
          collectionId: cid,
          userId: user.id,
          action: 'update',
          summary: 'Sincronizado desde la app de escritorio',
          itemId: null,
        })
        .catch(() => {})
      broadcast(ws, { type: 'collection.changed', collectionId: cid, action: 'sync', by: user.id })
    }
    if (touched.size) broadcast(ws, { type: 'collections.changed', by: user.id })
    if (envsChanged) broadcast(ws, { type: 'environments.changed', by: user.id })
    return { results }
  })

  app.post('/api/workspaces/:ws/history', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id)
    const { entries } = z
      .object({
        entries: z
          .array(
            z.object({
              itemId: z.string().uuid().nullable().optional(),
              method: z.string().max(20),
              url: z.string().max(8000),
              status: z.number().int().nullable().optional(),
              time: z.number().int().nullable().optional(),
              request: z.any(),
              createdAt: z.string().datetime({ offset: true }),
            }),
          )
          .max(500),
      })
      .parse(req.body)
    if (entries.length)
      await db.insert(schema.history).values(
        entries.map((e) => ({
          workspaceId: ws,
          userId: user.id,
          itemId: e.itemId ?? null,
          method: e.method,
          url: e.url,
          status: e.status ?? null,
          time: e.time ?? null,
          request: e.request ?? {},
          createdAt: new Date(e.createdAt),
        })),
      )
    return { ok: true, count: entries.length }
  })
}
