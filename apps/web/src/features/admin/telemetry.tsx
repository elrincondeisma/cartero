import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Spinner, Switch, timeAgo } from '@/components/ui'
import { lang, t } from '@/i18n'
import { type AdminSettings, useSaveSettings } from './forms'

interface TelemetryStatus {
  enabled: boolean
  disabledByEnv: boolean
  lastSentAt: string | null
  nextAt: string | null
  lastReport: unknown
  preview: unknown
}

const DOCS = `https://cartero.elrincondeisma.com${lang === 'es' ? '/es' : ''}/docs/telemetry/`
const KEY = ['admin', 'telemetry']

/** Interruptor de la telemetría, con lo que significa. Lo usan Administración y el asistente de instalación. */
export function TelemetrySwitch({ s }: { s: AdminSettings }) {
  const save = useSaveSettings()
  const qc = useQueryClient()
  const forced = s.telemetry.disabledByEnv
  const toggle = (enabled: boolean) =>
    save.mutateAsync({ telemetry: { enabled } }).then(
      () => qc.invalidateQueries({ queryKey: KEY }),
      (e) => toast.error((e as Error).message),
    )
  return (
    <div className="flex items-start gap-3">
      <BarChart3 className="mt-0.5 size-4 shrink-0 text-brand-600" />
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <p className="text-muted">
          {t(
            'Una vez al día, Cartero envía recuentos anónimos (versión, cuántos usuarios y colecciones, qué funciones se usan, errores) para saber cuánta gente lo usa y en qué mejorarlo. Nunca envía tus peticiones, URLs, colecciones, variables, secretos ni emails.',
          )}{' '}
          <a href={DOCS} target="_blank" rel="noreferrer" className="underline">
            {t('Qué se envía')}
          </a>
        </p>
        {forced ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t('Apagada con la variable de entorno CARTERO_TELEMETRY (o DO_NOT_TRACK).')}
          </p>
        ) : (
          <Switch
            checked={s.telemetry.enabled}
            onChange={(v) => void toggle(v)}
            label={<span>{t('Enviar estadísticas anónimas de uso')}</span>}
          />
        )}
      </div>
    </div>
  )
}

/** Tarjeta de Administración → Sistema: el interruptor, el último envío y el informe exacto. */
export function TelemetryPanel({ s }: { s: AdminSettings }) {
  const [open, setOpen] = useState(false)
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<TelemetryStatus>('/api/admin/telemetry'),
  })
  return (
    <div className="space-y-4">
      <TelemetrySwitch s={s} />
      {!data ? (
        <div className="flex justify-center p-2">
          <Spinner />
        </div>
      ) : (
        <>
          {data.enabled && (
            <p className="text-xs text-muted">
              {data.lastSentAt
                ? t('Último envío: {0}', [timeAgo(data.lastSentAt)])
                : t('Todavía no se ha enviado ningún informe.')}
            </p>
          )}
          <div className="border-t border-app pt-3">
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-400"
            >
              <ChevronDown
                className={open ? 'size-4 rotate-180 transition-transform' : 'size-4 transition-transform'}
              />
              {t('Ver lo que se envía')}
            </button>
            {open && (
              <>
                <p className="mt-2 text-xs text-muted">
                  {t('Este es el informe tal cual, con los datos de ahora mismo.')}
                </p>
                <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-soft p-3 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(data.preview, null, 2)}
                </pre>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
