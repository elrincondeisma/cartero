import { randomUUID } from 'node:crypto'
import type { Collection, Item } from '@cartero/core'
import { exportPostmanCollection, exportPostmanEnvironment } from '@cartero/exporters'
import { importAny } from '@cartero/importers'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { generateKeyBetween } from 'fractional-indexing'
import { z } from 'zod'
import { db, schema } from '../db/index.js'
import { assertCollection, assertRole, itemCollection } from '../lib/access.js'
import { requireUser } from '../lib/auth.js'
import { openVariables, sealVariables } from '../lib/crypto.js'
import { badRequest, conflict, notFound } from '../lib/errors.js'
import { unscheduleMonitor } from '../lib/monitors.js'
import { broadcast } from '../lib/realtime.js'
import { recordDeletions } from '../lib/sync.js'
import {
  collectionData,
  flattenItems,
  insertCollection,
  itemData,
  loadCollection,
  rowToItem,
} from '../lib/tree.js'

const itemBody = z.object({
  parentId: z.string().uuid().nullable().optional(),
  type: z.enum(['folder', 'request']),
  name: z.string().min(1).max(500),
  data: z.record(z.string(), z.any()).optional(),
  index: z.number().int().min(0).optional(),
})

async function recordRevision(
  collectionId: string,
  userId: string,
  action: string,
  summary: string,
  itemId?: string | null,
  before?: unknown,
  after?: unknown,
) {
  await db
    .insert(schema.revisions)
    .values({ collectionId, userId, action, summary, itemId: itemId ?? null, before, after })
}

async function touchCollection(collectionId: string) {
  await db
    .update(schema.collections)
    .set({ updatedAt: new Date(), version: sql`${schema.collections.version} + 1` })
    .where(eq(schema.collections.id, collectionId))
}

function changed(ws: string, collectionId: string, action: string, by: string, itemId?: string) {
  broadcast(ws, { type: 'collection.changed', collectionId, itemId, action, by })
}

/** Clave de orden para insertar en la posición `index` entre los hermanos. */
async function sortKeyAt(
  collectionId: string,
  parentId: string | null,
  index: number | undefined,
  excludeId?: string,
) {
  const siblings = (
    await db
      .select({ id: schema.items.id, sort: schema.items.sort })
      .from(schema.items)
      .where(
        and(
          eq(schema.items.collectionId, collectionId),
          parentId ? eq(schema.items.parentId, parentId) : isNull(schema.items.parentId),
        ),
      )
      .orderBy(asc(schema.items.sort))
  ).filter((s) => s.id !== excludeId)
  const i = index === undefined ? siblings.length : Math.min(index, siblings.length)
  return generateKeyBetween(siblings[i - 1]?.sort ?? null, siblings[i]?.sort ?? null)
}

async function descendantIds(collectionId: string, rootId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.items.id, parentId: schema.items.parentId })
    .from(schema.items)
    .where(eq(schema.items.collectionId, collectionId))
  const out: string[] = []
  const walk = (id: string) => {
    for (const r of rows) if (r.parentId === id) out.push(r.id), walk(r.id)
  }
  walk(rootId)
  return out
}

/** Guarda el resultado de una importación en un workspace. */
export async function saveImport(ws: string, userId: string, input: string | Uint8Array) {
  const result = await importAny(input)
  const created: { id: string; name: string }[] = []
  for (const col of result.collections) {
    const row = await insertCollection(ws, col, userId)
    created.push({ id: row.id, name: row.name })
    await recordRevision(row.id, userId, 'import', `Importada desde ${result.format}`)
  }
  const envs: { id: string; name: string }[] = []
  for (const env of result.environments) {
    const [row] = await db
      .insert(schema.environments)
      .values({ workspaceId: ws, name: env.name, values: sealVariables(env.values) })
      .returning()
    envs.push({ id: row.id, name: row.name })
  }
  if (result.globals?.length) {
    const [w] = await db
      .select({ globals: schema.workspaces.globals })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ws))
    const current = openVariables(w.globals ?? [])
    const merged = [
      ...current.filter((g: any) => !result.globals!.some((n) => n.key === g.key)),
      ...result.globals,
    ]
    await db
      .update(schema.workspaces)
      .set({ globals: sealVariables(merged) })
      .where(eq(schema.workspaces.id, ws))
  }
  broadcast(ws, { type: 'collections.changed', by: userId })
  if (envs.length || result.globals?.length) broadcast(ws, { type: 'environments.changed', by: userId })
  return {
    format: result.format,
    collections: created,
    environments: envs,
    globals: result.globals?.length ?? 0,
    warnings: result.warnings,
  }
}

