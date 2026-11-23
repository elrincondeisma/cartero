import type { JSONSchema } from '@cartero/core'
import { mainType, withType } from '@cartero/contracts'
import { ChevronDown, ChevronRight, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Checkbox, IconButton, Input, Select, cx } from '@/components/ui'
import { t } from '@/i18n'

export const TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'] as const

/** Nombre del tipo para personas (cada literal pasa por t() para que el comprobador de idiomas lo vea). */
export function typeLabel(type: string): string {
  switch (type) {
    case 'string':
      return t('Texto')
    case 'number':
      return t('Número')
    case 'integer':
      return t('Entero')
    case 'boolean':
      return t('Sí/No')
    case 'object':
      return t('Objeto')
    case 'array':
      return t('Lista')
    case 'null':
      return t('Nulo')
    default:
      return type
  }
}

const FORMATS = ['', 'email', 'uuid', 'date-time', 'date', 'time', 'uri', 'ipv4']

export function TypeSelect({ value, onChange, className }: { value: string | undefined; onChange: (v: string) => void; className?: string }) {
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cx('h-7 w-24 px-1.5 text-xs', className)} aria-label={t('Tipo')}>
      {!value && <option value="">{t('Cualquiera')}</option>}
      {TYPES.map((k) => (
        <option key={k} value={k}>
          {typeLabel(k)}
        </option>
      ))}
    </Select>
  )
}

