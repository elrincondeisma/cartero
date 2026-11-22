import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { db, schema } from '../db/index.js'
import { requireUser } from '../lib/auth.js'
import { WORKSPACE_NAME, revertDemo, seedDemo } from '../lib/demo.js'
import { conflict } from '../lib/errors.js'

interface DemoState {
  status: 'running' | 'done' | 'error' | 'reverting'
  log: string[]
  workspaceId?: string
  error?: string
}

const states = new Map<string, DemoState>()

async function demoWorkspace(userId: string) {
  const [row] = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .innerJoin(schema.members, eq(schema.members.workspaceId, schema.workspaces.id))
    .where(and(eq(schema.workspaces.name, WORKSPACE_NAME), eq(schema.members.userId, userId), eq(schema.members.role, 'owner')))
  return row?.id
}

/** Datos de ejemplo con APIs públicas reales, desde la app (tour inicial y Ajustes). */
export async function demoRoutes(app: FastifyInstance) {
  app.get('/api/demo', async (req) => {
    const user = requireUser(req)
    const s = states.get(user.id)
    const workspaceId = await demoWorkspace(user.id)
    return { status: s?.status ?? (workspaceId ? 'done' : 'idle'), log: s?.log ?? [], workspaceId: s?.workspaceId ?? workspaceId, error: s?.error }
  })

  app.post('/api/demo', async (req, reply) => {
    const user = requireUser(req)
    const cur = states.get(user.id)
    if (cur?.status === 'running' || cur?.status === 'reverting') throw conflict('Ya hay una operación de demo en curso')
    if (await demoWorkspace(user.id)) throw conflict(`Ya tienes el workspace «${WORKSPACE_NAME}»`)
    const state: DemoState = { status: 'running', log: [] }
    states.set(user.id, state)
    const [u] = await db.select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, user.id))
    const bodyLang = (req.body as { lang?: string } | undefined)?.lang
    const lang = bodyLang === 'en' || bodyLang === 'es' ? bodyLang : (u?.settings as any)?.lang === 'en' ? 'en' : 'es'
    void seedDemo(user.email, (l) => state.log.push(l.replace(/^• /, '')), lang)
      .then(({ workspaceId }) => {
        state.status = 'done'
        state.workspaceId = workspaceId
      })
      .catch((e) => {
        state.status = 'error'
        state.error = (e as Error).message
      })
    return reply.code(202).send({ status: 'running' })
  })

  app.delete('/api/demo', async (req) => {
    const user = requireUser(req)
    const state: DemoState = { status: 'reverting', log: [] }
    states.set(user.id, state)
    try {
      await revertDemo(user.email, (l) => state.log.push(l.replace(/^• /, '')))
      states.delete(user.id)
      return { ok: true }
    } catch (e) {
      state.status = 'error'
      state.error = (e as Error).message
      throw e
    }
  })
}
