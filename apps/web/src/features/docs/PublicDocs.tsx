import { type Collection, type FolderItem, type Item, type RequestItem, isFolder, rawUrl, resolveVariables } from '@cartero/core'
import DOMPurify from 'dompurify'
import { Copy, Lock, Moon, Sun } from 'lucide-react'
import { marked } from 'marked'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { toast } from 'sonner'
import { Logo } from '@/components/Logo'
import { Badge, Button, Input, MethodBadge, Spinner, cx, statusTone } from '@/components/ui'
import { useUi } from '@/store/ui'
import { t, tj } from "@/i18n";

interface DocData {
  collection: Collection
  environment: { key: string; value: string }[]
}

function md(text?: string | { content?: string }) {
  const s = typeof text === 'string' ? text : (text?.content ?? '')
  return DOMPurify.sanitize(marked.parse(s, { async: false }) as string)
}

function slug(id: string) {
  return `r-${id}`
}

/** Página pública de documentación generada a partir de una colección. */
export function PublicDocs() {
  const { slug: docSlug } = useParams()
  const [data, setData] = useState<DocData>()
  const [needsPassword, setNeedsPassword] = useState(false)
  const [password, setPassword] = useState(() => sessionStorage.getItem(`docs-pw-${docSlug}`) ?? '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const theme = useUi((s) => s.theme)
  const toggleTheme = useUi((s) => s.toggleTheme)

  const load = async (pw?: string) => {
    setLoading(true)
    const res = await fetch(`/api/public/docs/${docSlug}`, { headers: pw ? { 'x-docs-password': pw } : {} })
    setLoading(false)
    if (res.status === 401) {
      setNeedsPassword(true)
      if (pw) setError(t('Contraseña incorrecta'))
      return
    }
    if (!res.ok) return setError(t('Esta documentación no existe o no está publicada.'))
    sessionStorage.setItem(`docs-pw-${docSlug}`, pw ?? '')
    setNeedsPassword(false)
    setError('')
    const d = (await res.json()) as DocData
    setData(d)
    document.title = `${d.collection.info.name} · ${t('Documentación')}`
  }

  useEffect(() => {
    void load(password || undefined)
  }, [docSlug])

  const vars = useMemo(() => {
    const out: Record<string, string> = {}
    for (const v of data?.collection.variable ?? []) if (!v.disabled && v.type !== 'secret') out[v.key] = String(v.value ?? '')
    for (const v of data?.environment ?? []) out[v.key] = v.value
    return out
  }, [data])

  if (loading && !data)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )

  if (needsPassword)
    return (
      <div className="flex h-full items-center justify-center bg-soft p-6">
        <form
          className="w-full max-w-sm rounded-xl border border-app bg-app p-6"
          onSubmit={(e) => {
            e.preventDefault()
            void load(password)
          }}
        >
          <Lock className="mb-3 size-6 text-muted" />
          <h1 className="mb-1 font-semibold">{t("Documentación protegida")}</h1>
          <p className="mb-4 text-muted">{t("Introduce la contraseña para verla.")}</p>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <Button type="submit" variant="primary" className="mt-3 w-full">
            {t("Ver documentación")}</Button>
        </form>
      </div>
    )

  if (error || !data) return <div className="flex h-full items-center justify-center text-muted">{error}</div>

  const col = data.collection
  return (
    <div className="flex h-full">
      <aside className="flex w-72 shrink-0 flex-col border-r border-app bg-soft">
        <div className="border-b border-app p-4">
          <div className="font-semibold">{col.info.name}</div>
          <div className="text-xs text-muted">{t("Documentación de la API")}</div>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          <NavTree items={col.item} />
        </nav>
        <div className="flex items-center justify-between border-t border-app px-4 py-2 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            {tj('Hecho con {logo} Cartero', { logo: <Logo size={14} withText={false} /> })}</span>
          <button onClick={toggleTheme} aria-label={t("Cambiar tema")} className="rounded p-1 hover:bg-muted">
            {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-10 py-10">
          <h1 className="text-3xl font-bold">{col.info.name}</h1>
          {col.info.description && <div className="prose-docs mt-4" dangerouslySetInnerHTML={{ __html: md(col.info.description) }} />}
          {col.auth && col.auth.type !== 'noauth' && (
            <p className="mt-4 text-muted">
              {t("Autenticación:")}{' '}<Badge>{col.auth.type}</Badge>
            </p>
          )}
          <ItemsDocs items={col.item} vars={vars} depth={0} />
        </div>
      </main>
    </div>
  )
}

function NavTree({ items }: { items: Item[] }) {
  return (
    <ul className="space-y-0.5">
      {items.map((it) =>
        isFolder(it) ? (
          <li key={it.id}>
            <a href={`#${slug(it.id!)}`} className="block truncate rounded px-2 py-1 font-medium hover:bg-muted">
              {it.name}
            </a>
            <div className="ml-3 border-l border-app pl-1">
              <NavTree items={it.item} />
            </div>
          </li>
        ) : (
          <li key={it.id}>
            <a href={`#${slug(it.id!)}`} className="flex items-center gap-2 truncate rounded px-2 py-1 hover:bg-muted">
              <MethodBadge method={it.request.method} className="w-10 shrink-0 text-right" />
              <span className="truncate">{it.name}</span>
            </a>
          </li>
        ),
      )}
    </ul>
  )
}

function ItemsDocs({ items, vars, depth }: { items: Item[]; vars: Record<string, string>; depth: number }) {
  return (
    <>
      {items.map((it) =>
        isFolder(it) ? <FolderDoc key={it.id} folder={it} vars={vars} depth={depth} /> : <RequestDoc key={it.id} item={it} vars={vars} />,
      )}
    </>
  )
}

function FolderDoc({ folder, vars, depth }: { folder: FolderItem; vars: Record<string, string>; depth: number }) {
  return (
    <section id={slug(folder.id!)} className="mt-12 scroll-mt-6">
      <h2 className={cx('border-b border-app pb-2 font-semibold', depth === 0 ? 'text-2xl' : 'text-xl')}>{folder.name}</h2>
      {folder.description && <div className="prose-docs mt-3" dangerouslySetInnerHTML={{ __html: md(folder.description) }} />}
      <ItemsDocs items={folder.item} vars={vars} depth={depth + 1} />
    </section>
  )
}

function curlFor(item: RequestItem, vars: Record<string, string>) {
  const r = item.request
  const sub = (s: string) => resolveVariables(s, [vars])
  const parts = [`curl -X ${r.method} '${sub(rawUrl(r.url))}'`]
  for (const h of r.header ?? []) if (!h.disabled) parts.push(`-H '${sub(h.key)}: ${sub(h.value)}'`)
  if (r.body?.mode === 'raw' && r.body.raw) parts.push(`--data-raw '${sub(r.body.raw).replace(/'/g, "'\\''")}'`)
  if (r.body?.mode === 'urlencoded') for (const p of r.body.urlencoded ?? []) if (!p.disabled) parts.push(`--data-urlencode '${sub(p.key)}=${sub(p.value)}'`)
  if (r.body?.mode === 'formdata') for (const p of r.body.formdata ?? []) if (!p.disabled) parts.push(p.type === 'file' ? `-F '${p.key}=@fichero'` : `-F '${sub(p.key)}=${sub(p.value ?? '')}'`)
  if (r.body?.mode === 'graphql') parts.push(`--data-raw '${JSON.stringify({ query: r.body.graphql?.query, variables: safeParse(r.body.graphql?.variables) })}'`)
  return parts.join(' \\\n  ')
}

function safeParse(s?: string) {
  try {
    return s ? JSON.parse(s) : undefined
  } catch {
    return undefined
  }
}

function RequestDoc({ item, vars }: { item: RequestItem; vars: Record<string, string> }) {
  const r = item.request
  const url = resolveVariables(rawUrl(r.url), [vars])
  const [ex, setEx] = useState(0)
  const examples = item.response ?? []
  const curl = curlFor(item, vars)
  const query = typeof r.url === 'object' ? (r.url.query ?? []).filter((q) => !q.disabled) : []
  return (
    <article id={slug(item.id!)} className="mt-10 scroll-mt-6">
      <h3 className="flex items-center gap-3 text-lg font-semibold">
        <MethodBadge method={r.method} className="text-sm" />
        {item.name}
      </h3>
      <div className="mt-2 rounded-md bg-soft px-3 py-2 font-mono text-[12.5px] break-all">{url}</div>
      {r.description && <div className="prose-docs mt-3" dangerouslySetInnerHTML={{ __html: md(r.description as any) }} />}
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {query.length > 0 && <ParamTable title={t("Query params")} rows={query.map((q) => ({ key: q.key ?? '', value: q.value ?? '', description: q.description }))} />}
          {!!r.header?.filter((h) => !h.disabled).length && <ParamTable title={t("Cabeceras")} rows={r.header.filter((h) => !h.disabled)} />}
          {r.body?.mode === 'raw' && r.body.raw && (
            <div>
              <h4 className="mb-1 text-xs font-semibold text-muted uppercase">{t("Body")}</h4>
              <pre className="max-h-72 overflow-auto rounded-md bg-soft p-3 font-mono text-xs">{r.body.raw}</pre>
            </div>
          )}
          {(r.body?.mode === 'urlencoded' || r.body?.mode === 'formdata') && (
            <ParamTable title={t("Body")} rows={((r.body.urlencoded ?? r.body.formdata) as any[]).filter((p) => !p.disabled).map((p) => ({ key: p.key, value: p.type === 'file' ? '(fichero)' : (p.value ?? ''), description: p.description }))} />
          )}
        </div>
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <h4 className="text-xs font-semibold text-muted uppercase">{t("Ejemplo cURL")}</h4>
              <button
                className="flex items-center gap-1 text-xs text-muted hover:text-app"
                onClick={() => {
                  navigator.clipboard.writeText(curl)
                  toast.success(t("Copiado"))
                }}
              >
                <Copy className="size-3" /> {t("Copiar")}</button>
            </div>
            <pre className="max-h-64 overflow-auto rounded-md bg-zinc-900 p-3 font-mono text-xs text-zinc-100">{curl}</pre>
          </div>
          {examples.length > 0 && (
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-1">
                <h4 className="mr-2 text-xs font-semibold text-muted uppercase">{t("Respuestas de ejemplo")}</h4>
                {examples.map((e, i) => (
                  <button key={e.id ?? i} onClick={() => setEx(i)} className={cx('rounded px-1.5 py-0.5 text-xs', i === ex ? 'bg-muted font-medium' : 'text-muted')}>
                    <Badge tone={statusTone(e.code)}>{e.code}</Badge> {e.name}
                  </button>
                ))}
              </div>
              <pre className="max-h-72 overflow-auto rounded-md bg-soft p-3 font-mono text-xs">{pretty(examples[ex]?.body ?? '')}</pre>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function pretty(s: string) {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

function ParamTable({ title, rows }: { title: string; rows: { key: string; value: string; description?: any }[] }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold text-muted uppercase">{title}</h4>
      <table className="w-full text-[12.5px]">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-app align-top">
              <td className="py-1.5 pr-3 font-mono text-xs font-medium">{r.key}</td>
              <td className="py-1.5 pr-3 font-mono text-xs text-muted break-all">{r.value}</td>
              <td className="py-1.5 text-xs text-muted">{typeof r.description === 'string' ? r.description : r.description?.content}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
