import type { ResponseExample } from '@cartero/core'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { CodeEditor } from '@/components/CodeEditor'
import { KeyValueEditor, type KVRow } from '@/components/KeyValueEditor'
import { Badge, Button, Empty, Input, cx, statusTone } from '@/components/ui'
import { languageForContentType } from '@/lib/request'
import { t } from "@/i18n";

/** Respuestas de ejemplo guardadas: documentan la API y las usan los mock servers. */
export function ExamplesEditor({ examples, onChange, readOnly }: { examples: ResponseExample[]; onChange: (e: ResponseExample[]) => void; readOnly?: boolean }) {
  const [selected, setSelected] = useState(0)
  const ex = examples[selected]
  const updateEx = (patch: Partial<ResponseExample>) => onChange(examples.map((e, i) => (i === selected ? { ...e, ...patch } : e)))
  const add = () => {
    onChange([
      ...examples,
      { id: crypto.randomUUID(), name: t("Nuevo ejemplo"), code: 200, status: 'OK', header: [{ key: 'Content-Type', value: 'application/json' }], body: '{\n  \n}' },
    ])
    setSelected(examples.length)
  }

  if (!examples.length)
    return (
      <Empty
        title={t("Sin ejemplos")}
        action={
          !readOnly && (
            <Button icon={<Plus className="size-3.5" />} onClick={add}>
              {t("Añadir ejemplo")}</Button>
          )
        }
      >
        {t("Guarda una respuesta real con el botón de guardar del panel de respuesta, o crea una a mano. Los mock servers responden con estos ejemplos.")}</Empty>
    )

  const ct = ex?.header?.find((h) => h.key.toLowerCase() === 'content-type')?.value
  return (
    <div className="flex h-full">
      <div className="w-52 shrink-0 overflow-y-auto border-r border-app p-2">
        {examples.map((e, i) => (
          <button
            key={e.id ?? i}
            onClick={() => setSelected(i)}
            className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px]', i === selected ? 'bg-muted' : 'hover:bg-muted/60')}
          >
            <Badge tone={statusTone(e.code)} className="font-mono">
              {e.code ?? '—'}
            </Badge>
            <span className="truncate">{e.name}</span>
          </button>
        ))}
        {!readOnly && (
          <button onClick={add} className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-brand-700 hover:bg-muted dark:text-brand-400">
            <Plus className="size-3.5" /> {t("Añadir ejemplo")}</button>
        )}
      </div>
      {ex && (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-app p-2">
            <Input value={ex.name} onChange={(e) => updateEx({ name: e.target.value })} className="flex-1" readOnly={readOnly} />
            <Input
              value={String(ex.code ?? '')}
              onChange={(e) => updateEx({ code: Number(e.target.value) || undefined })}
              className="w-20 font-mono"
              placeholder="200"
              readOnly={readOnly}
            />
            <Input value={ex.status ?? ''} onChange={(e) => updateEx({ status: e.target.value })} className="w-36" placeholder="OK" readOnly={readOnly} />
            {!readOnly && (
              <Button
                variant="ghost"
                icon={<Trash2 className="size-3.5" />}
                onClick={() => {
                  onChange(examples.filter((_, i) => i !== selected))
                  setSelected(Math.max(0, selected - 1))
                }}
              />
            )}
          </div>
          <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr]">
            <div className="max-h-48 overflow-auto p-2">
              <KeyValueEditor rows={(ex.header ?? []) as KVRow[]} onChange={(rows) => updateEx({ header: rows })} showDescription={false} readOnly={readOnly} keyPlaceholder="Cabecera" />
            </div>
            <div className="min-h-0 border-t border-app">
              <CodeEditor value={ex.body ?? ''} onChange={(body) => updateEx({ body })} language={languageForContentType(ct)} readOnly={readOnly} path={`example-${ex.id}`} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
