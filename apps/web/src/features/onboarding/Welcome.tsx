import { useQueryClient } from '@tanstack/react-query'
import { Check, FileUp, Loader2, Sparkles, SquarePen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { qk } from '@/api/hooks'
import { Dialog, cx } from '@/components/ui'
import { ImportDialog } from '../collections/ImportDialog'
import { PostmanImportDialog } from '../collections/PostmanImport'
import { useWs } from '../workspace/context'
import { useTour } from './Tour'
import { lang, t } from "@/i18n";

interface DemoStatus {
  status: 'idle' | 'running' | 'done' | 'error' | 'reverting'
  log: string[]
  workspaceId?: string
  error?: string
}

/** Hook para cargar los datos de ejemplo mostrando el progreso. */
export function useDemoLoader() {
  const [status, setStatus] = useState<DemoStatus | null>(null)
  const qc = useQueryClient()
  const start = async () => {
    const current = await api.get<DemoStatus>('/api/demo')
    if (current.status === 'done' && current.workspaceId) return current.workspaceId
    await api.post('/api/demo', { lang })
    setStatus({ status: 'running', log: [] })
    for (;;) {
      await new Promise((r) => setTimeout(r, 1200))
      const s = await api.get<DemoStatus>('/api/demo')
      setStatus(s)
      if (s.status === 'done' || s.status === 'error') {
        await qc.invalidateQueries({ queryKey: qk.workspaces })
        if (s.status === 'error') throw new Error(s.error)
        return s.workspaceId!
      }
    }
  }
  return { status, start }
}

/** Asistente de bienvenida: se muestra la primera vez que alguien entra. */
export function Welcome() {
  const { me } = useWs()
  const [open, setOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [postmanOpen, setPostmanOpen] = useState(false)
  const qc = useQueryClient()
  const nav = useNavigate()
  const startTour = useTour((s) => s.start)
  const demo = useDemoLoader()
  const loading = demo.status?.status === 'running'

  useEffect(() => {
    const settings = (me as any).settings ?? {}
    if (!settings.welcomed) setOpen(true)
  }, [me])

  const markWelcomed = () => {
    void api.patch('/api/auth/me', { settings: { welcomed: true } }).then(() => qc.invalidateQueries({ queryKey: qk.me }))
  }
  const close = (tour: boolean) => {
    setOpen(false)
    markWelcomed()
    if (tour) setTimeout(startTour, 250)
  }

  const loadDemo = async () => {
    try {
      const ws = await demo.start()
      markWelcomed()
      setOpen(false)
      nav(`/w/${ws}`)
      toast.success(t("Datos de ejemplo cargados"), { description: t("Puedes quitarlos cuando quieras en Ajustes → Workspace.") })
      setTimeout(startTour, 600)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const options = [
    {
      icon: <FileUp className="size-5" />,
      title: t("Importar desde Postman"),
      text: t("Conecta tu cuenta y trae tus workspaces enteros. También puedes subir ficheros de Postman, Insomnia, OpenAPI o cURL."),
      onClick: () => setPostmanOpen(true),
    },
    {
      icon: <Sparkles className="size-5" />,
      title: t("Ver un ejemplo completo"),
      text: t("Un workspace con APIs públicas reales: tests, entornos, mocks, monitores, docs… Se quita con un clic."),
      onClick: loadDemo,
      highlight: true,
    },
    {
      icon: <SquarePen className="size-5" />,
      title: t("Empezar en blanco"),
      text: t("Crea tu primera petición y ve descubriendo Cartero a tu ritmo."),
      onClick: () => close(true),
    },
  ]

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !loading && close(false)} title={t("¡Hola, {0}!", [me.name.split(' ')[0]])} description={t("Cartero es tu cliente de APIs: todo incluido, sin límites y en tu servidor. ¿Cómo quieres empezar?")} width="max-w-2xl">
        {loading ? (
          <div className="py-4">
            <div className="mb-3 flex items-center gap-2 font-medium">
              <Loader2 className="size-4 animate-spin text-brand-600" /> {t("Preparando el workspace de ejemplo con APIs reales…")}</div>
            <ul className="space-y-1.5">
              {demo.status?.log.map((l) => (
                <li key={l} className="flex items-start gap-2 text-muted">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-green-600" />
                  {l}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {options.map((o) => (
              <button
                key={o.title}
                onClick={o.onClick}
                className={cx(
                  'flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md',
                  o.highlight ? 'border-brand-500 bg-brand-500/5' : 'border-app hover:bg-soft',
                )}
              >
                <span className={cx('rounded-lg p-2', o.highlight ? 'bg-brand-600 text-white' : 'bg-muted')}>{o.icon}</span>
                <span className="font-semibold">{o.title}</span>
                <span className="text-xs leading-relaxed text-muted">{o.text}</span>
              </button>
            ))}
          </div>
        )}
        {!loading && (
          <div className="mt-4 flex justify-between text-xs text-muted">
            <span>{t("Puedes repetir el recorrido desde el botón de ayuda (?).")}</span>
            <button className="hover:text-app hover:underline" onClick={() => close(false)}>
              {t("Saltar")}</button>
          </div>
        )}
      </Dialog>
      <PostmanImportDialog
        open={postmanOpen}
        onOpenChange={(o) => {
          setPostmanOpen(o)
          if (!o) close(true)
        }}
        onUseFiles={() => {
          setPostmanOpen(false)
          setImportOpen(true)
        }}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={(o) => {
          setImportOpen(o)
          if (!o) close(true)
        }}
      />
    </>
  )
}
