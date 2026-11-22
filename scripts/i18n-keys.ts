/**
 * Lista las claves de t('…') de apps/web/src y comprueba que todas tienen traducción en en.ts.
 *   npx tsx scripts/i18n-keys.ts            → claves sin traducir (sale con 1 si falta alguna)
 *   npx tsx scripts/i18n-keys.ts --all      → todas las claves
 */
import { Node, Project, SyntaxKind } from 'ts-morph'
import { en } from '../apps/web/src/i18n/en.ts'

const project = new Project({ skipAddingFilesFromTsConfig: true })
project.addSourceFilesAtPaths(['apps/web/src/**/*.tsx', 'apps/web/src/**/*.ts', '!apps/web/src/i18n/**'])
const keys = new Map<string, string>()
for (const sf of project.getSourceFiles()) {
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText()
    if (callee !== 't' && callee !== 'tServer') continue
    const arg = call.getArguments()[0]
    if (arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))) {
      if (!keys.has(arg.getLiteralText())) keys.set(arg.getLiteralText(), sf.getBaseName())
    }
  }
}
// Claves que no necesitan traducción (iguales en ambos idiomas)
const SAME = /^(\{\d+\}\s*)+$|^(Cartero|JSON|cURL|URL|Body|Params|Runner|Scripts|Mock servers|Tests|Raw|Pre-request|Post-response|OAuth 1\.0|OAuth 2\.0|Basic Auth|Bearer Token|API Key|JWT Bearer|Digest Auth|Hawk|AWS Signature|NTLM|Akamai EdgeGrid|Ctrl|GraphQL|Slack|Discord|Telegram|Email|Webhook \(JSON\)|Client ID|Client Secret|Scope|State|Access Token URL|Auth URL|Callback URL|Realm|Nonce|Opaque|qop|ext|app|Consumer key|Consumer secret|Access token|Token secret|Hawk Auth ID|Hawk Auth Key|Workstation|Session token|Access key|Secret key|Client token|Base URL|Timestamp|Token|Cookies|OK|MCP|Claude Code|Claude Desktop|Cursor|Monitor|App|Workspace|Fork…|Merge)$/
const all = [...keys.entries()]
if (process.argv.includes('--all')) {
  for (const [k, f] of all) console.log(`${f}\t${k}`)
  process.exit(0)
}
const missing = all.filter(([k]) => !en[k] && !SAME.test(k))
for (const [k, f] of missing) console.log(`${f}\t${k}`)
console.log(`\n${all.length} claves, ${missing.length} sin traducir`)
process.exit(missing.length ? 1 : 0)
