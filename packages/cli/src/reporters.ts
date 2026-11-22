import type { Execution, RunEvent, RunResult } from '@cartero/executor'
import pc from 'picocolors'

const methodColor: Record<string, (s: string) => string> = {
  GET: pc.green,
  POST: pc.yellow,
  PUT: pc.blue,
  PATCH: pc.magenta,
  DELETE: pc.red,
}

function ms(n: number) {
  return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(2)}s`
}

/** Reporter de consola en vivo, al estilo de Newman. */
export function cliReporter(collectionName: string) {
  let lastIteration = -1
  return (e: RunEvent) => {
    if (e.type === 'start') {
      console.log(`\n${pc.bold('cartero')} ${pc.dim('·')} ${pc.bold(collectionName)}\n`)
    } else if (e.type === 'execution') {
      const x = e.execution
      if (x.iteration !== lastIteration && x.iteration > 0) console.log(pc.dim(`\nIteración ${x.iteration + 1}`))
      lastIteration = x.iteration
      const method = x.request?.method ?? 'GET'
      const status = x.error
        ? pc.red(`✗ ${x.error}`)
        : x.response
          ? `${x.response.code < 400 ? pc.green(String(x.response.code)) : pc.red(String(x.response.code))} ${pc.dim(`${x.response.status}, ${ms(x.response.time)}`)}`
          : ''
      console.log(`${pc.dim('→')} ${x.name}`)
      console.log(`  ${(methodColor[method] ?? pc.cyan)(method)} ${pc.dim(x.request?.url ?? '')} ${status}`)
      if (x.prerequestError) console.log(`  ${pc.yellow('⚠')} pre-request: ${x.prerequestError}`)
      if (x.testScriptError) console.log(`  ${pc.yellow('⚠')} post-response: ${x.testScriptError}`)
      for (const t of x.tests) {
        if (t.skipped) console.log(`  ${pc.dim('-')} ${pc.dim(t.name)}`)
        else if (t.passed) console.log(`  ${pc.green('✓')} ${t.name}`)
        else console.log(`  ${pc.red('✗')} ${t.name}${t.error ? pc.dim(` — ${t.error}`) : ''}`)
      }
    } else if (e.type === 'console') {
      const msg = e.entry.messages.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join(' ')
      console.log(`  ${pc.dim('│')} ${pc.dim(msg)}`)
    } else if (e.type === 'done') {
      summary(e.result)
    }
  }
}

export function summary(r: RunResult) {
  const s = r.stats
  const row = (label: string, total: number, failed: number) =>
    `│ ${label.padEnd(18)} │ ${String(total).padStart(9)} │ ${(failed ? pc.red : (x: string) => x)(String(failed).padStart(9))} │`
  console.log(`
┌────────────────────┬───────────┬───────────┐
│                    │  ejecutad │   fallidos│
├────────────────────┼───────────┼───────────┤
${row('iteraciones', s.iterations, 0)}
${row('peticiones', s.requests, s.failedRequests)}
${row('tests', s.assertions, s.failedAssertions)}
├────────────────────┴───────────┴───────────┤
│ duración total: ${ms(s.totalTime).padEnd(27)}│
└────────────────────────────────────────────┘`)
  if (r.error) console.log(pc.red(`\nError: ${r.error}`))
  const failures = r.executions.flatMap((x) => [
    ...(x.error ? [{ x, msg: x.error }] : []),
    ...x.tests.filter((t) => !t.passed && !t.skipped).map((t) => ({ x, msg: `${t.name}: ${t.error ?? 'falló'}` })),
  ])
  if (failures.length) {
    console.log(pc.red(pc.bold(`\n${failures.length} fallo(s):`)))
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${pc.bold(f.x.name)} ${pc.dim(`(iteración ${f.x.iteration + 1})`)}\n     ${f.msg}`))
  }
}

function xml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)
}

