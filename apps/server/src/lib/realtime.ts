import type { WebSocket } from 'ws'
import type { AuthUser } from './auth.js'

interface Client {
  socket: WebSocket
  user: AuthUser
  workspaceId: string
  /** Ítem que está mirando/editando (presencia) */
  itemId?: string
  color: string
}

export type RealtimeEvent =
  | { type: 'collection.changed'; collectionId: string; itemId?: string; action: string; by: string }
  | { type: 'collections.changed'; by: string }
  | { type: 'environments.changed'; environmentId?: string; by: string }
  | { type: 'comments.changed'; collectionId: string; itemId?: string | null; by: string }
  | { type: 'run.updated'; runId: string; status: string }
  | { type: 'presence'; users: { id: string; name: string; itemId?: string; color: string }[] }

const COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d']
const rooms = new Map<string, Set<Client>>()

function colorFor(userId: string) {
  let h = 0
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]
}

function send(socket: WebSocket, msg: unknown) {
  if (socket.readyState === 1) socket.send(JSON.stringify(msg))
}

function presence(workspaceId: string) {
  const room = rooms.get(workspaceId)
  if (!room) return
  const seen = new Map<string, { id: string; name: string; itemId?: string; color: string }>()
  for (const c of room) {
    const prev = seen.get(c.user.id)
    if (!prev || c.itemId) seen.set(c.user.id, { id: c.user.id, name: c.user.name, itemId: c.itemId, color: c.color })
  }
  const msg: RealtimeEvent = { type: 'presence', users: [...seen.values()] }
  for (const c of room) send(c.socket, msg)
}

export function join(socket: WebSocket, user: AuthUser, workspaceId: string) {
  const client: Client = { socket, user, workspaceId, color: colorFor(user.id) }
  const room = rooms.get(workspaceId) ?? new Set()
  room.add(client)
  rooms.set(workspaceId, room)
  presence(workspaceId)

  socket.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw))
      if (msg.type === 'presence') {
        client.itemId = typeof msg.itemId === 'string' ? msg.itemId : undefined
        presence(workspaceId)
      } else if (msg.type === 'ping') {
        send(socket, { type: 'pong' })
      }
    } catch {}
  })
  socket.on('close', () => {
    room.delete(client)
    if (!room.size) rooms.delete(workspaceId)
    else presence(workspaceId)
  })
}

export function broadcast(workspaceId: string, event: RealtimeEvent) {
  const room = rooms.get(workspaceId)
  if (!room) return
  for (const c of room) send(c.socket, event)
}
