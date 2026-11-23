import type { ContractParam } from '@cartero/core'
import { mainType, withType } from '@cartero/contracts'
import { Plus, Trash2 } from 'lucide-react'
import { Checkbox, IconButton, Input } from '@/components/ui'
import { t } from '@/i18n'
import { TypeSelect } from './SchemaEditor'

/** Tabla de parámetros del contrato (ruta, query o cabeceras): nombre, tipo, obligatorio y descripción. */
export function ParamsTable({
  rows,
  onChange,
  readOnly,
  fixedRequired,
  addLabel,
}: {
  rows: ContractParam[]
  onChange: (rows: ContractParam[]) => void
  readOnly?: boolean
  /** Los parámetros de ruta siempre son obligatorios */
  fixedRequired?: boolean
  addLabel: string
}) {
  const set = (i: number, patch: Partial<ContractParam>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="rounded-md border border-app">
      {rows.map((p, i) => {
        const { type } = mainType(p.schema)
        return (
          <div key={i} className="group flex items-center gap-1.5 border-b border-app/60 px-2 py-1 last:border-b-0 hover:bg-soft">
            <div className="w-44 shrink-0">
              <Input
                value={p.name}
                readOnly={readOnly}
                onChange={(e) => set(i, { name: e.target.value })}
                placeholder={t('Nombre')}
                className="h-7 font-mono text-xs"
              />
            </div>
            <TypeSelect value={type ?? 'string'} onChange={(v) => set(i, { schema: withType(p.schema ?? {}, v, false) })} />
            <Checkbox
              checked={fixedRequired || !!p.required}
              onChange={(v) => !readOnly && !fixedRequired && set(i, { required: v })}
              label={<span className="text-xs">{t('Obligatorio')}</span>}
            />
            <Input
              value={p.description ?? ''}
              readOnly={readOnly}
              onChange={(e) => set(i, { description: e.target.value || undefined })}
              placeholder={t('Descripción')}
              className="h-7 min-w-0 flex-1 text-xs"
            />
            {!readOnly && (
              <IconButton label={t('Quitar')} onClick={() => onChange(rows.filter((_, j) => j !== i))} className="opacity-0 group-hover:opacity-100">
                <Trash2 className="size-3.5" />
              </IconButton>
            )}
          </div>
        )
      })}
      {!readOnly && (
        <button
          onClick={() => onChange([...rows, { name: '', required: !!fixedRequired, schema: { type: 'string' } }])}
          className="flex items-center gap-1 px-3 py-1.5 text-xs text-brand-700 hover:underline dark:text-brand-400"
        >
          <Plus className="size-3" /> {addLabel}
        </button>
      )}
    </div>
  )
}
