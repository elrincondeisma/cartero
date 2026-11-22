import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useMemo, useState } from 'react'
import { Textarea, cx } from '@/components/ui'

/** Descripción en Markdown de una petición (aparece en la documentación publicada). */
export function DescriptionEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [preview, setPreview] = useState(!!value)
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(value || '', { async: false }) as string), [value])
  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 flex items-center gap-1 text-xs">
        {(['Editar', 'Vista previa'] as const).map((l, i) => (
          <button key={l} onClick={() => setPreview(i === 1)} className={cx('rounded px-2 py-0.5', preview === (i === 1) ? 'bg-muted font-medium' : 'text-muted')}>
            {l}
          </button>
        ))}
        <span className="ml-auto text-muted">Markdown · se muestra en la documentación publicada</span>
      </div>
      {preview ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-app p-4">
          {value ? <div className="prose-docs" dangerouslySetInnerHTML={{ __html: html }} /> : <p className="text-muted">Sin descripción.</p>}
        </div>
      ) : (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-0 flex-1 resize-none font-mono text-xs"
          placeholder={'Explica qué hace esta petición, sus parámetros y posibles errores.\n\n## Parámetros\n- `id`: identificador del usuario'}
          autoFocus
        />
      )}
    </div>
  )
}
