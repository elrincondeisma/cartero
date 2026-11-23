/**
 * Convierte el manual (docs/manual, la misma fuente que usa la app en /ayuda y GitHub) en páginas de
 * Starlight: /docs/<capítulo>/ en inglés y /es/docs/<capítulo>/ en español.
 *
 * - El slug sale del nombre en inglés y se comparte entre idiomas (por número de capítulo), así el
 *   selector de idioma de Starlight lleva a la misma página.
 * - El primer `# Título` pasa al frontmatter y la línea «🌐 English · Español» desaparece.
 * - Los enlaces entre capítulos (`02-requests.md#x`, `es/21-actualizar.md`) se reescriben a rutas de la
 *   web; los enlaces a ficheros del repositorio van a GitHub.
 *
 * Se lanza antes de `astro dev` y `astro build`. La salida (src/content/docs) no se versiona.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GROUPS } from './docs-groups.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '../../..')
const MANUAL = join(ROOT, 'docs/manual')
const OUT = resolve(here, '../src/content/docs')
const REPO = 'https://github.com/elrincondeisma/cartero/blob/main'

const LOCALES = {
  en: { dir: MANUAL, out: join(OUT, 'docs'), prefix: '/docs' },
  es: { dir: join(MANUAL, 'es'), out: join(OUT, 'es/docs'), prefix: '/es/docs' },
}

const chapters = (dir) =>
  readdirSync(dir)
    .filter((f) => /^\d\d-.+\.md$/.test(f))
    .sort()

/** Número de capítulo → slug (del nombre en inglés). */
const slugs = Object.fromEntries(chapters(MANUAL).map((f) => [f.slice(0, 2), f.slice(3, -3)]))

/** Texto plano de un trozo de Markdown, para la descripción. */
const plain = (md) =>
  md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const yaml = (s) => JSON.stringify(s)

function rewriteLinks(md, { lang, sourceFile }) {
  return md.replace(/\]\(([^)\s]+)\)/g, (all, target) => {
    if (/^(https?:|mailto:|#)/.test(target)) return all
    const [path, hash = ''] = target.split('#')
    const anchor = hash ? `#${hash}` : ''
    // Otro capítulo (en el mismo idioma o en el otro)
    const ch = /(?:^|\/)(es\/)?(\d\d)-[^/]*\.md$/.exec(path)
    if (ch && slugs[ch[2]]) {
      const target = ch[1] ? 'es' : path.startsWith('../') && lang === 'es' ? 'en' : lang
      return `](${LOCALES[target].prefix}/${slugs[ch[2]]}/${anchor})`
    }
    if (/(^|\/)README\.md$/.test(path) && !path.includes('deploy/')) {
      const target = path.startsWith('../') && lang === 'es' ? 'en' : path.startsWith('es/') ? 'es' : lang
      return `](${LOCALES[target].prefix}/${anchor})`
    }
    // Cualquier otro fichero del repositorio: a GitHub
    const abs = resolve(dirname(sourceFile), path)
    const rel = relative(ROOT, abs).split('\\').join(posix.sep)
    if (!rel.startsWith('..') && existsSync(abs)) return `](${REPO}/${rel}${anchor})`
    return all
  })
}

function convert(file, lang) {
  const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const lines = src.split('\n')
  if (lines[0]?.startsWith('> 🌐')) lines.shift()
  let body = lines.join('\n').trimStart()
  const h1 = /^# (.+)\n/.exec(body)
  const title = h1 ? h1[1].trim() : ''
  if (h1) body = body.slice(h1[0].length).trimStart()
  const firstPara = body.split(/\n\s*\n/).find((p) => p.trim() && !/^(#|```|\||-|\d+\.|>)/.test(p.trim()))
  let description = firstPara ? plain(firstPara) : ''
  if (description.length > 160) description = `${description.slice(0, 157).replace(/\s+\S*$/, '')}…`
  body = rewriteLinks(body, { lang, sourceFile: file })
  const front = ['---', `title: ${yaml(title)}`]
  if (description) front.push(`description: ${yaml(description)}`)
  front.push(`editUrl: ${yaml(`${REPO.replace('/blob/', '/edit/')}/${relative(ROOT, file).split('\\').join(posix.sep)}`)}`)
  front.push('---', '')
  return front.join('\n') + body
}


function index(lang, titles) {
  const t =
    lang === 'es'
      ? {
          title: 'Manual de Cartero',
          description: 'Todo lo que puedes hacer con Cartero, el cliente de APIs open source y autoalojado.',
          intro:
            'Todo lo que puedes hacer con Cartero, de la primera petición a desplegarlo en tu servidor o en AWS. El mismo manual está dentro de la app, en **Ayuda**.',
        }
      : {
          title: 'Cartero user guide',
          description: 'Everything you can do with Cartero, the open-source, self-hosted API client.',
          intro:
            'Everything you can do with Cartero, from your first request to running it on your own server or on AWS. The same guide is inside the app, under **Help**.',
        }
  const parts = ['---', `title: ${yaml(t.title)}`, `description: ${yaml(t.description)}`, '---', '', t.intro, '']
  for (const g of GROUPS) {
    parts.push(`## ${g[lang]}`, '')
    for (const n of g.items) parts.push(`- [${titles[n]}](${LOCALES[lang].prefix}/${slugs[n]}/)`)
    parts.push('')
  }
  return parts.join('\n')
}

rmSync(OUT, { recursive: true, force: true })
let count = 0
for (const [lang, l] of Object.entries(LOCALES)) {
  mkdirSync(l.out, { recursive: true })
  const titles = {}
  for (const f of chapters(l.dir)) {
    const n = f.slice(0, 2)
    if (!slugs[n]) throw new Error(`${lang}/${f}: no hay capítulo ${n} en inglés`)
    const md = convert(join(l.dir, f), lang)
    titles[n] = /^title: (.+)$/m.exec(md)[1].replace(/^"|"$/g, '')
    writeFileSync(join(l.out, `${slugs[n]}.md`), md)
    count++
  }
  const missing = Object.keys(slugs).filter((n) => !titles[n])
  if (missing.length) throw new Error(`${lang}: faltan los capítulos ${missing.join(', ')}`)
  const grouped = GROUPS.flatMap((g) => g.items)
  const ungrouped = Object.keys(slugs).filter((n) => !grouped.includes(n))
  if (ungrouped.length) throw new Error(`Capítulos sin grupo en GROUPS: ${ungrouped.join(', ')}`)
  writeFileSync(join(l.out, 'index.md'), index(lang, titles))
}
console.log(`Manual: ${count} capítulos en src/content/docs`)
