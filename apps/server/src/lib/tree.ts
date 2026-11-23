import { randomUUID } from 'node:crypto'
import {
  type Collection,
  type FolderItem,
  type Item,
  POSTMAN_SCHEMA_V21,
  type RequestItem,
  isFolder,
} from '@cartero/core'
import { asc, eq } from 'drizzle-orm'
import { generateNKeysBetween } from 'fractional-indexing'
import { type DB, db, schema } from '../db/index.js'
import { notFound } from './errors.js'

type ItemRow = typeof schema.items.$inferSelect
type NewItemRow = typeof schema.items.$inferInsert

const COLLECTION_KEYS = ['auth', 'event', 'variable', 'protocolProfileBehavior', 'description'] as const

/** Separa un ítem en (name, data) para guardarlo en la fila. */
export function itemData(item: Item): Record<string, any> {
  const { id: _id, name: _name, ...rest } = item as any
  if (isFolder(item)) delete rest.item
  return rest
}

export function rowToItem(row: ItemRow, children?: Item[]): Item {
  if (row.type === 'folder')
    return { id: row.id, name: row.name, ...row.data, item: children ?? [] } as FolderItem
  return { id: row.id, name: row.name, ...row.data } as RequestItem
}

export function buildTree(rows: ItemRow[]): Item[] {
  const byParent = new Map<string | null, ItemRow[]>()
  for (const r of rows) {
    const list = byParent.get(r.parentId) ?? []
    list.push(r)
    byParent.set(r.parentId, list)
  }
  const build = (parentId: string | null): Item[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0))
      .map((r) => rowToItem(r, r.type === 'folder' ? build(r.id) : undefined))
  return build(null)
}

export type CollectionRow = typeof schema.collections.$inferSelect

export function rowToCollection(row: CollectionRow, items: Item[]): Collection {
  const data = row.data ?? {}
  const col: Collection = {
    info: {
      _postman_id: row.id,
      name: row.name,
      description: data.description,
      schema: POSTMAN_SCHEMA_V21,
    },
    item: items,
  }
  for (const k of COLLECTION_KEYS) if (k !== 'description' && data[k] != null) (col as any)[k] = data[k]
  return col
}

export async function loadCollection(
  collectionId: string,
  tx: DB = db,
): Promise<{ row: CollectionRow; collection: Collection }> {
  const [row] = await tx
    .select()
    .from(schema.collections)
    .where(eq(schema.collections.id, collectionId))
    .limit(1)
  if (!row) throw notFound('Colección')
  const rows = await tx
    .select()
    .from(schema.items)
    .where(eq(schema.items.collectionId, collectionId))
    .orderBy(asc(schema.items.sort))
  return { row, collection: rowToCollection(row, buildTree(rows)) }
}

export function collectionData(col: Collection): Record<string, any> {
  const data: Record<string, any> = {}
  for (const k of COLLECTION_KEYS) {
    const v = k === 'description' ? (col.info.description ?? (col as any).description) : (col as any)[k]
    if (v !== undefined && v !== null) data[k] = v
  }
  return stripNul(data)
}

/**
 * PostgreSQL no admite el carácter NUL (\u0000) en jsonb ni en text. Aparece en respuestas
 * guardadas con cuerpos binarios (un .docx o un .xlsx pegados como texto), así que se quita
 * antes de guardar.
 */
export function stripNul<T>(value: T): T {
  if (typeof value === 'string')
    return (value.includes('\u0000') ? value.replaceAll('\u0000', '') : value) as T
  if (Array.isArray(value)) return value.map(stripNul) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[stripNul(k)] = stripNul(v)
    return out as T
  }
  return value
}

/** Aplana el árbol a filas con ids nuevos y claves de orden fraccional. */
export function flattenItems(collectionId: string, items: Item[], userId?: string): NewItemRow[] {
  const out: NewItemRow[] = []
  const walk = (list: Item[], parentId: string | null) => {
    const keys = generateNKeysBetween(null, null, list.length)
    list.forEach((item, i) => {
      const id = randomUUID()
      out.push({
        id,
        collectionId,
        parentId,
        type: isFolder(item) ? 'folder' : 'request',
        name: stripNul(item.name || 'Sin nombre'),
        sort: keys[i],
        data: stripNul(itemData(item)),
        updatedBy: userId,
      })
      if (isFolder(item)) walk(item.item, id)
    })
  }
  walk(items, null)
  return out
}

/** Crea una colección completa (con su árbol) en un workspace. */
export async function insertCollection(
  workspaceId: string,
  col: Collection,
  userId?: string,
  forkedFrom?: string,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.collections)
      .values({ workspaceId, name: col.info.name || 'Colección', data: collectionData(col), forkedFrom })
      .returning()
    const rows = flattenItems(row.id, col.item, userId)
    for (let i = 0; i < rows.length; i += 500) await tx.insert(schema.items).values(rows.slice(i, i + 500))
    return row
  })
}

/** Sustituye (en memoria) un ítem del árbol por otro con el mismo id. */
export function replaceItem(items: Item[], replacement: Item): boolean {
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.id === replacement.id) {
      items[i] =
        isFolder(it) && !isFolder(replacement)
          ? replacement
          : { ...replacement, ...(isFolder(it) ? { item: it.item } : {}) }
      return true
    }
    if (isFolder(it) && replaceItem(it.item, replacement)) return true
  }
  return false
}

export function findItem(items: Item[], id: string): Item | undefined {
  for (const it of items) {
    if (it.id === id) return it
    if (isFolder(it)) {
      const f = findItem(it.item, id)
      if (f) return f
    }
  }
  return undefined
}
