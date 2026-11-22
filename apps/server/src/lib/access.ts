import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import type { Role } from '../db/schema.js'
import { forbidden, notFound } from './errors.js'

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 }

export function roleAtLeast(role: Role, min: Role) {
  return RANK[role] >= RANK[min]
}

export async function getRole(workspaceId: string, userId: string): Promise<Role | undefined> {
  const rows = await db
    .select({ role: schema.members.role })
    .from(schema.members)
    .where(and(eq(schema.members.workspaceId, workspaceId), eq(schema.members.userId, userId)))
    .limit(1)
  return rows[0]?.role
}

/** Comprueba que el usuario pertenece al workspace con al menos el rol indicado. */
export async function assertRole(workspaceId: string, userId: string, min: Role = 'viewer'): Promise<Role> {
  const role = await getRole(workspaceId, userId)
  if (!role) throw notFound('Workspace')
  if (!roleAtLeast(role, min)) throw forbidden()
  return role
}

export async function collectionWorkspace(collectionId: string): Promise<string> {
  const rows = await db
    .select({ ws: schema.collections.workspaceId })
    .from(schema.collections)
    .where(eq(schema.collections.id, collectionId))
    .limit(1)
  if (!rows[0]) throw notFound('Colección')
  return rows[0].ws
}

export async function assertCollection(collectionId: string, userId: string, min: Role = 'viewer') {
  const ws = await collectionWorkspace(collectionId)
  await assertRole(ws, userId, min)
  return ws
}

export async function itemCollection(itemId: string): Promise<string> {
  const rows = await db
    .select({ c: schema.items.collectionId })
    .from(schema.items)
    .where(eq(schema.items.id, itemId))
    .limit(1)
  if (!rows[0]) throw notFound('Elemento')
  return rows[0].c
}
