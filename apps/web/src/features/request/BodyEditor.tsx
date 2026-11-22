import type { Body, FormParam } from '@cartero/core'
import { Paperclip, Wand2 } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { CodeEditor } from '@/components/CodeEditor'
import { KeyValueEditor, type KVRow } from '@/components/KeyValueEditor'
import { Button, Select, cx } from '@/components/ui'
import { useWs } from '../workspace/context'

const MODES: { id: NonNullable<Body['mode']>; label: string }[] = [
  { id: 'none', label: 'ninguno' },
  { id: 'raw', label: 'raw' },
  { id: 'formdata', label: 'form-data' },
  { id: 'urlencoded', label: 'x-www-form-urlencoded' },
  { id: 'file', label: 'binario' },
  { id: 'graphql', label: 'GraphQL' },
]

const LANGS = [
  { id: 'json', label: 'JSON' },
  { id: 'text', label: 'Texto' },
  { id: 'xml', label: 'XML' },
  { id: 'html', label: 'HTML' },
  { id: 'javascript', label: 'JavaScript' },
]

function monacoLang(l?: string) {
  return l === 'text' || !l ? 'plaintext' : l
}

function useUpload() {
  const { ws } = useWs()
  return async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.upload<{ src: string; name: string }>(`/api/workspaces/${ws}/files`, form)
  }
}

export function BodyEditor({ body, onChange, known, readOnly }: { body?: Body; onChange: (b: Body | undefined) => void; known: Record<string, string>; readOnly?: boolean }) {
  const mode = body?.mode ?? 'none'
  const language = body?.options?.raw?.language ?? 'json'
  const upload = useUpload()
  const fileInput = useRef<HTMLInputElement>(null)

  const setMode = (m: NonNullable<Body['mode']>) => {
    if (m === 'none') return onChange(undefined)
    onChange({ ...(body ?? {}), mode: m, ...(m === 'raw' && !body?.options?.raw ? { options: { raw: { language: 'json' } } } : {}) })
  }

  const beautify = () => {
    if (language !== 'json') return
    try {
      onChange({ ...body, raw: JSON.stringify(JSON.parse(body?.raw ?? ''), null, 2) })
    } catch {
      toast.error('El JSON no es válido')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-3 py-2">
        {MODES.map((m) => (
          <label key={m.id} className="flex cursor-pointer items-center gap-1.5 text-[12.5px]">
            <input type="radio" checked={mode === m.id} onChange={() => setMode(m.id)} disabled={readOnly} className="accent-brand-600" />
            {m.label}
          </label>
        ))}
        {mode === 'raw' && (
          <div className="ml-auto flex items-center gap-2">
            <Select
              value={language}
              onChange={(e) => onChange({ ...body, options: { ...body?.options, raw: { language: e.target.value } } })}
              className="h-7 text-xs"
              disabled={readOnly}
            >
              {LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </Select>
            {language === 'json' && (
              <Button size="sm" variant="ghost" icon={<Wand2 className="size-3.5" />} onClick={beautify} disabled={readOnly}>
                Formatear
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'none' && <div className="p-6 text-center text-muted">Esta petición no tiene cuerpo.</div>}
        {mode === 'raw' && (
          <div className="h-full border-t border-app">
            <CodeEditor value={body?.raw ?? ''} onChange={(raw) => onChange({ ...body, raw })} language={monacoLang(language)} readOnly={readOnly} />
          </div>
        )}
        {mode === 'urlencoded' && (
          <div className="h-full overflow-auto px-3 pb-3">
            <KeyValueEditor rows={(body?.urlencoded ?? []) as KVRow[]} onChange={(rows) => onChange({ ...body, urlencoded: rows })} known={known} readOnly={readOnly} />
          </div>
        )}
        {mode === 'formdata' && (
          <div className="h-full overflow-auto px-3 pb-3">
            <KeyValueEditor
              rows={(body?.formdata ?? []) as KVRow[]}
              onChange={(rows) => onChange({ ...body, formdata: rows as FormParam[] })}
              known={known}
              readOnly={readOnly}
              extraColumn={{
                header: 'Tipo',
                width: 'w-24',
                render: (row, update) => (
                  <select
                    value={row.type === 'file' ? 'file' : 'text'}
                    onChange={(e) => update({ type: e.target.value, ...(e.target.value === 'file' ? { value: undefined } : { src: undefined }) })}
                    className="h-7 w-full bg-transparent text-xs outline-none"
                    disabled={readOnly}
                  >
                    <option value="text">Texto</option>
                    <option value="file">Fichero</option>
                  </select>
                ),
              }}
              renderValue={(row, update) =>
                row.type === 'file' ? (
                  <FilePicker
                    src={typeof row.src === 'string' ? row.src : Array.isArray(row.src) ? row.src[0] : undefined}
                    onPick={async (f) => {
                      try {
                        const r = await upload(f)
                        update({ src: r.src })
                      } catch (e) {
                        toast.error((e as Error).message)
                      }
                    }}
                    disabled={readOnly}
                  />
                ) : undefined
              }
            />
          </div>
        )}
        {mode === 'file' && (
          <div className="p-4">
            <div className="flex items-center gap-3">
              <Button icon={<Paperclip className="size-3.5" />} variant="outline" onClick={() => fileInput.current?.click()} disabled={readOnly}>
                Elegir fichero
              </Button>
              <span className="truncate text-muted">{body?.file?.src ? fileName(body.file.src) : 'Ningún fichero seleccionado'}</span>
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  try {
                    const r = await upload(f)
                    onChange({ ...body, file: { src: r.src } })
                  } catch (err) {
                    toast.error((err as Error).message)
                  }
                }}
              />
            </div>
          </div>
        )}
        {mode === 'graphql' && (
          <div className="grid h-full grid-cols-[3fr_2fr] border-t border-app">
            <div className="flex min-h-0 flex-col border-r border-app">
              <div className="px-3 py-1.5 text-[11px] font-medium text-muted uppercase">Query</div>
              <div className="min-h-0 flex-1">
                <CodeEditor
                  value={body?.graphql?.query ?? ''}
                  onChange={(query) => onChange({ ...body, graphql: { ...body?.graphql, query } })}
                  language="graphql"
                  readOnly={readOnly}
                />
              </div>
            </div>
            <div className="flex min-h-0 flex-col">
              <div className="px-3 py-1.5 text-[11px] font-medium text-muted uppercase">Variables (JSON)</div>
              <div className="min-h-0 flex-1">
                <CodeEditor
                  value={body?.graphql?.variables ?? ''}
                  onChange={(variables) => onChange({ ...body, graphql: { ...body?.graphql, variables } })}
                  language="json"
                  readOnly={readOnly}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function fileName(src: string) {
  return src.split('/').pop()
}

function FilePicker({ src, onPick, disabled }: { src?: string; onPick: (f: File) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => ref.current?.click()}
      className={cx('flex h-8 w-full items-center gap-1.5 px-2.5 text-left text-[12.5px]', !src && 'text-muted')}
    >
      <Paperclip className="size-3.5 shrink-0" />
      <span className="truncate">{src ? fileName(src) : 'Elegir fichero…'}</span>
      <input
        ref={ref}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onPick(f)
        }}
      />
    </button>
  )
}
