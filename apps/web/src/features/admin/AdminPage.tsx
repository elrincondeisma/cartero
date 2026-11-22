import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ban, Check, Copy, ExternalLink, KeyRound, MoreHorizontal, Play, Search, Shield, ShieldCheck, Trash2, UserRound, Users } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useMe } from '@/api/hooks'
import type { OAuthProvider } from '@/api/types'
import { confirm } from '@/components/dialogs'
import { Logo } from '@/components/Logo'
import { PROVIDER_NAME, ProviderIcon } from '@/components/ProviderIcon'
import { Badge, Button, Field, Input, Menu, Select, Spinner, Switch, cx, timeAgo } from '@/components/ui'
import { t } from '@/i18n'
import { initials } from '../workspace/Layout'

interface AdminUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'user'
  disabled: boolean
  hasPassword: boolean
  createdAt: string
  lastSeenAt: string | null
  providers: OAuthProvider[]
}

interface ProviderInfo {
  enabled: boolean
  clientId: string
  hasSecret: boolean
  callbackUrl: string
}

interface AdminSettings {
  allowRegistration: boolean
  allowedDomains: string[]
  providers: Record<OAuthProvider, ProviderInfo>
}

type Tab = 'users' | 'auth'

/** Panel de administración de la instancia: usuarios e inicio de sesión. */
export function AdminPage() {
  const { data: me, isLoading } = useMe()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'users'
  const { data: stats } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.get<{ users: number; admins: number; workspaces: number; collections: number; runs24h: number }>('/api/admin/stats'),
    enabled: me?.role === 'admin',
  })

  useEffect(() => {
    document.title = `${t('Administración')} · Cartero`
  }, [])

  if (isLoading) return null
  if (me?.role !== 'admin') return <Navigate to="/" replace />

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'users', label: t('Usuarios'), icon: <Users /> },
    { id: 'auth', label: t('Inicio de sesión'), icon: <KeyRound /> },
  ]

  return (
    <div className="min-h-full bg-soft">
      <header className="sticky top-0 z-20 border-b border-app bg-app/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-6">
          <Link to="/" className="flex items-center gap-3">
            <Logo size={24} />
          </Link>
          <span className="text-muted">/</span>
          <span className="flex items-center gap-1.5 font-medium">
            <ShieldCheck className="size-4 text-brand-600" />
            {t('Administración')}
          </span>
          <Link to="/" className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-muted hover:bg-muted hover:text-app">
            <ArrowLeft className="size-4" />
            {t('Volver a la app')}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('Administración')}</h1>
        <p className="mt-1 text-[14px] text-muted">{t('Ajustes que afectan a toda la instancia y a todas las cuentas.')}</p>

        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t('Usuarios')} value={stats?.users} />
          <Stat label={t('Administradores')} value={stats?.admins} />
          <Stat label={t('Workspaces')} value={stats?.workspaces} />
          <Stat label={t('Ejecuciones (24 h)')} value={stats?.runs24h} />
        </div>

        <nav className="mt-8 flex gap-1 border-b border-app" role="tablist">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              role="tab"
              aria-selected={tab === tb.id}
              onClick={() => setParams({ tab: tb.id }, { replace: true })}
              className={cx(
                '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors [&>svg]:size-4',
                tab === tb.id ? 'border-brand-600 text-app' : 'border-transparent text-muted hover:text-app',
              )}
            >
              {tb.icon}
              {tb.label}
            </button>
          ))}
        </nav>

        <div className="mt-6">{tab === 'users' ? <UsersTab meId={me.id} /> : <AuthTab />}</div>
      </main>
    </div>
  )
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-xl border border-app bg-app px-4 py-3.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value ?? '—'}</div>
    </div>
  )
}

/* ── Usuarios ─────────────────────────────────────────────────── */

