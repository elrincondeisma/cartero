import type { Event } from '@cartero/core'
import type * as monaco from 'monaco-editor'
import { useRef, useState } from 'react'
import { CodeEditor } from '@/components/CodeEditor'
import { cx } from '@/components/ui'
import { t, tj } from "@/i18n";

const SNIPPETS: Record<'prerequest' | 'test', { label: string; code: string }[]> = {
  prerequest: [
    { label: t("Leer una variable de entorno"), code: 'const value = pm.environment.get("variable");\n' },
    { label: t("Guardar una variable de entorno"), code: `pm.environment.set("variable", "${t('valor')}");\n` },
    { label: t("Guardar una variable de colección"), code: `pm.collectionVariables.set("variable", "${t('valor')}");\n` },
    { label: t("Añadir una cabecera"), code: 'pm.request.headers.upsert({ key: "X-Request-Id", value: pm.variables.replaceIn("{{$guid}}") });\n' },
    { label: t("Timestamp actual"), code: 'pm.variables.set("timestamp", Date.now());\n' },
    {
      label: t("Petición previa (login)"),
      code: `pm.sendRequest({
  url: pm.environment.get("baseUrl") + "/login",
  method: "POST",
  header: { "Content-Type": "application/json" },
  body: { mode: "raw", raw: JSON.stringify({ user: "demo", password: "demo" }) }
}, (err, res) => {
  if (!err) pm.environment.set("token", res.json().token);
});
`,
    },
    { label: t("Saltar esta petición"), code: 'pm.execution.skipRequest();\n' },
  ],
  test: [
    { label: t("Código de estado 200"), code: `pm.test("${t('Código de estado 200')}", () => {\n  pm.response.to.have.status(200);\n});\n` },
    { label: t("Tiempo de respuesta < 500 ms"), code: `pm.test("${t('Responde en menos de 500 ms')}", () => {\n  pm.expect(pm.response.responseTime).to.be.below(500);\n});\n` },
    { label: t("El body contiene un texto"), code: `pm.test("${t('El body contiene el texto')}", () => {\n  pm.expect(pm.response.text()).to.include("${t('texto')}");\n});\n` },
    { label: t("Comprobar un valor JSON"), code: `pm.test("${t('Valor JSON')}", () => {\n  const json = pm.response.json();\n  pm.expect(json.id).to.eql(1);\n});\n` },
    { label: t("Existe la cabecera Content-Type"), code: `pm.test("${t('Tiene Content-Type')}", () => {\n  pm.response.to.have.header("Content-Type");\n});\n` },
    {
      label: t("Validar con JSON Schema"),
      code: `const schema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "number" } }
};
pm.test("${t('Cumple el schema')}", () => {
  pm.response.to.have.jsonSchema(schema);
});
`,
    },
    { label: t("Guardar un valor de la respuesta"), code: 'pm.environment.set("token", pm.response.json().token);\n' },
    { label: t("Siguiente petición"), code: `pm.execution.setNextRequest("${t('Nombre de la petición')}");\n` },
  ],
}

function getExec(events: Event[] | undefined, listen: string): string {
  const ev = events?.find((e) => e.listen === listen)
  const exec = ev?.script?.exec
  return Array.isArray(exec) ? exec.join('\n') : (exec ?? '')
}

export function setExec(events: Event[] | undefined, listen: 'prerequest' | 'test', code: string): Event[] | undefined {
  const list = [...(events ?? [])]
  const i = list.findIndex((e) => e.listen === listen)
  const ev: Event = { listen, script: { ...(i >= 0 ? list[i].script : {}), type: 'text/javascript', exec: code.split('\n') } }
  if (i >= 0) list[i] = ev
  else list.push(ev)
  const cleaned = list.filter((e) => getExec([e], e.listen).trim() !== '' || e.listen !== listen)
  return cleaned.length ? cleaned : undefined
}

export function scriptCount(events: Event[] | undefined) {
  return ['prerequest', 'test'].filter((l) => getExec(events, l).trim()).length
}

export function ScriptsEditor({ events, onChange, readOnly }: { events?: Event[]; onChange: (e: Event[] | undefined) => void; readOnly?: boolean }) {
  const [which, setWhich] = useState<'prerequest' | 'test'>('prerequest')
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const code = getExec(events, which)

  const insert = (snippet: string) => {
    const ed = editor.current
    if (!ed) return onChange(setExec(events, which, code + (code && !code.endsWith('\n') ? '\n' : '') + snippet))
    const sel = ed.getSelection()!
    ed.executeEdits('snippet', [{ range: sel, text: snippet, forceMoveMarkers: true }])
    ed.focus()
  }

  return (
    <div className="flex h-full">
      <div className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-app p-2">
        {(['prerequest', 'test'] as const).map((l) => (
          <button
            key={l}
            onClick={() => setWhich(l)}
            className={cx('flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[12.5px]', which === l ? 'bg-muted font-medium' : 'text-muted hover:bg-muted/60')}
          >
            {l === 'prerequest' ? t("Pre-request") : t("Post-response")}
            {getExec(events, l).trim() && <span className="size-1.5 rounded-full bg-brand-500" />}
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <CodeEditor
          key={which}
          value={code}
          onChange={(v) => onChange(setExec(events, which, v))}
          language="javascript"
          readOnly={readOnly}
          onMount={(ed) => {
            editor.current = ed
          }}
        />
      </div>
      {!readOnly && (
        <div className="w-56 shrink-0 overflow-y-auto border-l border-app p-2">
          <div className="px-1 pb-1.5 text-[11px] font-semibold text-muted uppercase">{t("Fragmentos")}</div>
          {SNIPPETS[which].map((s) => (
            <button key={s.label} onClick={() => insert(s.code)} className="block w-full rounded px-1.5 py-1 text-left text-xs text-brand-700 hover:bg-muted dark:text-brand-400">
              {s.label}
            </button>
          ))}
          <p className="mt-3 px-1 text-[11px] leading-relaxed text-muted">
            {tj('API compatible con Postman: {api}… Autocompletado con Ctrl+Espacio.', { api: <><code>pm.test</code>, <code>pm.expect</code>, <code>pm.environment</code>, <code>pm.sendRequest</code></> })}</p>
        </div>
      )}
    </div>
  )
}