export async function collectionRoutes(app: FastifyInstance) {
  app.get('/api/workspaces/:ws/collections', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id)
    return db
      .select({
        id: schema.collections.id,
        name: schema.collections.name,
        forkedFrom: schema.collections.forkedFrom,
        updatedAt: schema.collections.updatedAt,
        requests: sql<number>`(select count(*)::int from items i where i.collection_id = "collections"."id" and i.type = 'request')`,
      })
      .from(schema.collections)
      .where(eq(schema.collections.workspaceId, ws))
      .orderBy(asc(schema.collections.name))
  })

  app.post('/api/workspaces/:ws/collections', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id, 'editor')
    const { name } = z.object({ name: z.string().min(1).max(200) }).parse(req.body)
    const row = await insertCollection(ws, { info: { name }, item: [] }, user.id)
    await recordRevision(row.id, user.id, 'create', 'Colección creada')
    broadcast(ws, { type: 'collections.changed', by: user.id })
    return row
  })

  /** Colección con sus ítems en plano (el cliente monta el árbol). */
  app.get('/api/collections/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    await assertCollection(id, user.id)
    const [row] = await db.select().from(schema.collections).where(eq(schema.collections.id, id))
    const items = await db
      .select()
      .from(schema.items)
      .where(eq(schema.items.collectionId, id))
      .orderBy(asc(schema.items.sort))
    return { ...row, items }
  })

  app.patch('/api/collections/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const ws = await assertCollection(id, user.id, 'editor')
    const body = z
      .object({
        name: z.string().min(1).max(200).optional(),
        data: z.record(z.string(), z.any()).optional(),
        version: z.number().optional(),
      })
      .parse(req.body)
    const [before] = await db.select().from(schema.collections).where(eq(schema.collections.id, id))
    if (body.version !== undefined && body.version !== before.version)
      throw conflict('Otra persona ha modificado la colección. Recarga para ver los cambios.')
    const patch: Partial<typeof schema.collections.$inferInsert> = { updatedAt: new Date() }
    if (body.name) patch.name = body.name
    if (body.data) patch.data = { ...before.data, ...body.data }
    const [after] = await db
      .update(schema.collections)
      .set({ ...patch, version: sql`${schema.collections.version} + 1` })
      .where(eq(schema.collections.id, id))
      .returning()
    await recordRevision(
      id,
      user.id,
      'update',
      'Configuración de la colección',
      null,
      { name: before.name, data: before.data },
      { name: after.name, data: after.data },
    )
    changed(ws, id, 'update', user.id)
    broadcast(ws, { type: 'collections.changed', by: user.id })
    return after
  })

  app.delete('/api/collections/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const ws = await assertCollection(id, user.id, 'editor')
    const mons = await db
      .select({ id: schema.monitors.id })
      .from(schema.monitors)
      .where(eq(schema.monitors.collectionId, id))
    for (const m of mons) await unscheduleMonitor(m.id).catch(() => {})
    const itemIds = (
      await db.select({ id: schema.items.id }).from(schema.items).where(eq(schema.items.collectionId, id))
    ).map((r) => r.id)
    await db.delete(schema.collections).where(eq(schema.collections.id, id))
    await recordDeletions(ws, 'collection', [id])
    await recordDeletions(ws, 'item', itemIds)
    broadcast(ws, { type: 'collections.changed', by: user.id })
    return { ok: true }
  })

  app.get('/api/collections/:id/export', async (req, reply) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    await assertCollection(id, user.id)
    const { collection } = await loadCollection(id)
    const out = exportPostmanCollection(collection)
    reply.header(
      'content-disposition',
      `attachment; filename="${encodeURIComponent(collection.info.name)}.postman_collection.json"`,
    )
    return out
  })

  /** Fork: copia la colección a otro (o el mismo) workspace recordando el origen. */
  app.post('/api/collections/:id/fork', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    await assertCollection(id, user.id)
    const body = z
      .object({ workspaceId: z.string().uuid(), name: z.string().min(1).max(200) })
      .parse(req.body)
    await assertRole(body.workspaceId, user.id, 'editor')
    const { collection } = await loadCollection(id)
    collection.info.name = body.name
    const row = await insertCollection(body.workspaceId, collection, user.id, id)
    await recordRevision(row.id, user.id, 'fork', 'Fork creado')
    broadcast(body.workspaceId, { type: 'collections.changed', by: user.id })
    return row
  })

  app.post('/api/collections/:id/duplicate', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const ws = await assertCollection(id, user.id, 'editor')
    const { collection } = await loadCollection(id)
    collection.info.name = `${collection.info.name} (copia)`
    const row = await insertCollection(ws, collection, user.id)
    broadcast(ws, { type: 'collections.changed', by: user.id })
    return row
  })

  /** Merge de un fork en su colección de origen: el origen pasa a ser igual que el fork. */
  app.post('/api/collections/:id/merge', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    await assertCollection(id, user.id)
    const [fork] = await db.select().from(schema.collections).where(eq(schema.collections.id, id))
    if (!fork.forkedFrom) throw badRequest('Esta colección no es un fork')
    const targetWs = await assertCollection(fork.forkedFrom, user.id, 'editor')
    const { collection: before } = await loadCollection(fork.forkedFrom)
    const { collection } = await loadCollection(id)
    const oldIds = (
      await db
        .select({ id: schema.items.id })
        .from(schema.items)
        .where(eq(schema.items.collectionId, fork.forkedFrom))
    ).map((r) => r.id)
    await recordDeletions(targetWs, 'item', oldIds)
    await db.transaction(async (tx) => {
      await tx.delete(schema.items).where(eq(schema.items.collectionId, fork.forkedFrom!))
      const rows = flattenItems(fork.forkedFrom!, collection.item, user.id)
      for (let i = 0; i < rows.length; i += 500) await tx.insert(schema.items).values(rows.slice(i, i + 500))
      await tx
        .update(schema.collections)
        .set({
          data: collectionData(collection),
          updatedAt: new Date(),
          version: sql`${schema.collections.version} + 1`,
        })
        .where(eq(schema.collections.id, fork.forkedFrom!))
    })
    await recordRevision(
      fork.forkedFrom,
      user.id,
      'merge',
      `Merge desde el fork «${fork.name}»`,
      null,
      before,
      collection,
    )
    changed(targetWs, fork.forkedFrom, 'merge', user.id)
    return { ok: true }
  })

  // Ítems
  app.post('/api/collections/:id/items', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const ws = await assertCollection(id, user.id, 'editor')
    const body = itemBody.parse(req.body)
    const parentId = body.parentId ?? null
    if (parentId) {
      const [p] = await db.select().from(schema.items).where(eq(schema.items.id, parentId))
      if (!p || p.collectionId !== id || p.type !== 'folder') throw badRequest('Carpeta destino no válida')
    }
    const data =
      body.data ??
      (body.type === 'request'
        ? { request: { method: 'GET', url: { raw: '' }, header: [] }, response: [] }
        : {})
    const [row] = await db
      .insert(schema.items)
      .values({
        id: randomUUID(),
        collectionId: id,
        parentId,
        type: body.type,
        name: body.name,
        sort: await sortKeyAt(id, parentId, body.index),
        data,
        updatedBy: user.id,
      })
      .returning()
    await touchCollection(id)
    await recordRevision(
      id,
      user.id,
      'create',
      `${body.type === 'folder' ? 'Carpeta' : 'Petición'} «${body.name}» creada`,
      row.id,
      null,
      rowToItem(row),
    )
    changed(ws, id, 'create', user.id, row.id)
    return row
  })

  app.get('/api/items/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const collectionId = await itemCollection(id)
    const workspaceId = await assertCollection(collectionId, user.id)
    const [row] = await db.select().from(schema.items).where(eq(schema.items.id, id))
    return { ...row, workspaceId }
  })

  app.patch('/api/items/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const collectionId = await itemCollection(id)
    const ws = await assertCollection(collectionId, user.id, 'editor')
    const body = z
      .object({
        name: z.string().min(1).max(500).optional(),
        data: z.record(z.string(), z.any()).optional(),
        version: z.number().int().optional(),
      })
      .parse(req.body)
    const [before] = await db.select().from(schema.items).where(eq(schema.items.id, id))
    if (body.version !== undefined && body.version !== before.version)
      throw conflict('Otra persona ha guardado cambios en este elemento. Recarga para verlos.')
    const [after] = await db
      .update(schema.items)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.data ? { data: body.data } : {}),
        version: sql`${schema.items.version} + 1`,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.items.id, id))
      .returning()
    await touchCollection(collectionId)
    await recordRevision(
      collectionId,
      user.id,
      'update',
      `«${after.name}» modificado`,
      id,
      rowToItem(before),
      rowToItem(after),
    )
    changed(ws, collectionId, 'update', user.id, id)
    return after
  })

  app.post('/api/items/:id/move', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const collectionId = await itemCollection(id)
    const ws = await assertCollection(collectionId, user.id, 'editor')
    const body = z
      .object({ parentId: z.string().uuid().nullable(), index: z.number().int().min(0) })
      .parse(req.body)
    if (body.parentId) {
      if (body.parentId === id || (await descendantIds(collectionId, id)).includes(body.parentId))
        throw badRequest('No se puede mover una carpeta dentro de sí misma')
      const [p] = await db.select().from(schema.items).where(eq(schema.items.id, body.parentId))
      if (!p || p.collectionId !== collectionId || p.type !== 'folder')
        throw badRequest('Carpeta destino no válida')
    }
    const sort = await sortKeyAt(collectionId, body.parentId, body.index, id)
    const [row] = await db
      .update(schema.items)
      .set({ parentId: body.parentId, sort, updatedAt: new Date() })
      .where(eq(schema.items.id, id))
      .returning()
    await touchCollection(collectionId)
    await recordRevision(collectionId, user.id, 'move', `«${row.name}» movido`, id)
    changed(ws, collectionId, 'move', user.id, id)
    return row
  })

  app.post('/api/items/:id/duplicate', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const collectionId = await itemCollection(id)
    const ws = await assertCollection(collectionId, user.id, 'editor')
    const all = await db.select().from(schema.items).where(eq(schema.items.collectionId, collectionId))
    const root = all.find((r) => r.id === id)!
    const idMap = new Map<string, string>()
    const toCopy = [root, ...all.filter((r) => descendantSet(all, id).has(r.id))]
    for (const r of toCopy) idMap.set(r.id, randomUUID())
    const siblings = all
      .filter((r) => r.parentId === root.parentId)
      .sort((a, b) => (a.sort < b.sort ? -1 : 1))
    const next = siblings[siblings.findIndex((s) => s.id === id) + 1]
    const rows = toCopy.map((r) => ({
      ...r,
      id: idMap.get(r.id)!,
      parentId: r.id === id ? r.parentId : idMap.get(r.parentId!)!,
      name: r.id === id ? `${r.name} (copia)` : r.name,
      sort: r.id === id ? generateKeyBetween(root.sort, next?.sort ?? null) : r.sort,
      version: 1,
      updatedBy: user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
    await db.insert(schema.items).values(rows)
    await touchCollection(collectionId)
    await recordRevision(collectionId, user.id, 'create', `«${root.name}» duplicado`, rows[0].id)
    changed(ws, collectionId, 'create', user.id, rows[0].id)
    return rows[0]
  })

  app.delete('/api/items/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const collectionId = await itemCollection(id)
    const ws = await assertCollection(collectionId, user.id, 'editor')
    const ids = [id, ...(await descendantIds(collectionId, id))]
    const { collection } = await loadCollection(collectionId)
    const before = findInTree(collection.item, id)
    await db.delete(schema.items).where(inArray(schema.items.id, ids))
    await recordDeletions(ws, 'item', ids)
    await touchCollection(collectionId)
    await recordRevision(
      collectionId,
      user.id,
      'delete',
      `«${before?.name ?? 'Elemento'}» eliminado`,
      id,
      before,
      null,
    )
    changed(ws, collectionId, 'delete', user.id, id)
    return { ok: true }
  })

  // Historial de cambios
  app.get('/api/collections/:id/revisions', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    await assertCollection(id, user.id)
    const { itemId } = req.query as { itemId?: string }
    return db
      .select({
        id: schema.revisions.id,
        action: schema.revisions.action,
        summary: schema.revisions.summary,
        itemId: schema.revisions.itemId,
        createdAt: schema.revisions.createdAt,
        user: schema.users.name,
        restorable: sql<boolean>`${schema.revisions.before} is not null`,
      })
      .from(schema.revisions)
      .leftJoin(schema.users, eq(schema.users.id, schema.revisions.userId))
      .where(
        and(eq(schema.revisions.collectionId, id), itemId ? eq(schema.revisions.itemId, itemId) : undefined),
      )
      .orderBy(desc(schema.revisions.createdAt))
      .limit(200)
  })

  app.get('/api/revisions/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const [rev] = await db.select().from(schema.revisions).where(eq(schema.revisions.id, id))
    if (!rev) throw notFound('Revisión')
    await assertCollection(rev.collectionId, user.id)
    return rev
  })

  /** Restaura el estado "before" de una revisión. */
  app.post('/api/revisions/:id/restore', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const [rev] = await db.select().from(schema.revisions).where(eq(schema.revisions.id, id))
    if (!rev || !rev.before) throw badRequest('Esta revisión no se puede restaurar')
    const ws = await assertCollection(rev.collectionId, user.id, 'editor')
    const before = rev.before as any

    if (rev.action === 'merge') {
      const col = before as Collection
      await db.transaction(async (tx) => {
        await tx.delete(schema.items).where(eq(schema.items.collectionId, rev.collectionId))
        const rows = flattenItems(rev.collectionId, col.item, user.id)
        for (let i = 0; i < rows.length; i += 500)
          await tx.insert(schema.items).values(rows.slice(i, i + 500))
        await tx
          .update(schema.collections)
          .set({ data: collectionData(col) })
          .where(eq(schema.collections.id, rev.collectionId))
      })
    } else if (!rev.itemId) {
      await db
        .update(schema.collections)
        .set({ name: before.name, data: before.data, updatedAt: new Date() })
        .where(eq(schema.collections.id, rev.collectionId))
    } else {
      const [exists] = await db.select().from(schema.items).where(eq(schema.items.id, rev.itemId))
      if (exists) {
        await db
          .update(schema.items)
          .set({
            name: before.name,
            data: itemData(before as Item),
            version: sql`${schema.items.version} + 1`,
            updatedBy: user.id,
            updatedAt: new Date(),
          })
          .where(eq(schema.items.id, rev.itemId))
      } else {
        // Elemento borrado: se recrea (con su subárbol) al final de la raíz
        const rows = flattenItems(rev.collectionId, [before as Item], user.id)
        rows[0].sort = await sortKeyAt(rev.collectionId, null, undefined)
        await db.insert(schema.items).values(rows)
      }
    }
    await touchCollection(rev.collectionId)
    await recordRevision(rev.collectionId, user.id, 'restore', `Restaurado: ${rev.summary}`, rev.itemId)
    changed(ws, rev.collectionId, 'restore', user.id, rev.itemId ?? undefined)
    return { ok: true }
  })

  // Comentarios
  app.get('/api/collections/:id/comments', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    await assertCollection(id, user.id)
    const { itemId } = req.query as { itemId?: string }
    return db
      .select({
        id: schema.comments.id,
        itemId: schema.comments.itemId,
        body: schema.comments.body,
        resolved: schema.comments.resolved,
        createdAt: schema.comments.createdAt,
        userId: schema.comments.userId,
        user: schema.users.name,
      })
      .from(schema.comments)
      .innerJoin(schema.users, eq(schema.users.id, schema.comments.userId))
      .where(
        and(eq(schema.comments.collectionId, id), itemId ? eq(schema.comments.itemId, itemId) : undefined),
      )
      .orderBy(asc(schema.comments.createdAt))
  })

  app.post('/api/collections/:id/comments', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const ws = await assertCollection(id, user.id)
    const body = z
      .object({ itemId: z.string().uuid().nullable().optional(), body: z.string().min(1).max(5000) })
      .parse(req.body)
    const [row] = await db
      .insert(schema.comments)
      .values({ collectionId: id, itemId: body.itemId ?? null, userId: user.id, body: body.body })
      .returning()
    broadcast(ws, { type: 'comments.changed', collectionId: id, itemId: body.itemId ?? null, by: user.id })
    return row
  })

  app.patch('/api/comments/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const [c] = await db.select().from(schema.comments).where(eq(schema.comments.id, id))
    if (!c) throw notFound('Comentario')
    const ws = await assertCollection(c.collectionId, user.id, c.userId === user.id ? 'viewer' : 'editor')
    const body = z
      .object({ resolved: z.boolean().optional(), body: z.string().min(1).max(5000).optional() })
      .parse(req.body)
    if (body.body && c.userId !== user.id) throw badRequest('Solo puedes editar tus comentarios')
    await db.update(schema.comments).set(body).where(eq(schema.comments.id, id))
    broadcast(ws, { type: 'comments.changed', collectionId: c.collectionId, itemId: c.itemId, by: user.id })
    return { ok: true }
  })

  app.delete('/api/comments/:id', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const [c] = await db.select().from(schema.comments).where(eq(schema.comments.id, id))
    if (!c) throw notFound('Comentario')
    const ws = await assertCollection(c.collectionId, user.id, c.userId === user.id ? 'viewer' : 'admin')
    await db.delete(schema.comments).where(eq(schema.comments.id, id))
    broadcast(ws, { type: 'comments.changed', collectionId: c.collectionId, itemId: c.itemId, by: user.id })
    return { ok: true }
  })

  // Importar
  app.post('/api/workspaces/:ws/import', async (req) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id, 'editor')
    let input: string | Uint8Array
    if (req.isMultipart()) {
      const file = await req.file()
      if (!file) throw badRequest('Falta el fichero')
      input = new Uint8Array(await file.toBuffer())
    } else {
      const body = z.object({ text: z.string().optional(), url: z.string().url().optional() }).parse(req.body)
      if (body.url) {
        const res = await fetch(body.url, { signal: AbortSignal.timeout(20_000) })
        if (!res.ok) throw badRequest(`No se pudo descargar la URL (HTTP ${res.status})`)
        input = new Uint8Array(await res.arrayBuffer())
      } else if (body.text) input = body.text
      else throw badRequest('Envía un fichero, texto o una URL')
    }
    try {
      return await saveImport(ws, user.id, input)
    } catch (e) {
      throw badRequest(`No se pudo importar: ${(e as Error).message}`)
    }
  })

  // Exportar todo el workspace (formato data dump de Cartero/Postman v2.1)
  app.get('/api/workspaces/:ws/export', async (req, reply) => {
    const user = requireUser(req)
    const { ws } = req.params as { ws: string }
    await assertRole(ws, user.id)
    const cols = await db
      .select({ id: schema.collections.id })
      .from(schema.collections)
      .where(eq(schema.collections.workspaceId, ws))
    const collections = []
    for (const c of cols) collections.push(exportPostmanCollection((await loadCollection(c.id)).collection))
    const envs = await db.select().from(schema.environments).where(eq(schema.environments.workspaceId, ws))
    const [w] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, ws))
    reply.header('content-disposition', `attachment; filename="cartero-${encodeURIComponent(w.name)}.json"`)
    return {
      cartero: 1,
      exportedAt: new Date().toISOString(),
      collections,
      environments: envs.map((e) =>
        exportPostmanEnvironment({ id: e.id, name: e.name, values: openVariables(e.values) }),
      ),
      globals: openVariables(w.globals ?? []),
    }
  })
}

function descendantSet(rows: { id: string; parentId: string | null }[], rootId: string): Set<string> {
  const out = new Set<string>()
  const walk = (id: string) => {
    for (const r of rows) if (r.parentId === id && !out.has(r.id)) out.add(r.id), walk(r.id)
  }
  walk(rootId)
  return out
}

function findInTree(items: Item[], id: string): Item | undefined {
  for (const it of items) {
    if (it.id === id) return it
    const children = (it as any).item as Item[] | undefined
    if (children) {
      const f = findInTree(children, id)
      if (f) return f
    }
  }
  return undefined
}
