import type { Event } from '@cartero/core'
import type * as monaco from 'monaco-editor'
import { useRef, useState } from 'react'
import { CodeEditor } from '@/components/CodeEditor'
import { cx } from '@/components/ui'

const SNIPPETS: Record<'prerequest' | 'test', { label: string; code: string }[]> = {
  prerequest: [
    { label: 'Leer una variable de entorno', code: 'const value = pm.environment.get("variable");\n' },
    { label: 'Guardar una variable de entorno', code: 'pm.environment.set("variable", "valor");\n' },
    { label: 'Guardar una variable de colección', code: 'pm.collectionVariables.set("variable", "valor");\n' },
    { label: 'Añadir una cabecera', code: 'pm.request.headers.upsert({ key: "X-Request-Id", value: pm.variables.replaceIn("{{$guid}}") });\n' },
    { label: 'Timestamp actual', code: 'pm.variables.set("timestamp", Date.now());\n' },
    {
      label: 'Petición previa (login)',
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
    { label: 'Saltar esta petición', code: 'pm.execution.skipRequest();\n' },
  ],
  test: [
    { label: 'Código de estado 200', code: 'pm.test("Código de estado 200", () => {\n  pm.response.to.have.status(200);\n});\n' },
    { label: 'Tiempo de respuesta < 500 ms', code: 'pm.test("Responde en menos de 500 ms", () => {\n  pm.expect(pm.response.responseTime).to.be.below(500);\n});\n' },
    { label: 'El body contiene un texto', code: 'pm.test("El body contiene el texto", () => {\n  pm.expect(pm.response.text()).to.include("texto");\n});\n' },
    { label: 'Comprobar un valor JSON', code: 'pm.test("Valor JSON", () => {\n  const json = pm.response.json();\n  pm.expect(json.id).to.eql(1);\n});\n' },
    { label: 'Existe la cabecera Content-Type', code: 'pm.test("Tiene Content-Type", () => {\n  pm.response.to.have.header("Content-Type");\n});\n' },
    {
      label: 'Validar con JSON Schema',
      code: `const schema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "number" } }
};
pm.test("Cumple el schema", () => {
  pm.response.to.have.jsonSchema(schema);
});
`,
    },
    { label: 'Guardar un valor de la respuesta', code: 'pm.environment.set("token", pm.response.json().token);\n' },
    { label: 'Siguiente petición', code: 'pm.execution.setNextRequest("Nombre de la petición");\n' },
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
            {l === 'prerequest' ? 'Pre-request' : 'Post-response'}
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
          <div className="px-1 pb-1.5 text-[11px] font-semibold text-muted uppercase">Fragmentos</div>
          {SNIPPETS[which].map((s) => (
            <button key={s.label} onClick={() => insert(s.code)} className="block w-full rounded px-1.5 py-1 text-left text-xs text-brand-700 hover:bg-muted dark:text-brand-400">
              {s.label}
            </button>
          ))}
          <p className="mt-3 px-1 text-[11px] leading-relaxed text-muted">
            API compatible con Postman: <code>pm.test</code>, <code>pm.expect</code>, <code>pm.environment</code>, <code>pm.sendRequest</code>… Autocompletado con Ctrl+Espacio.
          </p>
        </div>
      )}
    </div>
  )
}
