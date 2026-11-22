import { randomUUID } from 'node:crypto'
import { type Collection, type FolderItem, type Item, isFolder } from './types.js'

export function newId(): string {
  return randomUUID()
}

/** Recorre todos los ítems (carpetas y peticiones) en profundidad. */
export function* walkItems(items: Item[], parents: FolderItem[] = []): Generator<{ item: Item; parents: FolderItem[] }> {
  for (const item of items) {
    yield { item, parents }
    if (isFolder(item)) yield* walkItems(item.item, [...parents, item])
  }
}

/** Asigna ids a todos los ítems que no tengan. Devuelve la misma colección (mutada). */
export function ensureIds(collection: Collection): Collection {
  collection.info._postman_id ??= newId()
  for (const { item } of walkItems(collection.item)) {
    item.id ??= newId()
    if (!isFolder(item)) for (const r of item.response ?? []) r.id ??= newId()
  }
  return collection
}

export function countRequests(items: Item[]): number {
  let n = 0
  for (const { item } of walkItems(items)) if (!isFolder(item)) n++
  return n
}
