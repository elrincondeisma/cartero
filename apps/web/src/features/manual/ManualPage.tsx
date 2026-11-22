import DOMPurify from 'dompurify'
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Moon, Search, Sun } from 'lucide-react'
import { marked } from 'marked'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Logo } from '@/components/Logo'
import { cx } from '@/components/ui'
import { useUi } from '@/store/ui'
import { lang, t } from "@/i18n";

// Misma fuente que docs/manual en el repositorio
// (inglés en docs/manual, español en docs/manual/es; los nombres de fichero cambian, el número de capítulo no)
const enFiles = import.meta.glob('../../../../../docs/manual/[0-9]*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const esFiles = import.meta.glob('../../../../../docs/manual/es/[0-9]*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const files = lang === 'en' ? enFiles : esFiles

interface Chapter {
  slug: string
  title: string
  md: string
  html: string
  headings: { id: string; text: string }[]
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const CHAPTERS: Chapter[] = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, raw]) => {
    // La línea «🌐 English · Español» es para GitHub; aquí el idioma se cambia desde la app
    const md = raw.replace(/^> 🌐.*\n+/m, '')
    const slug = path.split('/').pop()!.replace(/\.md$/, '')
    const title = md.match(/^# (.+)$/m)?.[1] ?? slug
    const headings: Chapter['headings'] = []
    const renderer = new marked.Renderer()
    renderer.heading = ({ tokens, depth }) => {
      const text = tokens.map((tItem: any) => tItem.raw ?? tItem.text).join('')
      const id = slugify(text)
      if (depth === 2) headings.push({ id, text })
      return `<h${depth} id="${id}">${marked.parseInline(text)}</h${depth}>`
    }
    renderer.link = ({ href, text }) => {
      const internal = /^\d{2}-[a-z0-9-]+\.md(#.*)?$/.test(href)
      const url = internal ? `/ayuda/${href.replace(/\.md/, '')}` : href
      return `<a href="${url}"${internal ? ' data-internal' : " target=\"_blank\" rel=\"noreferrer\""}>${text}</a>`
    }
    const html = DOMPurify.sanitize(marked.parse(md.replace(/^# .+$/m, ''), { renderer, async: false }) as string, { ADD_ATTR: ['target', 'data-internal'] })
    return { slug, title, md, html, headings }
  })

function snippet(md: string, q: string) {
  const plain = md.replace(/[#*`|>[\]()_-]+/g, ' ').replace(/\s+/g, ' ')
  const i = plain.toLowerCase().indexOf(q.toLowerCase())
  if (i === -1) return ''
  return `${i > 40 ? '…' : ''}${plain.slice(Math.max(0, i - 40), i + 80)}…`
}

/** Manual de uso: público, con buscador e índice. */
export function ManualPage() {
  const { slug } = useParams()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const content = useRef<HTMLDivElement>(null)
  const theme = useUi((s) => s.theme)
  const toggleTheme = useUi((s) => s.toggleTheme)
  // Si el slug es del otro idioma (p. ej. tras cambiar de idioma), se busca por número de capítulo
  const idx = Math.max(0, CHAPTERS.findIndex((c) => c.slug === slug), CHAPTERS.findIndex((c) => !!slug && c.slug.slice(0, 3) === slug.slice(0, 3)))
  const chapter = CHAPTERS[idx]

  const results = useMemo(() => {
    const tItem = q.trim().toLowerCase()
    if (tItem.length < 2) return null
    return CHAPTERS.filter((c) => c.md.toLowerCase().includes(tItem)).map((c) => ({ c, snip: snippet(c.md, tItem) }))
  }, [q])

  useEffect(() => {
    document.title = `${chapter.title} · ${t('Manual de Cartero')}`
    const hash = location.hash.slice(1)
    if (hash) document.getElementById(hash)?.scrollIntoView()
    else content.current?.scrollTo(0, 0)
  }, [chapter])

  // Enlaces internos sin recargar la página
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a[data-internal]') as HTMLAnchorElement | null
    if (!a) return
    e.preventDefault()
    nav(a.getAttribute('href')!)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-app px-4">
        <Link to="/" className="flex items-center gap-2">
          <Logo />
        </Link>
        <span className="flex items-center gap-1.5 text-muted">
          <BookOpen className="size-4" /> {t("Manual")}</span>
        <div className="flex-1" />
        <button onClick={toggleTheme} className="rounded-md p-1.5 text-muted hover:bg-muted hover:text-app" aria-label={t("Cambiar tema")}>
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <Link to="/" className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-muted hover:text-app">
          <ArrowLeft className="size-3.5" /> {t("Volver a Cartero")}</Link>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-app bg-soft">
          <div className="p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("Buscar en el manual")}
                className="h-8 w-full rounded-md border border-app bg-app pr-2 pl-8 text-[13px] outline-none focus:border-brand-500"
              />
            </div>
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {results
              ? results.length === 0
                ? <p className="px-2 text-muted">{t("Sin resultados.")}</p>
                : results.map(({ c, snip }) => (
                    <Link key={c.slug} to={`/ayuda/${c.slug}`} className="mb-1 block rounded-md px-2.5 py-2 hover:bg-muted">
                      <div className="font-medium">{c.title}</div>
                      <div className="text-xs text-muted">{snip}</div>
                    </Link>
                  ))
              : CHAPTERS.map((c, i) => (
                  <Link
                    key={c.slug}
                    to={`/ayuda/${c.slug}`}
                    className={cx('flex items-center gap-2 rounded-md px-2.5 py-1.5', i === idx ? 'bg-brand-500/10 font-medium text-app' : 'text-muted hover:bg-muted hover:text-app')}
                  >
                    <span className="w-5 text-right text-[11px] tabular-nums opacity-60">{i + 1}</span>
                    {c.title}
                  </Link>
                ))}
          </nav>
        </aside>
        <main ref={content} className="min-w-0 flex-1 overflow-y-auto" onClick={onClick}>
          <div className="mx-auto flex max-w-5xl gap-10 px-10 py-10">
            <article className="min-w-0 flex-1">
              <div className="mb-1 text-xs font-medium text-brand-600">{t('Capítulo {0}', [idx + 1])}</div>
              <h1 className="mb-6 text-3xl font-bold tracking-tight">{chapter.title}</h1>
              <div className="prose-docs prose-manual" dangerouslySetInnerHTML={{ __html: chapter.html }} />
              <div className="mt-12 flex justify-between border-t border-app pt-5">
                {idx > 0 ? (
                  <Link to={`/ayuda/${CHAPTERS[idx - 1].slug}`} className="group flex items-center gap-2 text-muted hover:text-app">
                    <ChevronLeft className="size-4" />
                    <span>
                      <span className="block text-[11px]">{t("Anterior")}</span>
                      <span className="font-medium text-app group-hover:text-brand-600">{CHAPTERS[idx - 1].title}</span>
                    </span>
                  </Link>
                ) : (
                  <span />
                )}
                {idx < CHAPTERS.length - 1 && (
                  <Link to={`/ayuda/${CHAPTERS[idx + 1].slug}`} className="group flex items-center gap-2 text-right text-muted hover:text-app">
                    <span>
                      <span className="block text-[11px]">{t("Siguiente")}</span>
                      <span className="font-medium text-app group-hover:text-brand-600">{CHAPTERS[idx + 1].title}</span>
                    </span>
                    <ChevronRight className="size-4" />
                  </Link>
                )}
              </div>
            </article>
            {chapter.headings.length > 1 && (
              <nav className="sticky top-10 hidden w-48 shrink-0 self-start xl:block">
                <div className="mb-2 text-[11px] font-semibold text-muted uppercase">{t("En esta página")}</div>
                {chapter.headings.map((h) => (
                  <a key={h.id} href={`#${h.id}`} className="block py-1 text-xs text-muted hover:text-app">
                    {h.text}
                  </a>
                ))}
              </nav>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
