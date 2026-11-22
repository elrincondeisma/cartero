import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { api } from '@/api/client'
import { qk } from '@/api/hooks'
import { Button } from '@/components/ui'
import { type Section, useUi } from '@/store/ui'
import { t, tj } from "@/i18n";

export interface TourStep {
  /** Selector del elemento a resaltar (data-tour="…"). Sin target: tarjeta centrada. */
  target?: string
  title: string
  body: React.ReactNode
  /** Sección a mostrar antes del paso */
  section?: Section
  placement?: 'right' | 'bottom' | 'left' | 'top'
}

export const TOUR: TourStep[] = [
  {
    title: t("Bienvenido a Cartero 👋"),
    body: t("En un minuto te enseño dónde está cada cosa. Puedes salir cuando quieras con Esc y repetir el recorrido desde el botón de ayuda (?)."),
  },
  {
    target: '[data-tour="rail"]',
    placement: 'right',
    title: t("Secciones"),
    body: t("Colecciones, entornos, historial, ejecuciones, mock servers, monitores y ajustes. Todo lo que en otros clientes es de pago, aquí es gratis y sin límites."),
  },
  {
    target: '[data-tour="collections"]',
    section: 'collections',
    placement: 'right',
    title: t("Tus colecciones"),
    body: t("Organiza las peticiones en colecciones y carpetas. Arrastra para reordenar y usa el menú ··· para ejecutar, hacer fork, exportar o configurar la autenticación y los scripts comunes."),
  },
  {
    target: '[data-tour="import"]',
    section: 'collections',
    placement: 'right',
    title: t("Trae lo que ya tienes"),
    body: t("Importa colecciones y entornos de Postman (también el ZIP de exportación completo), Insomnia, OpenAPI/Swagger o un cURL. El formato se detecta solo."),
  },
  {
    target: '[data-tour="new-tab"]',
    placement: 'bottom',
    title: t("Peticiones en pestañas"),
    body: (
      <>
        {tj('Abre una petición nueva con {nueva}. Envía con {enviar} y guarda con {guardar}. Puedes pegar un cURL directamente en la barra de URL.', {
          nueva: <><kbd>{t("Ctrl")}</kbd>+<kbd>T</kbd></>,
          enviar: <><kbd>{t("Ctrl")}</kbd>+<kbd>Enter</kbd></>,
          guardar: <><kbd>{t("Ctrl")}</kbd>+<kbd>S</kbd></>,
        })}
      </>
    ),
  },
  {
    target: '[data-tour="env"]',
    placement: 'bottom',
    title: t("Entornos"),
    body: t("Cambia entre Local, Staging y Producción sin tocar las peticiones: usa {{variables}} en URLs, cabeceras y bodies. El ojo te enseña los valores actuales."),
  },
  {
    target: '[data-tour="palette"]',
    placement: 'bottom',
    title: t("Búscalo todo"),
    body: (
      <>
        {tj('Con {atajo} encuentras cualquier petición, entorno o acción al instante.', { atajo: <><kbd>{t("Ctrl")}</kbd>+<kbd>K</kbd></> })}
      </>
    ),
  },
  {
    target: '[data-tour="help"]',
    placement: 'bottom',
    title: t("Ayuda"),
    body: t("Aquí tienes el manual completo, los atajos de teclado, cómo conectar Cartero con tu asistente de IA (MCP) y este recorrido."),
  },
  {
    title: t("¡Listo!"),
    body: t("Ya conoces lo básico. Si quieres trastear sin miedo, carga los datos de ejemplo desde Ajustes → Workspace: usan APIs públicas reales y se quitan con un clic."),
  },
]

interface TourState {
  step: number | null
  start: () => void
  set: (s: number | null) => void
}

export const useTour = create<TourState>((set) => ({
  step: null,
  start: () => set({ step: 0 }),
  set: (step) => set({ step }),
}))

export function Tour() {
  const { step, set } = useTour()
  const setSection = useUi((s) => s.setSection)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const qc = useQueryClient()
  const current = step === null ? null : TOUR[step]

  const finish = () => {
    set(null)
    void api.patch('/api/auth/me', { settings: { tourDone: true } }).then(() => qc.invalidateQueries({ queryKey: qk.me }))
  }

  useEffect(() => {
    if (current?.section) setSection(current.section)
  }, [current, setSection])

  useLayoutEffect(() => {
    if (!current?.target) return setRect(null)
    const measure = () => {
      const el = document.querySelector(current.target!)
      setRect(el ? el.getBoundingClientRect() : null)
    }
    measure()
    const tItem = setTimeout(measure, 60) // tras cambiar de sección
    window.addEventListener('resize', measure)
    return () => {
      clearTimeout(tItem)
      window.removeEventListener('resize', measure)
    }
  }, [current])

  useEffect(() => {
    if (step === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      if (e.key === 'ArrowRight') set(Math.min(TOUR.length - 1, step + 1))
      if (e.key === 'ArrowLeft') set(Math.max(0, step - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (step === null || !current) return null

  const pad = 6
  const hole = rect && { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
  const W = 340
  let pos: React.CSSProperties = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  if (hole) {
    const p = current.placement ?? 'bottom'
    const clampX = (x: number) => Math.max(12, Math.min(window.innerWidth - W - 12, x))
    const clampY = (y: number) => Math.max(12, Math.min(window.innerHeight - 220, y))
    if (p === 'right') pos = { top: clampY(hole.top), left: hole.left + hole.width + 14 }
    else if (p === 'left') pos = { top: clampY(hole.top), left: hole.left - W - 14 }
    else if (p === 'top') pos = { top: hole.top - 14, left: clampX(hole.left), transform: 'translateY(-100%)' }
    else pos = { top: hole.top + hole.height + 14, left: clampX(hole.left + hole.width - W) }
  }
  const last = step === TOUR.length - 1

  return createPortal(
    <div className="fixed inset-0 z-[200]" role="dialog" aria-label={t("Recorrido guiado")}>
      {hole ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-brand-500 transition-all duration-300"
          style={{ ...hole, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}
      <div className="absolute rounded-xl border border-app bg-app p-4 shadow-2xl transition-all duration-300" style={{ ...pos, width: W }}>
        <div className="mb-1 flex items-start justify-between gap-2">
          <h3 className="text-[15px] font-semibold">{current.title}</h3>
          <button onClick={finish} className="rounded p-0.5 text-muted hover:bg-muted hover:text-app" aria-label={t("Cerrar el recorrido")}>
            <X className="size-4" />
          </button>
        </div>
        <div className="leading-relaxed text-muted [&_kbd]:rounded [&_kbd]:border [&_kbd]:border-app [&_kbd]:bg-soft [&_kbd]:px-1 [&_kbd]:font-mono [&_kbd]:text-[11px]">{current.body}</div>
        <div className="mt-4 flex items-center gap-2">
          <div className="flex flex-1 gap-1">
            {TOUR.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-4 bg-brand-500' : 'w-1.5 bg-muted'}`} />
            ))}
          </div>
          {step > 0 && (
            <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-3.5" />} onClick={() => set(step - 1)}>
              {t("Atrás")}</Button>
          )}
          <Button size="sm" variant="primary" onClick={() => (last ? finish() : set(step + 1))}>
            {last ? t("Empezar") : t("Siguiente")} {!last && <ArrowRight className="size-3.5" />}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
