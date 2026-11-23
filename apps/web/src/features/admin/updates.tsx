import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpCircle, CircleCheck, ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Button, Spinner, Switch, timeAgo } from '@/components/ui'
import { t } from '@/i18n'
import { type AdminSettings, useSaveSettings } from './forms'

export interface UpdateStatus {
  current: string
  latest: { version: string; url: string; publishedAt: string } | null
  updateAvailable: boolean
  blocked: 'dev' | 'pinned' | 'no-updater' | 'updater-offline' | 'check-disabled' | null
  updater: 'ecs' | 'compose' | null
  state: 'idle' | 'running' | 'done' | 'failed'
  message?: string
  at?: string
  checkedAt?: string
  checkError?: string
}

export const UPDATES_KEY = ['admin', 'updates']

const DOCS = 'https://github.com/elrincondeisma/cartero/blob/main/docs/manual/21-updating.md'

export function useUpdates(enabled = true) {
  return useQuery({
    queryKey: UPDATES_KEY,
    queryFn: () => api.get<UpdateStatus>('/api/admin/updates'),
    enabled,
    staleTime: 60 * 60 * 1000,
  })
}

/** Aviso en la cabecera, solo para admins, cuando hay una versión nueva. */
export function UpdateNotice() {
  const { data } = useUpdates()
  if (!data?.updateAvailable || !data.latest) return null
  return (
    <Link
      to="/admin?tab=system"
      className="inline-flex items-center gap-1.5 rounded-full border border-brand-600/30 bg-brand-600/10 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-600/15 dark:text-brand-400"
    >
      <ArrowUpCircle className="size-3.5" />
      {t('Cartero {0} disponible', [data.latest.version])}
    </Link>
  )
}

function blockedText(b: NonNullable<UpdateStatus['blocked']>) {
  switch (b) {
    case 'dev':
      return t('Es una versión de desarrollo: se actualiza construyendo de nuevo desde el código.')
    case 'pinned':
      return t('La versión está fijada en el despliegue. Cámbiala allí para actualizar.')
    case 'no-updater':
      return t(
        'Esta instalación no tiene quien la reinicie. Actualiza con docker compose pull y docker compose up -d.',
      )
    case 'updater-offline':
      return t('El contenedor updater no responde. Comprueba que está en marcha (docker compose ps).')
    case 'check-disabled':
      return t('La búsqueda de versiones está desactivada.')
  }
}

/** Espera a que el servidor vuelva con otra versión y recarga la página. */
function useWaitForVersion(from: string, active: boolean, onFail: () => void) {
  useEffect(() => {
    if (!active) return
    let stop = false
    const started = Date.now()
    const tick = async () => {
      if (stop) return
      try {
        const h = await fetch('/api/health').then((r) => r.json())
        if (h.version && h.version !== from) {
          toast.success(t('Actualizado a Cartero {0}', [h.version]))
          setTimeout(() => location.reload(), 1200)
          return
        }
        const s = await api.get<UpdateStatus>('/api/admin/updates')
        if (s.state === 'failed') return onFail()
      } catch {
        // Mientras se reinicia, el servidor no contesta: es normal
      }
      if (Date.now() - started > 20 * 60 * 1000) return onFail()
      setTimeout(tick, 5000)
    }
    const first = setTimeout(tick, 5000)
    return () => {
      stop = true
      clearTimeout(first)
    }
  }, [active, from, onFail])
}

export function UpdatesPanel({ s }: { s: AdminSettings }) {
  const qc = useQueryClient()
  const { data } = useUpdates()
  const save = useSaveSettings()
  const [waiting, setWaiting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    setRefreshing(true)
    try {
      qc.setQueryData(UPDATES_KEY, await api.get<UpdateStatus>('/api/admin/updates?refresh=1'))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRefreshing(false)
    }
  }
  const apply = useMutation({
    mutationFn: () => api.post<UpdateStatus>('/api/admin/updates/apply'),
    onSuccess: (st) => {
      qc.setQueryData(UPDATES_KEY, st)
      setWaiting(true)
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const onFail = useCallback(() => {
    setWaiting(false)
    void qc.invalidateQueries({ queryKey: UPDATES_KEY })
  }, [qc])
  useWaitForVersion(data?.current ?? '', waiting || data?.state === 'running', onFail)

  const toggle = (patch: Partial<AdminSettings['updates']>) =>
    save.mutateAsync({ updates: patch }).then(
      () => qc.invalidateQueries({ queryKey: UPDATES_KEY }),
      (e) => toast.error((e as Error).message),
    )

  if (!data)
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    )

  const running = waiting || data.state === 'running'
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm">
            {t('Instalada')}: <strong>{data.current}</strong>
          </div>
          {data.latest && (
            <div className="text-sm">
              {t('Última publicada')}:{' '}
              <a
                href={data.latest.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline dark:text-brand-400"
              >
                {data.latest.version}
                <ExternalLink className="size-3" />
              </a>
            </div>
          )}
          {data.checkedAt && (
            <div className="mt-0.5 text-xs text-muted">
              {t('Comprobado {0}', [timeAgo(data.checkedAt)])}
              {data.checkError && ` · ${t('GitHub no respondió')}`}
            </div>
          )}
        </div>
        {s.updates.check && (
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className={refreshing ? 'animate-spin' : ''} />}
            disabled={refreshing}
            onClick={refresh}
          >
            {t('Buscar')}
          </Button>
        )}
      </div>

      {running ? (
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm">
          <Spinner />
          {t('Actualizando… Cartero se reiniciará y esta página se recargará sola.')}
        </div>
      ) : data.updateAvailable ? (
        data.blocked ? (
          <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              {blockedText(data.blocked)}{' '}
              <a href={DOCS} target="_blank" rel="noreferrer" className="underline">
                {t('Cómo actualizar')}
              </a>
            </span>
          </div>
        ) : (
          <Button icon={<ArrowUpCircle />} loading={apply.isPending} onClick={() => apply.mutate()}>
            {t('Actualizar a {0}', [data.latest!.version])}
          </Button>
        )
      ) : (
        data.latest && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <CircleCheck className="size-4 text-emerald-500" />
            {t('Tienes la última versión.')}
          </div>
        )
      )}

      {data.state === 'failed' && !running && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {t('La última actualización falló. Cartero sigue con la versión anterior.')}
          {data.message && <div className="mt-1 font-mono text-xs">{data.message}</div>}
        </div>
      )}

      <div className="space-y-2.5 border-t border-app pt-4">
        <Switch
          checked={s.updates.check}
          onChange={(v) => void toggle({ check: v })}
          label={<span className="text-sm">{t('Buscar versiones nuevas')}</span>}
        />
        <Switch
          checked={s.updates.auto}
          onChange={(v) => void toggle({ auto: v })}
          label={<span className="text-sm">{t('Actualizar sola cada noche (03:00–05:00 UTC)')}</span>}
        />
      </div>
    </div>
  )
}
