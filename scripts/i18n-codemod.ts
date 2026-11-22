/**
 * Envuelve en t() los textos de interfaz en español de apps/web/src.
 *   npx tsx scripts/i18n-codemod.ts          (aplica)
 *   npx tsx scripts/i18n-codemod.ts --dry    (solo informa)
 * Es idempotente: no vuelve a envolver lo que ya está dentro de t().
 */
import { Node, Project, SyntaxKind, type SourceFile, type StringLiteral, type NoSubstitutionTemplateLiteral, type TemplateExpression } from 'ts-morph'

const DRY = process.argv.includes('--dry')
const project = new Project({ tsConfigFilePath: 'apps/web/tsconfig.json', skipAddingFilesFromTsConfig: true })
project.addSourceFilesAtPaths(['apps/web/src/**/*.tsx', 'apps/web/src/features/**/*.ts', 'apps/web/src/components/**/*.ts'])

const SKIP_FILES = [/\/i18n\//, /pm-types\.ts$/]
const UI_ATTRS = new Set(['title', 'placeholder', 'label', 'description', 'alt', 'aria-label', 'content', 'hint', 'header', 'confirm', 'text', 'intro', 'outro'])
const UI_PROPS = new Set(['label', 'title', 'text', 'body', 'description', 'hint', 'header', 'intro', 'outro', 'confirm', 'message', 'placeholder', 'value', 'name', 'q', 'a', 'summary'])
const UI_CALLS = /^(toast(\.\w+)?|confirm|prompt|t)$/
const CLASS_CALLS = new Set(['cx', 'clsx'])

const SPANISH = /[áéíóúñü¿¡«»]/i

/** Cosas que nunca se traducen: HTML, cabeceras, código, rutas… */
const TECHNICAL = [/<\/?[a-z]+[\s>{]/i, /="/, /^x-[a-z-]+/, /^pm\.\w+/, /^:[a-z]+$/, /^curl\b/, /^cartero run$/, /^Authorization: /, /^\/[\w/-]*\/?$/, /^Enter$/]
const isTechnical = (s: string) => TECHNICAL.some((r) => r.test(s.trim()))

/** ¿Parece texto para personas? */
function isNL(raw: string, strict = false): boolean {
  const s = raw.trim()
  if (isTechnical(s)) return false
  if (s.length < 2 || !/[a-záéíóúñ]/i.test(s)) return false
  if (s.startsWith('/') || s.startsWith('#') || s.startsWith('.') || s.startsWith('@')) return false
  if (/:\/\//.test(s) && !/\s/.test(s)) return false
  if (/^[A-Z0-9_\-]+$/.test(s)) return false // GET, POST, IDs
  if (/^[a-z0-9_.\-:/@#*\[\]=$]+$/.test(s)) return false // identificadores, claves
  if (/^\{\{.*\}\}$/.test(s)) return false
  // Clases CSS
  if (s.split(/\s+/).every((tok) => /^[a-z0-9\-:\[\]/.%&>_@()!]+$/.test(tok)) && /[-:]/.test(s)) return false
  if (strict) return SPANISH.test(s) || /\s/.test(s)
  return SPANISH.test(s) || /\s[a-záéíóúñ]/.test(s) || /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(s)
}

function insideT(node: Node): boolean {
  const call = node.getParentIfKind(SyntaxKind.CallExpression)
  return !!call && call.getExpression().getText() === 't'
}

/** Atributo JSX que contiene el nodo, solo si no hay un elemento JSX en medio (si lo hay, es contenido). */
function attrName(node: Node): string | undefined {
  for (const a of node.getAncestors()) {
    if (Node.isJsxAttribute(a)) return a.getNameNode().getText()
    if (Node.isJsxElement(a) || Node.isJsxSelfClosingElement(a) || Node.isJsxFragment(a)) return undefined
  }
  return undefined
}

/** Sube por condicionales/paréntesis/|| hasta el contexto real. */
function context(node: Node): Node | undefined {
  let p = node.getParent()
  while (
    p &&
    (Node.isConditionalExpression(p) ||
      Node.isParenthesizedExpression(p) ||
      (Node.isBinaryExpression(p) && ['||', '??', '&&'].includes(p.getOperatorToken().getText())))
  )
    p = p.getParent()
  return p
}

const insideTj = (node: Node) => node.getAncestors().some((a) => Node.isCallExpression(a) && a.getExpression().getText() === 'tj')

function shouldWrap(node: StringLiteral | NoSubstitutionTemplateLiteral | TemplateExpression, text: string): boolean {
  if (insideT(node) || insideTj(node)) return false
  const ctx = context(node)
  if (!ctx) return false
  if (Node.isImportDeclaration(ctx) || Node.isExportDeclaration(ctx) || Node.isLiteralTypeNode(ctx) || Node.isCaseClause(ctx)) return false
  if (Node.isBinaryExpression(ctx)) return false // comparaciones
  if (Node.isElementAccessExpression(ctx)) return false
  if (Node.isJsxAttribute(ctx)) return UI_ATTRS.has(ctx.getNameNode().getText()) && isNL(text)
  if (Node.isJsxExpression(ctx)) {
    const a = attrName(node)
    if (a) return UI_ATTRS.has(a) && isNL(text)
    return isNL(text)
  }
  if (Node.isPropertyAssignment(ctx)) {
    if (ctx.getNameNode() === node) return false
    const name = ctx.getName().replace(/['"]/g, '')
    return UI_PROPS.has(name) && isNL(text)
  }
  if (Node.isCallExpression(ctx) || Node.isNewExpression(ctx)) {
    const callee = ctx.getExpression().getText()
    if (CLASS_CALLS.has(callee)) return false
    if (Node.isNewExpression(ctx) && callee === 'Error') return isNL(text)
    return UI_CALLS.test(callee) && isNL(text)
  }
  if (Node.isArrayLiteralExpression(ctx)) return isNL(text, true)
  if (Node.isReturnStatement(ctx)) {
    // return 'texto' dentro de funciones de interfaz (timeAgo, dayLabel…)
    return isNL(text, true)
  }
  return false
}

const lit = (s: string) => JSON.stringify(s)

let total = 0
const changedFiles: string[] = []

// 0) Las variables locales llamadas «t» taparían la función t(): se renombran (respetando el ámbito)
let renamed = 0
for (const sf of project.getSourceFiles()) {
  if (SKIP_FILES.some((r) => r.test(sf.getFilePath()))) continue
  const decls = [
    ...sf.getDescendantsOfKind(SyntaxKind.Parameter),
    ...sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration),
    ...sf.getDescendantsOfKind(SyntaxKind.BindingElement),
  ]
  for (const d of decls) {
    const name = (d as any).getNameNode?.()
    if (name && Node.isIdentifier(name) && name.getText() === 't') {
      if (!DRY) name.rename('tItem')
      renamed++
    }
  }
}
console.log(`${renamed} variables «t» locales renombradas`)

for (const sf of project.getSourceFiles()) {
  const path = sf.getFilePath()
  if (SKIP_FILES.some((r) => r.test(path))) continue
  let count = 0

  // 1) Texto JSX
  for (const jt of sf.getDescendantsOfKind(SyntaxKind.JsxText).reverse()) {
    const raw = jt.getText()
    const trimmed = raw.replace(/\s+/g, ' ').trim()
    if (!trimmed || !/[a-záéíóúñ]/i.test(trimmed)) continue
    if (/^[A-Z0-9_\-+./]+$/.test(trimmed) || isTechnical(trimmed) || insideTj(jt)) continue
    const lead = raw.match(/^\s*/)![0].includes('\n') ? '' : raw.match(/^\s*/)![0] ? ' ' : ''
    const trail = raw.match(/\s*$/)![0].includes('\n') ? '' : raw.match(/\s*$/)![0] ? ' ' : ''
    // Conserva espacios significativos entre elementos
    const rep = `${lead ? "{' '}" : ''}{t(${lit(trimmed)})}${trail ? "{' '}" : ''}`
    if (!DRY) jt.replaceWithText(rep)
    count++
  }

  // 2) Literales de cadena y plantillas sin sustituciones
  const literals = [
    ...sf.getDescendantsOfKind(SyntaxKind.StringLiteral),
    ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
  ].reverse()
  for (const node of literals) {
    if (node.wasForgotten()) continue
    const text = node.getLiteralText()
    if (!shouldWrap(node as any, text)) continue
    const inAttr = Node.isJsxAttribute(node.getParent()!)
    const rep = inAttr ? `{t(${lit(text)})}` : `t(${lit(text)})`
    if (!DRY) node.replaceWithText(rep)
    count++
  }

  // 3) Plantillas con sustituciones → t('… {0} …', [a])
  for (const node of sf.getDescendantsOfKind(SyntaxKind.TemplateExpression).reverse()) {
    if (node.wasForgotten()) continue
    const parts: string[] = [node.getHead().getLiteralText()]
    const exprs: string[] = []
    node.getTemplateSpans().forEach((span, i) => {
      exprs.push(span.getExpression().getText())
      parts.push(`{${i}}${span.getLiteral().getLiteralText()}`)
    })
    const text = parts.join('')
    const plain = text.replace(/\{\d+\}/g, ' ')
    if (!shouldWrap(node, plain)) continue
    if (!isNL(plain)) continue
    if (!DRY) node.replaceWithText(`t(${lit(text)}, [${exprs.join(', ')}])`)
    count++
  }

  if (count) {
    total += count
    changedFiles.push(`${path.replace(/.*apps\/web\/src\//, '')}: ${count}`)
    if (!DRY && !sf.getImportDeclaration((d) => d.getModuleSpecifierValue() === '@/i18n')) {
      sf.addImportDeclaration({ moduleSpecifier: '@/i18n', namedImports: ['t'] })
    } else if (!DRY) {
      const imp = sf.getImportDeclaration((d) => d.getModuleSpecifierValue() === '@/i18n')!
      if (!imp.getNamedImports().some((n) => n.getName() === 't')) imp.addNamedImport('t')
    }
  }
}

// 4) Autolimpieza: t('técnico') → texto tal cual
let unwrapped = 0
for (const sf of project.getSourceFiles()) {
  if (SKIP_FILES.some((r) => r.test(sf.getFilePath()))) continue
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression).reverse()) {
    if (call.wasForgotten() || call.getExpression().getText() !== 't') continue
    const [arg, vars] = call.getArguments()
    if (!arg || !(Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))) continue
    const key = arg.getLiteralText()
    const plain = key.replace(/\{\d+\}/g, ' ')
    if (!isTechnical(key) && /[a-záéíóúñ]/i.test(plain) && !(/^\s*$/.test(plain.replace(/[^a-záéíóúñ]/gi, '')))) continue
    // Reconstruye el literal o la plantilla original
    let rep: string
    if (vars && Node.isArrayLiteralExpression(vars)) {
      const exprs = vars.getElements().map((e) => e.getText())
      rep = '`' + key.replace(/`/g, '\\`').replace(/\{(\d+)\}/g, (_m, i) => '${' + exprs[Number(i)] + '}') + '`'
    } else rep = JSON.stringify(key)
    const parent = call.getParent()
    const isChild = parent && Node.isJsxExpression(parent) && parent.getParent() && !Node.isJsxAttribute(parent.getParent()!)
    if (isChild && /^[\w .:\-+/…]+$/.test(key) && !vars) {
      if (!DRY) parent!.replaceWithText(key)
    } else if (!DRY) call.replaceWithText(rep)
    unwrapped++
  }
}
console.log(`${unwrapped} t() técnicos deshechos`)

console.log(changedFiles.join('\n'))
console.log(`${DRY ? '[dry] ' : ''}${total} textos en ${changedFiles.length} ficheros`)
if (!DRY) await project.save()
