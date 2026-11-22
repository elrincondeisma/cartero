import type { RequestItem } from '@cartero/core'
import type { ItemRow } from '@/api/types'

export interface TreeNode {
  row: ItemRow
  children: TreeNode[]
}

export function buildTree(rows: ItemRow[]): TreeNode[] {
  const byParent = new Map<string | null, ItemRow[]>()
  for (const r of rows) {
    const list = byParent.get(r.parentId) ?? []
    list.push(r)
    byParent.set(r.parentId, list)
  }
  const build = (parent: string | null): TreeNode[] =>
    (byParent.get(parent) ?? [])
      .sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0))
      .map((row) => ({ row, children: row.type === 'folder' ? build(row.id) : [] }))
  return build(null)
}

export function rowToRequestItem(row: ItemRow): RequestItem {
  return {
    id: row.id,
    name: row.name,
    ...(row.data as any),
    request: row.data.request ?? { method: 'GET', url: { raw: '' }, header: [] },
  }
}

/** Cadena de carpetas desde la raíz hasta el ítem (sin incluirlo). */
export function ancestors(rows: ItemRow[], id: string): ItemRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out: ItemRow[] = []
  let cur = byId.get(id)?.parentId
  while (cur) {
    const r = byId.get(cur)
    if (!r) break
    out.unshift(r)
    cur = r.parentId
  }
  return out
}

/** Ids de las peticiones en orden de ejecución (profundidad primero). */
export function requestOrder(nodes: TreeNode[]): ItemRow[] {
  const out: ItemRow[] = []
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.row.type === 'request') out.push(n.row)
      else walk(n.children)
    }
  }
  walk(nodes)
  return out
}

export function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.row.id === id) return n
    const f = findNode(n.children, id)
    if (f) return f
  }
  return undefined
}