/** Informe JUnit XML (lo entienden GitHub Actions, GitLab, Jenkins…). */
export function junitReport(collectionName: string, r: RunResult): string {
  const cases = r.executions.map((x) => caseXml(x)).join('\n')
  const tests = r.executions.reduce((n, x) => n + Math.max(1, x.tests.length), 0)
  const failures = r.executions.reduce((n, x) => n + x.tests.filter((t) => !t.passed && !t.skipped).length, 0)
  const errors = r.executions.filter((x) => x.error).length
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="${xml(collectionName)}" tests="${tests}" failures="${failures}" errors="${errors}" time="${(r.stats.totalTime / 1000).toFixed(3)}">
  <testsuite name="${xml(collectionName)}" tests="${tests}" failures="${failures}" errors="${errors}" timestamp="${r.startedAt}" time="${(r.stats.totalTime / 1000).toFixed(3)}">
${cases}
  </testsuite>
</testsuites>
`
}

function caseXml(x: Execution) {
  const time = ((x.response?.time ?? 0) / 1000).toFixed(3)
  const cls = xml(`${x.name}${x.iteration ? ` [${x.iteration + 1}]` : ''}`)
  if (x.error) return `    <testcase classname="${cls}" name="${xml(x.request?.url ?? x.name)}" time="${time}"><error message="${xml(x.error)}"/></testcase>`
  if (!x.tests.length) return `    <testcase classname="${cls}" name="${xml(`${x.request?.method} ${x.response?.code ?? ''}`)}" time="${time}"/>`
  return x.tests
    .map((t) => {
      const inner = t.skipped ? '<skipped/>' : t.passed ? '' : `<failure message="${xml(t.error ?? 'falló')}"/>`
      return `    <testcase classname="${cls}" name="${xml(t.name)}" time="${time}">${inner}</testcase>`
    })
    .join('\n')
}

/** Informe HTML autocontenido. */
export function htmlReport(collectionName: string, r: RunResult): string {
  const s = r.stats
  const rows = r.executions
    .map((x) => {
      const failed = x.error || x.tests.some((t) => !t.passed && !t.skipped)
      const tests = x.tests
        .map((t) => `<li class="${t.passed ? 'ok' : t.skipped ? 'skip' : 'ko'}">${t.passed ? '✓' : t.skipped ? '–' : '✗'} ${xml(t.name)}${t.error ? ` <small>${xml(t.error)}</small>` : ''}</li>`)
        .join('')
      return `<details class="${failed ? 'ko' : 'ok'}"><summary><b class="m">${xml(x.request?.method ?? '')}</b> ${xml(x.name)} <span class="u">${xml(x.request?.url ?? '')}</span>
<span class="st">${x.error ? 'ERROR' : (x.response?.code ?? '')}</span><span class="t">${Math.round(x.response?.time ?? 0)} ms</span></summary>
${x.error ? `<p class="err">${xml(x.error)}</p>` : ''}<ul>${tests || '<li class="skip">Sin tests</li>'}</ul>
${x.response?.body ? `<pre>${xml(x.response.body.slice(0, 20000))}</pre>` : ''}</details>`
    })
    .join('\n')
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${xml(collectionName)} · Informe de Cartero</title>
<style>
body{font:14px system-ui,sans-serif;margin:0;background:#f7f7f8;color:#18181b}header{background:#fff;border-bottom:1px solid #e4e4e7;padding:20px 32px}
h1{margin:0 0 4px;font-size:20px}.stats{display:flex;gap:28px;margin-top:14px}.stats div{font-size:12px;color:#71717a}.stats b{display:block;font-size:20px;color:#18181b}
main{padding:24px 32px;max-width:1100px}details{background:#fff;border:1px solid #e4e4e7;border-left:4px solid #16a34a;border-radius:8px;margin-bottom:8px;padding:10px 14px}
details.ko{border-left-color:#dc2626}summary{cursor:pointer;display:flex;gap:10px;align-items:center}.m{font-family:monospace;width:60px}.u{color:#71717a;font-family:monospace;font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st{font-family:monospace}.t{color:#71717a;width:70px;text-align:right}ul{list-style:none;padding:0;margin:10px 0}li{padding:2px 0}li.ok{color:#16a34a}li.ko{color:#dc2626}li.skip{color:#71717a}
small{color:#71717a}pre{background:#f4f4f5;padding:10px;border-radius:6px;overflow:auto;max-height:300px;font-size:12px}.err{color:#dc2626;font-family:monospace}.bad{color:#dc2626}
</style></head><body><header><h1>${xml(collectionName)}</h1><div style="color:#71717a">${new Date(r.startedAt).toLocaleString()} · Generado por Cartero</div>
<div class="stats"><div>Iteraciones<b>${s.iterations}</b></div><div>Peticiones<b>${s.requests}</b></div><div>Peticiones fallidas<b class="${s.failedRequests ? 'bad' : ''}">${s.failedRequests}</b></div>
<div>Tests<b>${s.assertions}</b></div><div>Tests fallidos<b class="${s.failedAssertions ? 'bad' : ''}">${s.failedAssertions}</b></div><div>Duración<b>${ms(s.totalTime)}</b></div></div></header>
<main>${r.error ? `<p class="err">${xml(r.error)}</p>` : ''}${rows}</main></body></html>`
}
