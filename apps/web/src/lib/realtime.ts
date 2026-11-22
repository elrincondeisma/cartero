import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { qk } from '@/api/hooks'
import { usePresence } from '@/store/ui'

let socketRef: WebSocket | undefined

/** Comunica al resto del equipo qué elemento estoy mirando. */
export function sendPresence(itemId?: string) {
  if (socketRef?.readyState === WebSocket.OPEN) socketRef.send(JSON.stringify({ type: 'presence', itemId }))
}

/** Conexión WebSocket por workspace: presencia + invalidación de cachés ante cambios de otros. */
export function useRealtime(ws: string, myId?: string, currentItem?: string) {
  const qc = useQueryClient()
  const setUsers = usePresence((s) => s.setUsers)
  const current = useRef(currentItem)
  current.current = currentItem

  useEffect(() => {
    if (!ws || !myId) return
    let closed = false
    let retry = 0
    let timer: ReturnType<typeof setTimeout>
    let ping: ReturnType<typeof setInterval>

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const s = new WebSocket(`${proto}://${location.host}/api/ws?workspace=${ws}`)
      socketRef = s
      s.onopen = () => {
        retry = 0
        sendPresence(current.current)
        ping = setInterval(() => s.readyState === WebSocket.OPEN && s.send('{"type":"ping"}'), 25_000)
      }
      s.onmessage = (ev) => {
        const msg = JSON.parse(ev.data)
        switch (msg.type) {
          case 'presence':
            setUsers(msg.users)
            break
          case 'collection.changed':
            qc.invalidateQueries({ queryKey: qk.collection(msg.collectionId) })
            qc.invalidateQueries({ queryKey: ['revisions', msg.collectionId] })
            if (msg.by !== myId) qc.invalidateQueries({ queryKey: qk.collections(ws) })
            break
          case 'collections.changed':
            qc.invalidateQueries({ queryKey: qk.collections(ws) })
            break
          case 'environments.changed':
            qc.invalidateQueries({ queryKey: qk.environments(ws) })
            qc.invalidateQueries({ queryKey: qk.globals(ws) })
            break
          case 'comments.changed':
            qc.invalidateQueries({ queryKey: ['comments', msg.collectionId] })
            break
          case 'run.updated':
            qc.invalidateQueries({ queryKey: ['runs', ws] })
            qc.invalidateQueries({ queryKey: qk.run(msg.runId) })
            qc.invalidateQueries({ queryKey: qk.monitors(ws) })
            break
        }
      }
      s.onclose = () => {
        clearInterval(ping)
        if (closed) return
        timer = setTimeout(connect, Math.min(15_000, 500 * 2 ** retry++))
      }
    }
    connect()
    return () => {
      closed = true
      clearTimeout(timer)
      clearInterval(ping)
      socketRef?.close()
      socketRef = undefined
      setUsers([])
    }
  }, [ws, myId, qc, setUsers])

  useEffect(() => {
    sendPresence(currentItem)
  }, [currentItem])
}
