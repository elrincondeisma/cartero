import { inArray, sql } from 'drizzle-orm'
import { type DB, db, schema } from '../db/index.js'

export type SyncEntity = 'collection' | 'item' | 'environment'

/** Apunta lo borrado para que la app de escritorio lo elimine al sincronizar. */
export async function recordDeletions(workspaceId: string, entity: SyncEntity, ids: string[], tx: DB = db) {
  if (!ids.length) return
  await tx
    .insert(schema.deletions)
    .values(ids.map((entityId) => ({ workspaceId, entity, entityId })))
    .onConflictDoUpdate({
      target: [schema.deletions.entity, schema.deletions.entityId],
      set: { deletedAt: sql`now()`, workspaceId },
    })
}

/** Si algo vuelve a existir con el mismo id, ya no está borrado. */
export async function forgetDeletions(ids: string[], tx: DB = db) {
  if (!ids.length) return
  await tx.delete(schema.deletions).where(inArray(schema.deletions.entityId, ids))
}

/** JSON con las claves ordenadas: jsonb reordena las claves, así se comparan bien. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}