/** Valor de ejemplo escrito a mano: se interpreta como JSON si se puede (7, true, "x"). */
function parseLoose(text: string, type: string | undefined): unknown {
  if (text === '') return undefined
  if (type === 'string') return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function showLoose(v: unknown): string {
  if (v === undefined) return ''
  return typeof v === 'string' ? v : JSON.stringify(v)
}

interface RowProps {
  name?: string
  schema: JSONSchema
  required?: boolean
  depth: number
  readOnly?: boolean
  /** Fila de elementos de una lista: sin nombre ni obligatorio */
  isItems?: boolean
  onChange: (s: JSONSchema) => void
  onRename?: (name: string) => void
  onRequired?: (v: boolean) => void
  onRemove?: () => void
}

function FieldRow({ name, schema, required, depth, readOnly, isItems, onChange, onRename, onRequired, onRemove }: RowProps) {
  const { type, nullable } = mainType(schema)
  const [open, setOpen] = useState(true)
  const [details, setDetails] = useState(false)
  const hasChildren = type === 'object' || type === 'array'
  const hasDetails = !!(schema.description || schema.format || schema.enum || schema.example !== undefined)
  const [draftName, setDraftName] = useState(name ?? '')

  const props: Record<string, JSONSchema> = schema.properties ?? {}
  const req = new Set<string>(schema.required ?? [])

  const setProps = (next: Record<string, JSONSchema>, nextReq: string[] = [...req]) =>
    onChange({ ...schema, properties: next, required: nextReq.filter((k) => k in next) })

  const addField = () => {
    let i = 1
    let key = 'campo'
    while (key in props) key = `campo${++i}`
    setProps({ ...props, [key]: { type: 'string' } }, [...req, key])
  }

  const renameField = (from: string, to: string) => {
    if (!to || to === from || to in props) return
    const next: Record<string, JSONSchema> = {}
    for (const [k, v] of Object.entries(props)) next[k === from ? to : k] = v
    setProps(next, [...req].map((k) => (k === from ? to : k)))
  }

  return (
    <>
      <div
        className="group flex items-center gap-1.5 border-b border-app/60 py-1 pr-2 hover:bg-soft"
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        <button
          className={cx('flex size-4 shrink-0 items-center justify-center text-muted', !hasChildren && 'invisible')}
          onClick={() => setOpen(!open)}
          aria-label={open ? t('Plegar') : t('Desplegar')}
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        {isItems ? (
          <span className="w-44 shrink-0 font-mono text-xs text-muted">{t('cada elemento')}</span>
        ) : name === undefined ? (
          <span className="w-44 shrink-0 text-xs font-medium text-muted">{t('Cuerpo')}</span>
        ) : (
          <div className="w-44 shrink-0">
            <Input
              value={draftName}
              readOnly={readOnly}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => (draftName.trim() && draftName !== name ? onRename?.(draftName.trim()) : setDraftName(name))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              aria-label={t('Nombre del campo')}
              className="h-7 font-mono text-xs"
            />
          </div>
        )}
        <TypeSelect value={type} onChange={(v) => !readOnly && onChange(withType(schema, v, nullable))} />
        {onRequired && !isItems ? (
          <Checkbox checked={!!required} onChange={(v) => !readOnly && onRequired(v)} label={<span className="text-xs">{t('Obligatorio')}</span>} />
        ) : (
          <span className="w-[88px]" />
        )}
        {type && type !== 'null' && (
          <Checkbox
            checked={nullable}
            onChange={(v) => !readOnly && onChange(withType(schema, type, v))}
            label={<span className="text-xs">{t('Puede ser nulo')}</span>}
          />
        )}
        <span className="min-w-0 flex-1 truncate pl-2 text-[11px] text-muted">
          {[schema.format, schema.enum ? t('{0} valores', [schema.enum.length]) : '', schema.description].filter(Boolean).join(' · ')}
        </span>
        <IconButton label={t('Más detalles')} active={details || hasDetails} onClick={() => setDetails(!details)}>
          <SlidersHorizontal className="size-3.5" />
        </IconButton>
        {onRemove && !readOnly && (
          <IconButton label={t('Quitar campo')} onClick={onRemove} className="opacity-0 group-hover:opacity-100">
            <Trash2 className="size-3.5" />
          </IconButton>
        )}
      </div>

      {details && (
        <div className="grid grid-cols-2 gap-2 border-b border-app/60 bg-soft py-2 pr-3" style={{ paddingLeft: 30 + depth * 18 }}>
          <Input
            placeholder={t('Descripción')}
            value={schema.description ?? ''}
            readOnly={readOnly}
            onChange={(e) => onChange({ ...schema, description: e.target.value || undefined })}
            className="h-7 text-xs"
          />
          <Input
            placeholder={t('Ejemplo')}
            value={showLoose(schema.example)}
            readOnly={readOnly}
            onChange={(e) => onChange({ ...schema, example: parseLoose(e.target.value, type) })}
            className="h-7 font-mono text-xs"
          />
          {type === 'string' && (
            <Select
              value={schema.format ?? ''}
              onChange={(e) => onChange({ ...schema, format: e.target.value || undefined })}
              className="h-7 text-xs"
              aria-label={t('Formato')}
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f || t('Sin formato')}
                </option>
              ))}
            </Select>
          )}
          {(type === 'string' || type === 'integer' || type === 'number') && (
            <Input
              placeholder={t('Valores permitidos, separados por comas')}
              value={(schema.enum ?? []).map(String).join(', ')}
              readOnly={readOnly}
              onChange={(e) => {
                const values = e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((v) => (type === 'string' ? v : Number(v)))
                onChange({ ...schema, enum: values.length ? values : undefined })
              }}
              className="h-7 text-xs"
            />
          )}
        </div>
      )}

      {open && type === 'object' && (
        <>
          {Object.entries(props).map(([k, v]) => (
            <FieldRow
              key={k}
              name={k}
              schema={v}
              required={req.has(k)}
              depth={depth + 1}
              readOnly={readOnly}
              onChange={(s) => setProps({ ...props, [k]: s })}
              onRename={(to) => renameField(k, to)}
              onRequired={(on) => setProps(props, on ? [...req, k] : [...req].filter((x) => x !== k))}
              onRemove={() => {
                const { [k]: _gone, ...rest } = props
                setProps(rest)
              }}
            />
          ))}
          {!readOnly && (
            <button
              onClick={addField}
              className="flex items-center gap-1 py-1 text-xs text-brand-700 hover:underline dark:text-brand-400"
              style={{ paddingLeft: 30 + (depth + 1) * 18 }}
            >
              <Plus className="size-3" /> {t('Campo')}
            </button>
          )}
        </>
      )}
      {open && type === 'array' && (
        <FieldRow
          schema={schema.items ?? {}}
          depth={depth + 1}
          isItems
          readOnly={readOnly}
          onChange={(s) => onChange({ ...schema, items: s })}
        />
      )}
    </>
  )
}

/** Editor visual de un JSON Schema: un árbol de campos con tipo, obligatorio y detalles. */
export function SchemaEditor({ schema, onChange, readOnly }: { schema: JSONSchema; onChange: (s: JSONSchema) => void; readOnly?: boolean }) {
  return (
    <div className="rounded-md border border-app text-[12.5px]">
      <FieldRow schema={schema} depth={0} readOnly={readOnly} onChange={onChange} />
    </div>
  )
}
