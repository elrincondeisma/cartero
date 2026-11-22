import { Trash2 } from 'lucide-react'
import { Checkbox, cx } from './ui'
import { VarInput } from './VarInput'
import { t } from "@/i18n";

export interface KVRow {
  key: string
  value: string
  description?: string
  disabled?: boolean
  [extra: string]: any
}

/**
 * Tabla editable de pares clave/valor con fila vacía al final (como Postman).
 * `extraColumn` permite añadir, por ejemplo, el selector texto/fichero de form-data.
 */
export function KeyValueEditor({
  rows,
  onChange,
  known,
  readOnly,
  keyPlaceholder = t('Clave'),
  valuePlaceholder = t('Valor'),
  showDescription = true,
  extraColumn,
  renderValue,
}: {
  rows: KVRow[]
  onChange: (rows: KVRow[]) => void
  known?: Record<string, string>
  readOnly?: boolean
  keyPlaceholder?: string
  valuePlaceholder?: string
  showDescription?: boolean
  extraColumn?: { header: string; width: string; render: (row: KVRow, update: (patch: Partial<KVRow>) => void) => React.ReactNode }
  renderValue?: (row: KVRow, update: (patch: Partial<KVRow>) => void) => React.ReactNode | undefined
}) {
  const list = readOnly ? rows : [...rows, { key: '', value: '', __new: true }]
  const update = (i: number, patch: Partial<KVRow>) => {
    const next = [...rows]
    if (i >= rows.length) next.push({ key: '', value: '', ...patch })
    else next[i] = { ...next[i], ...patch }
    onChange(next.map(({ __new, ...r }) => r as KVRow))
  }
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i))

  return (
    <div className="overflow-hidden rounded-md border border-app">
      <table className="w-full table-fixed border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-soft text-left text-[11.5px] text-muted">
            <th className="w-8" />
            <th className="border-l border-app px-2.5 py-1.5 font-medium">{keyPlaceholder}</th>
            {extraColumn && <th className={cx('border-l border-app px-2.5 py-1.5 font-medium', extraColumn.width)}>{extraColumn.header}</th>}
            <th className="border-l border-app px-2.5 py-1.5 font-medium">{valuePlaceholder}</th>
            {showDescription && <th className="border-l border-app px-2.5 py-1.5 font-medium">{t("Descripción")}</th>}
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {list.map((row, i) => {
            const isNew = (row as any).__new
            const upd = (p: Partial<KVRow>) => update(i, p)
            return (
              <tr key={i} className={cx('group border-t border-app', row.disabled && 'opacity-50')}>
                <td className="text-center">
                  {!isNew && <Checkbox checked={!row.disabled} onChange={(v) => upd({ disabled: !v || undefined })} className="justify-center" />}
                </td>
                <td className="h-8 border-l border-app">
                  <VarInput value={row.key} onChange={(v) => upd({ key: v })} known={known} placeholder={isNew ? keyPlaceholder : ''} className="h-8" />
                </td>
                {extraColumn && <td className="border-l border-app px-1">{!isNew ? extraColumn.render(row, upd) : null}</td>}
                <td className="h-8 border-l border-app">
                  {renderValue?.(row, upd) ?? (
                    <VarInput value={row.value ?? ''} onChange={(v) => upd({ value: v })} known={known} placeholder={isNew ? valuePlaceholder : ''} className="h-8" />
                  )}
                </td>
                {showDescription && (
                  <td className="h-8 border-l border-app">
                    <input
                      value={row.description ?? ''}
                      onChange={(e) => upd({ description: e.target.value || undefined })}
                      className="h-8 w-full bg-transparent px-2.5 outline-none placeholder:text-muted"
                      placeholder={isNew ? t("Descripción") : ''}
                    />
                  </td>
                )}
                <td className="text-center">
                  {!isNew && !readOnly && (
                    <button onClick={() => remove(i)} className="invisible rounded p-1 text-muted group-hover:visible hover:text-red-500" aria-label={t("Eliminar")}>
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