function UsersTab({ meId }: { meId: string }) {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const { data: users, isLoading } = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.get<AdminUser[]>('/api/admin/users') })
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? users?.filter((u) => u.email.includes(s) || u.name.toLowerCase().includes(s)) : users
  }, [users, q])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin'] })
  }
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Pick<AdminUser, 'role' | 'disabled'>> }) => api.patch(`/api/admin/users/${id}`, body),
    onSuccess: () => {
      refresh()
      toast.success(t('Guardado'))
    },
    onError: (e) => toast.error(e.message),
  })
  const remove = async (u: AdminUser) => {
    const ok = await confirm(
      t('¿Borrar a {0}?', [u.name]),
      t('Se borran su cuenta y sus workspaces personales. Los workspaces de equipo se quedan con el resto de miembros. No se puede deshacer.'),
      { confirm: t('Borrar'), danger: true },
    )
    if (!ok) return
    try {
      await api.del(`/api/admin/users/${u.id}`)
      refresh()
      toast.success(t('Usuario borrado'))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-app bg-app">
      <div className="flex items-center gap-3 border-b border-app p-3">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Buscar por nombre o email')} className="pl-8" aria-label={t('Buscar usuarios')} />
        </div>
        <span className="ml-auto text-xs text-muted">{t('{0} cuentas', [filtered?.length ?? 0])}</span>
      </div>
      {isLoading ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-soft text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">{t('Usuario')}</th>
                <th className="px-4 py-2 font-medium">{t('Acceso')}</th>
                <th className="px-4 py-2 font-medium">{t('Rol')}</th>
                <th className="px-4 py-2 font-medium">{t('Estado')}</th>
                <th className="px-4 py-2 font-medium">{t('Última sesión')}</th>
                <th className="w-10 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered?.map((u) => {
                const isMe = u.id === meId
                return (
                  <tr key={u.id} className={cx('border-t border-app', u.disabled && 'opacity-60')}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <span
                          className={cx(
                            'flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white',
                            u.role === 'admin' ? 'bg-brand-600' : 'bg-zinc-500',
                          )}
                        >
                          {initials(u.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-medium">
                            <span className="truncate">{u.name}</span>
                            {isMe && <Badge>{t('tú')}</Badge>}
                          </div>
                          <div className="truncate text-xs text-muted">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 text-muted">
                        {u.hasPassword && (
                          <span title={t('Contraseña')} className="flex size-6 items-center justify-center rounded-md bg-muted">
                            <KeyRound className="size-3.5" />
                          </span>
                        )}
                        {u.providers.map((p) => (
                          <span key={p} title={PROVIDER_NAME[p]} className="flex size-6 items-center justify-center rounded-md bg-muted text-app">
                            <ProviderIcon provider={p} className="size-3.5" />
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Select
                        value={u.role}
                        disabled={isMe || patch.isPending}
                        onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value as AdminUser['role'] } })}
                        className="h-7 text-xs"
                        aria-label={t('Rol de {0}', [u.name])}
                      >
                        <option value="admin">{t('Admin')}</option>
                        <option value="user">{t('Usuario')}</option>
                      </Select>
                    </td>
                    <td className="px-4 py-2.5">{u.disabled ? <Badge tone="red">{t('Desactivado')}</Badge> : <Badge tone="green">{t('Activo')}</Badge>}</td>
                    <td className="px-4 py-2.5 text-muted">{u.lastSeenAt ? timeAgo(u.lastSeenAt) : t('Nunca')}</td>
                    <td className="px-4 py-2.5">
                      {!isMe && (
                        <Menu
                          trigger={
                            <button className="rounded-md p-1 text-muted hover:bg-muted hover:text-app" aria-label={t('Acciones de {0}', [u.name])}>
                              <MoreHorizontal className="size-4" />
                            </button>
                          }
                          items={[
                            u.disabled
                              ? { label: t('Reactivar cuenta'), icon: <Play />, onSelect: () => patch.mutate({ id: u.id, body: { disabled: false } }) }
                              : { label: t('Desactivar cuenta'), icon: <Ban />, onSelect: () => patch.mutate({ id: u.id, body: { disabled: true } }) },
                            u.role === 'admin'
                              ? { label: t('Quitar admin'), icon: <UserRound />, onSelect: () => patch.mutate({ id: u.id, body: { role: 'user' } }) }
                              : { label: t('Hacer admin'), icon: <Shield />, onSelect: () => patch.mutate({ id: u.id, body: { role: 'admin' } }) },
                            'separator',
                            { label: t('Borrar usuario'), icon: <Trash2 />, danger: true, onSelect: () => void remove(u) },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered?.length === 0 && <div className="p-10 text-center text-muted">{t('Nadie coincide con la búsqueda.')}</div>}
        </div>
      )}
    </div>
  )
}

/* ── Inicio de sesión ─────────────────────────────────────────── */

function AuthTab() {
  const qc = useQueryClient()
  const { data: s } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<AdminSettings>('/api/admin/settings') })
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<AdminSettings>('/api/admin/settings', body),
    onSuccess: (data) => {
      qc.setQueryData(['admin', 'settings'], data)
      qc.invalidateQueries({ queryKey: ['auth-config'] })
      toast.success(t('Guardado'))
    },
    onError: (e) => toast.error(e.message),
  })
  const [domains, setDomains] = useState('')
  useEffect(() => {
    if (s) setDomains(s.allowedDomains.join(', '))
  }, [s])

  if (!s)
    return (
      <div className="flex justify-center p-10">
        <Spinner />
      </div>
    )
  const domainList = domains
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <Card title={t('Registro')} description={t('Quién puede crear una cuenta nueva.')}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">{t('Registro abierto')}</div>
            <p className="mt-0.5 text-xs text-muted">
              {s.allowRegistration
                ? t('Cualquiera con acceso a esta URL puede crearse una cuenta, también con Google o GitHub.')
                : t('Solo pueden entrar las cuentas que ya existen y las personas invitadas a un workspace.')}
            </p>
          </div>
          <Switch checked={s.allowRegistration} onChange={(v) => save.mutate({ allowRegistration: v })} label={<span className="sr-only">{t('Registro abierto')}</span>} />
        </div>
        <div className="mt-6 border-t border-app pt-5">
          <Field
            label={t('Dominios permitidos')}
            hint={t('Separados por comas. Vacío: cualquier dominio. Las invitaciones no se ven afectadas.')}
          >
            <Input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="empresa.com, empresa.es" />
          </Field>
          <div className="mt-3 flex justify-end">
            <Button
              variant="primary"
              size="sm"
              loading={save.isPending}
              disabled={domainList.join(',') === s.allowedDomains.join(',')}
              onClick={() => save.mutate({ allowedDomains: domainList })}
            >
              {t('Guardar dominios')}
            </Button>
          </div>
        </div>
      </Card>

      <div className="space-y-6">
        {(['google', 'github'] as const).map((p) => (
          <ProviderCard key={p} provider={p} info={s.providers[p]} saving={save.isPending} onSave={(body) => save.mutate({ providers: { [p]: body } })} />
        ))}
      </div>
    </div>
  )
}

