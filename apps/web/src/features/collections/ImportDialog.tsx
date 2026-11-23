import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, FileUp, Link2, TextCursorInput } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { qk } from '@/api/hooks'
import { Button, Dialog, Input, SubTabs, Textarea, cx } from '@/components/ui'
import { useWs } from '../workspace/context'
import { PostmanImportDialog, PostmanMark } from './PostmanImport'
import { t } from "@/i18n";

interface ImportResult {
  format: string
  collections: { id: string; name: string }[]
  environments: { id: string; name: string }[]
  globals: number
  warnings: string[]
}

const FORMAT_NAMES: Record<string, string> = {
  'postman-collection': t('colección de Postman'),
  'postman-environment': t('entorno de Postman'),
  'postman-globals': t('globales de Postman'),
  'postman-dump': t('volcado de datos de Postman'),
  zip: t('ZIP de exportación'),
  curl: 'cURL',
  'insomnia-v4': 'Insomnia',
  'insomnia-v5': 'Insomnia (v5)',
  'swagger-2': 'Swagger 2.0',
  'cartero-workspace': t('workspace de Cartero'),
}

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { ws } = useWs()
  const [mode, setMode] = useState<'file' | 'text' | 'url'>('file')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [drag, setDrag] = useState(false)
  const [postman, setPostman] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const reset = () => {
    setText('')
    setUrl('')
    setFiles([])
  }

  const done = (results: ImportResult[]) => {
    qc.invalidateQueries({ queryKey: qk.collections(ws) })
    qc.invalidateQueries({ queryKey: qk.environments(ws) })
    qc.invalidateQueries({ queryKey: qk.globals(ws) })
    for (const r of results) {
      const parts = []
      if (r.collections.length) parts.push(t('{0} colección(es)', [r.collections.length]))
      if (r.environments.length) parts.push(t('{0} entorno(s)', [r.environments.length]))
      if (r.globals) parts.push(t('{0} variable(s) global(es)', [r.globals]))
      const fmt = FORMAT_NAMES[r.format] ?? r.format.replace('openapi-', 'OpenAPI ')
      toast.success(t("Importado desde {0}: {1}", [fmt, parts.join(', ') || t('nada')]))
      for (const w of r.warnings) toast.warning(w)
    }
    reset()
    onOpenChange(false)
  }

  const submit = async () => {
    setLoading(true)
    try {
      if (mode === 'file') {
        const results: ImportResult[] = []
        for (const f of files) {
          const form = new FormData()
          form.append('file', f)
          try {
            results.push(await api.upload<ImportResult>(`/api/workspaces/${ws}/import`, form))
          } catch (e) {
            toast.error(`${f.name}: ${(e as Error).message}`)
          }
        }
        if (results.length) done(results)
      } else if (mode === 'text') {
        done([await api.post<ImportResult>(`/api/workspaces/${ws}/import`, { text })])
      } else {
        done([await api.post<ImportResult>(`/api/workspaces/${ws}/import`, { url })])
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = mode === 'file' ? files.length > 0 : mode === 'text' ? text.trim().length > 0 : /^https?:\/\//.test(url)

  return (
    <>
    <PostmanImportDialog
      open={postman}
      onOpenChange={setPostman}
      onUseFiles={() => {
        setPostman(false)
        onOpenChange(true)
      }}
    />
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Importar")}
      description={t("Postman (colecciones v1/v2.0/v2.1, entornos, globales y el ZIP de exportación), Insomnia, OpenAPI/Swagger y cURL. El formato se detecta solo.")}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Cancelar")}</Button>
          <Button variant="primary" onClick={submit} loading={loading} disabled={!canSubmit}>
            {t("Importar")}</Button>
        </>
      }
    >
      <button
        type="button"
        onClick={() => {
          onOpenChange(false)
          setPostman(true)
        }}
        className="group -mt-1 mb-4 flex w-full items-center gap-3 rounded-lg border border-[#FF6C37]/40 bg-[#FF6C37]/[0.06] px-3.5 py-3 text-left transition-colors hover:border-[#FF6C37]/70 hover:bg-[#FF6C37]/10"
      >
        <PostmanMark className="size-8 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t("Conectar con tu cuenta de Postman")}</span>
          <span className="block text-xs text-muted">{t("Trae tus workspaces enteros con su API, sin exportar ficheros.")}</span>
        </span>
        <ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" />
      </button>
      <SubTabs
        className="-mx-5 mb-4"
        value={mode}
        onChange={setMode}
        tabs={[
          { id: 'file', label: <span className="flex items-center gap-1.5"><FileUp className="size-3.5" />{t("Ficheros")}</span> },
          { id: 'text', label: <span className="flex items-center gap-1.5"><TextCursorInput className="size-3.5" />{t("Pegar texto")}</span> },
          { id: 'url', label: <span className="flex items-center gap-1.5"><Link2 className="size-3.5" />URL</span> },
        ]}
      />
      {mode === 'file' && (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            setFiles([...e.dataTransfer.files])
          }}
          onClick={() => inputRef.current?.click()}
          className={cx(
            'flex h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-center transition-colors',
            drag ? 'border-brand-500 bg-brand-500/5' : 'border-app hover:bg-soft',
          )}
        >
          <FileUp className="size-7 text-muted" />
          {files.length ? (
            <div>
              {files.map((f) => (
                <div key={f.name} className="font-medium">
                  {f.name}
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="font-medium">{t("Arrastra aquí tus ficheros")}</div>
              <div className="text-xs text-muted">{t(".json, .yaml, .yml o .zip — o haz clic para elegirlos")}</div>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".json,.yaml,.yml,.zip,.txt"
            className="hidden"
            onChange={(e) => setFiles([...(e.target.files ?? [])])}
          />
        </div>
      )}
      {mode === 'text' && (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          autoFocus
          className="font-mono text-xs"
          placeholder={"curl -X POST https://api.ejemplo.com/v1/users -H 'Content-Type: application/json' -d '{\"name\":\"Ana\"}'\n\no pega aquí el JSON/YAML de una colección, un entorno o una especificación OpenAPI"}
        />
      )}
      {mode === 'url' && (
        <div className="space-y-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://petstore3.swagger.io/api/v3/openapi.json" autoFocus />
          <p className="text-xs text-muted">{t("Útil para especificaciones OpenAPI publicadas o colecciones públicas en JSON.")}</p>
        </div>
      )}
    </Dialog>
    </>
  )
}
