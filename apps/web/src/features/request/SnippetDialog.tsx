import type { Request } from '@cartero/core'
import { useQuery } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { CodeEditor } from '@/components/CodeEditor'
import { Button, Checkbox, Dialog, Select } from '@/components/ui'
import { useUi } from '@/store/ui'
import { useWs } from '../workspace/context'
import { t } from "@/i18n";

interface Lang {
  key: string
  label: string
  syntax: string
  variants: string[]
}

export function SnippetDialog({ open, onOpenChange, request, collectionId }: { open: boolean; onOpenChange: (v: boolean) => void; request: Request; collectionId?: string | null }) {
  const { ws } = useWs()
  const env = useUi((s) => s.activeEnv[ws])
  const { data: langs } = useQuery({ queryKey: ['snippet-langs'], queryFn: () => api.get<Lang[]>('/api/snippets/languages'), staleTime: Number.POSITIVE_INFINITY })
  const [lang, setLang] = useState(() => localStorage.getItem('cartero-snippet-lang') ?? 'curl')
  const [variant, setVariant] = useState(() => localStorage.getItem('cartero-snippet-variant') ?? 'cURL')
  const [resolve, setResolve] = useState(true)
  const [snippet, setSnippet] = useState('')
  const [error, setError] = useState('')
  const current = langs?.find((l) => l.key === lang)

  useEffect(() => {
    if (!open || !current) return
    const v = current.variants.includes(variant) ? variant : current.variants[0]
    if (v !== variant) setVariant(v)
    localStorage.setItem('cartero-snippet-lang', lang)
    localStorage.setItem('cartero-snippet-variant', v)
    api
      .post<{ snippet: string }>(`/api/workspaces/${ws}/snippet`, { request, language: lang, variant: v, environmentId: env, collectionId, resolve })
      .then((r) => {
        setSnippet(r.snippet)
        setError('')
      })
      .catch((e) => setError(e.message))
  }, [open, lang, variant, resolve, current, request, env, collectionId, ws])

  const syntax = current?.syntax === 'csharp' ? 'csharp' : current?.syntax === 'golang' ? 'go' : (current?.syntax ?? 'plaintext')

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Código")}
      description={t("Genera el código equivalente en más de 20 lenguajes.")}
      width="max-w-3xl"
      footer={
        <Button
          variant="primary"
          icon={<Copy className="size-3.5" />}
          onClick={() => {
            navigator.clipboard.writeText(snippet)
            toast.success(t("Copiado al portapapeles"))
          }}
        >
          {t("Copiar")}</Button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={lang} onChange={(e) => setLang(e.target.value)}>
          {langs?.map((l) => (
            <option key={l.key} value={l.key}>
              {l.label}
            </option>
          ))}
        </Select>
        {current && current.variants.length > 1 && (
          <Select value={variant} onChange={(e) => setVariant(e.target.value)}>
            {current.variants.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </Select>
        )}
        <Checkbox checked={resolve} onChange={setResolve} label={t("Sustituir variables")} className="ml-auto" />
      </div>
      <div className="h-[46vh] overflow-hidden rounded-md border border-app">
        {error ? <div className="p-4 text-red-600">{error}</div> : <CodeEditor value={snippet} language={syntax} readOnly />}
      </div>
    </Dialog>
  )
}
