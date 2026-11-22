import { type FormEvent, useState } from 'react'
import { useSearchParams } from 'react-router'
import { api } from '@/api/client'
import { useMe } from '@/api/hooks'
import { AuthShell, SubmitButton } from '@/features/auth/AuthShell'
import { t } from '@/i18n'

/**
 * Conecta la app de escritorio con esta cuenta: crea un token y lo entrega a la app, que
 * espera en http://127.0.0.1:<puerto>/callback (solo en este ordenador).
 */
export function ConnectDesktop() {
  const [params] = useSearchParams()
  const { data: me } = useMe()
  const port = Number(params.get('port'))
  const state = params.get('state') ?? ''
  const device = (params.get('device') ?? '').slice(0, 60)
  const valid = Number.isInteger(port) && port > 1023 && port < 65536 && /^[A-Za-z0-9_-]{16,}$/.test(state)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function connect(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const name = device ? t('App de escritorio · {0}', [device]) : t('App de escritorio')
      const r = await api.post<{ token: string }>('/api/tokens', { name })
      const url = new URL(`http://127.0.0.1:${port}/callback`)
      url.searchParams.set('token', r.token)
      url.searchParams.set('state', state)
      url.searchParams.set('server', window.location.origin)
      setDone(true)
      window.location.href = url.toString()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  if (!valid)
    return (
      <AuthShell title={t('Enlace no válido')} subtitle={t('Abre esta página desde la app de escritorio: Ajustes → Servidores → Conectar.')}>
        <span />
      </AuthShell>
    )

  return (
    <AuthShell
      title={done ? t('App conectada') : t('Conectar la app de escritorio')}
      subtitle={
        done
          ? t('Ya puedes volver a Cartero. Si no se abre sola, vuelve a la app manualmente.')
          : t('La app podrá ver y editar tus workspaces como {0}. Puedes revocar el acceso cuando quieras en Ajustes → Tokens.', [me?.email ?? ''])
      }
    >
      {!done && (
        <form onSubmit={connect} className="space-y-4">
          {device && <p className="text-sm text-muted">{t('Equipo: {0}', [device])}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <SubmitButton loading={busy}>{t('Conectar')}</SubmitButton>
        </form>
      )}
    </AuthShell>
  )
}