const CONSOLE: Record<OAuthProvider, { url: string; steps: string }> = {
  google: {
    url: 'https://console.cloud.google.com/apis/credentials',
    steps: 'En Google Cloud: Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web. Pega la URL de callback en «URIs de redireccionamiento autorizados».',
  },
  github: {
    url: 'https://github.com/settings/applications/new',
    steps: 'En GitHub: Settings → Developer settings → OAuth Apps → New OAuth App. Pega la URL de callback en «Authorization callback URL».',
  },
}

function ProviderCard({ provider, info, saving, onSave }: { provider: OAuthProvider; info: ProviderInfo; saving: boolean; onSave: (body: Record<string, unknown>) => void }) {
  const [clientId, setClientId] = useState(info.clientId)
  const [secret, setSecret] = useState('')
  useEffect(() => {
    setClientId(info.clientId)
    setSecret('')
  }, [info.clientId, info.hasSecret])
  const dirty = clientId !== info.clientId || secret !== ''
  const ready = !!clientId && (info.hasSecret || !!secret)
  const name = PROVIDER_NAME[provider]

  return (
    <Card
      title={
        <span className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg border border-app bg-soft">
            <ProviderIcon provider={provider} className="size-[18px]" />
          </span>
          {name}
          {info.enabled ? (
            <Badge tone="green">
              <Check className="size-3" />
              {t('Activo')}
            </Badge>
          ) : (
            <Badge>{t('Desactivado')}</Badge>
          )}
        </span>
      }
      action={
        <Switch
          checked={info.enabled}
          onChange={(v) => {
            if (v && !ready) return toast.error(t('Rellena el Client ID y el Client secret antes de activarlo'))
            onSave({ enabled: v, ...(dirty ? { clientId, ...(secret ? { clientSecret: secret } : {}) } : {}) })
          }}
          label={<span className="sr-only">{t('Activar {0}', [name])}</span>}
        />
      }
    >
      <div className="space-y-4">
        <Field label={t('URL de callback')} hint={t('Pégala tal cual al crear la aplicación OAuth.')}>
          <div className="flex gap-2">
            <Input value={info.callbackUrl} readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(info.callbackUrl)
                toast.success(t('Copiado'))
              }}
              aria-label={t('Copiar URL de callback')}
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client ID">
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Client secret" hint={info.hasSecret ? t('Guardado y cifrado. Escribe uno nuevo para cambiarlo.') : undefined}>
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={info.hasSecret ? '••••••••••••' : ''}
              autoComplete="new-password"
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-soft px-3 py-2.5 text-xs text-muted">
          <span className="max-w-md">{t(CONSOLE[provider].steps)}</span>
          <a href={CONSOLE[provider].url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-400">
            {t('Abrir {0}', [name])}
            <ExternalLink className="size-3" />
          </a>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" size="sm" loading={saving} disabled={!dirty} onClick={() => onSave({ clientId, ...(secret ? { clientSecret: secret } : {}) })}>
            {t('Guardar credenciales')}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function Card({ title, description, action, children }: { title: ReactNode; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="self-start rounded-xl border border-app bg-app p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
