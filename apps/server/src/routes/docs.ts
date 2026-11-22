import { exportPostmanCollection } from '@cartero/exporters'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, schema } from '../db/index.js'
import { assertCollection } from '../lib/access.js'
import { requireUser } from '../lib/auth.js'
import { hashPassword, openVariables, verifyPassword } from '../lib/crypto.js'
import { HttpError, conflict, notFound } from '../lib/errors.js'
import { loadCollection } from '../lib/tree.js'

/** Quita valores de variables secretas y credenciales de auth antes de publicar. */
function scrub(value: any): any {
  if (Array.isArray(value)) return value.map(scrub)
  if (value && typeof value === 'object') {
    const out: any = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === 'auth' && v && typeof v === 'object') {
        const a: any = { type: (v as any).type }
        for (const [scheme, attrs] of Object.entries(v as any)) {
          if (scheme === 'type' || !Array.isArray(attrs)) continue
          a[scheme] = attrs.map((x: any) =>
            /password|secret|token|key|value|clientSecret|accessKey|sessionToken/i.test(x.key) && !/^\{\{.*\}\}$/.test(String(x.value ?? ''))
              ? { ...x, value: '••••••' }
              : x,
          )
        }
        out[k] = a
      } else if (k === 'variable' && Array.isArray(v)) {
        out[k] = v.map((x: any) => (x.type === 'secret' ? { ...x, value: '' } : x))
      } else out[k] = scrub(v)
    }
    return out
  }
  return value
}

export async function docsRoutes(app: FastifyInstance) {
  app.get('/api/collections/:id/docs', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    await assertCollection(id, user.id)
    const [doc] = await db.select().from(schema.docs).where(eq(schema.docs.collectionId, id))
    if (!doc) return null
    const { passwordHash, ...rest } = doc
    return { ...rest, hasPassword: !!passwordHash }
  })

  app.put('/api/collections/:id/docs', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    const ws = await assertCollection(id, user.id, 'editor')
    const body = z
      .object({
        slug: z
          .string()
          .min(3)
          .max(80)
          .regex(/^[a-z0-9-]+$/, 'Solo minúsculas, números y guiones'),
        published: z.boolean(),
        environmentId: z.string().uuid().nullable().optional(),
        /** null = quitar contraseña, undefined = no cambiar */
        password: z.string().min(4).max(200).nullable().optional(),
      })
      .parse(req.body)
    const [taken] = await db.select().from(schema.docs).where(eq(schema.docs.slug, body.slug))
    if (taken && taken.collectionId !== id) throw conflict('Esa URL ya está en uso')
    const values: Partial<typeof schema.docs.$inferInsert> = {
      slug: body.slug,
      published: body.published,
      environmentId: body.environmentId ?? null,
    }
    if (body.password !== undefined) values.passwordHash = body.password ? await hashPassword(body.password) : null
    const [existing] = await db.select().from(schema.docs).where(eq(schema.docs.collectionId, id))
    const [row] = existing
      ? await db.update(schema.docs).set(values).where(eq(schema.docs.id, existing.id)).returning()
      : await db
          .insert(schema.docs)
          .values({ workspaceId: ws, collectionId: id, slug: body.slug, published: body.published, ...values })
          .returning()
    const { passwordHash, ...rest } = row
    return { ...rest, hasPassword: !!passwordHash }
  })

  app.delete('/api/collections/:id/docs', async (req) => {
    const user = requireUser(req)
    const { id } = req.params as { id: string }
    await assertCollection(id, user.id, 'editor')
    await db.delete(schema.docs).where(eq(schema.docs.collectionId, id))
    return { ok: true }
  })

  /** Documentación pública (sin login). */
  app.get('/api/public/docs/:slug', async (req) => {
    const { slug } = req.params as { slug: string }
    const [doc] = await db.select().from(schema.docs).where(eq(schema.docs.slug, slug))
    if (!doc || !doc.published) throw notFound('Documentación')
    if (doc.passwordHash) {
      const pw = req.headers['x-docs-password']
      if (typeof pw !== 'string' || !(await verifyPassword(pw, doc.passwordHash)))
        throw new HttpError(401, 'Esta documentación está protegida con contraseña', 'password_required')
    }
    const { collection } = await loadCollection(doc.collectionId)
    let environment: { key: string; value: string }[] = []
    if (doc.environmentId) {
      const [env] = await db.select().from(schema.environments).where(eq(schema.environments.id, doc.environmentId))
      environment = openVariables(env?.values ?? [])
        .filter((v: any) => !v.disabled && v.type !== 'secret')
        .map((v: any) => ({ key: v.key, value: String(v.value ?? '') }))
    }
    return { collection: scrub(exportPostmanCollection(collection)), environment }
  })
}
