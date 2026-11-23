import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Ban, CircleCheck, KeyRound, Mail, MoreHorizontal, Play, Search, Server, Settings2, Shield, ShieldAlert, ShieldCheck, Trash2, TriangleAlert, UserRound, Users, Wand2 } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useMe } from '@/api/hooks'
import type { OAuthProvider } from '@/api/types'
import { confirm } from '@/components/dialogs'
import { Logo } from '@/components/Logo'
import { PROVIDER_NAME, ProviderIcon } from '@/components/ProviderIcon'
import { Badge, Button, Input, Menu, Select, Spinner, cx, timeAgo } from '@/components/ui'
import { AccessForm, type AdminSettings, EmailForm, GeneralForm, ProviderCard, SecurityForm, useAdminSettings } from './forms'
import { UpdatesPanel } from './updates'
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

type Tab = 'general' | 'users' | 'auth' | 'email' | 'security' | 'system'

/** Panel de administración de la instancia: usuarios e inicio de sesión. */
export function AdminPage() {
  const { data: me, isLoading } = useMe()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'general'
  const { data: stats } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.get<{ users: number; admins: number; workspaces: number; collections: number; runs24h: number }>('/api/admin/stats'),
    enabled: me?.role === 'admin',
  })

  useEffect(() => {
    document.title = `${t('Administración')} · ${document.title.split(' · ').pop()}`
  }, [])

  if (isLoading) return null
  if (me?.role !== 'admin') return <Navigate to="/" replace />

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'general', label: t('General'), icon: <Settings2 /> },
    { id: 'users', label: t('Usuarios'), icon: <Users /> },
    { id: 'auth', label: t('Inicio de sesión'), icon: <KeyRound /> },
    { id: 'email', label: t('Email'), icon: <Mail /> },
    { id: 'security', label: t('Seguridad'), icon: <ShieldAlert /> },
    { id: 'system', label: t('Sistema'), icon: <Server /> },
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

        <nav className="mt-8 flex gap-1 overflow-x-auto border-b border-app" role="tablist">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              role="tab"
              aria-selected={tab === tb.id}
              onClick={() => setParams({ tab: tb.id }, { replace: true })}
              className={cx(
                '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors [&>svg]:size-4',
                tab === tb.id ? 'border-brand-600 text-app' : 'border-transparent text-muted hover:text-app',
              )}
            >
              {tb.icon}
              {tb.label}
            </button>
          ))}
        </nav>

        <div key={tab} className="auth-rise mt-6">
          {tab === 'general' && <GeneralTab />}
          {tab === 'users' && <UsersTab meId={me.id} />}
          {tab === 'auth' && <AuthTab />}
          {tab === 'email' && <EmailTab myEmail={me.email} />}
          {tab === 'security' && <SecurityTab />}
          {tab === 'system' && <SystemTab />}
        </div>
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

/* ── Ajustes ──────────────────────────────────────────────────── */

function Panel({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-app bg-app p-5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

function WithSettings({ children }: { children: (s: AdminSettings) => ReactNode }) {
  const { data } = useAdminSettings()
  if (!data)
    return (
      <div className="flex justify-center p-10">
        <Spinner />
      </div>
    )
  return <>{children(data)}</>
}

function GeneralTab() {
  return (
    <WithSettings>
      {(s) => (
        <div className="max-w-2xl">
          <Panel title={t('Tu instancia')} description={t('Cómo se llama y en qué dirección se publica.')}>
            <GeneralForm s={s} />
          </Panel>
        </div>
      )}
    </WithSettings>
  )
}

function AuthTab() {
  return (
    <WithSettings>
      {(s) => (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.4fr]">
          <Panel title={t('Registro')} description={t('Quién puede crear una cuenta nueva.')}>
            <AccessForm s={s} />
          </Panel>
          <div className="space-y-6">
            {(['google', 'github'] as const).map((p) => (
              <ProviderCard key={p} provider={p} info={s.providers[p]} />
            ))}
          </div>
        </div>
      )}
    </WithSettings>
  )
}

function EmailTab({ myEmail }: { myEmail: string }) {
  return (
    <WithSettings>
      {(s) => (
        <div className="max-w-2xl">
          <Panel title={t('Email')} description={t('Servidor de correo para invitaciones y avisos.')}>
            <EmailForm s={s} myEmail={myEmail} />
          </Panel>
        </div>
      )}
    </WithSettings>
  )
}

function SecurityTab() {
  return (
    <WithSettings>
      {(s) => (
        <div className="max-w-2xl">
          <Panel title={t('Dónde está tu instancia')} description={t('Decide si las peticiones pueden llegar a tu red privada.')}>
            <SecurityForm s={s} />
          </Panel>
        </div>
      )}
    </WithSettings>
  )
}

interface SystemInfo {
  version: string
  node: string
  database: boolean
  redis: boolean
  inlineWorker: boolean
  secretKeyFromEnv: boolean
  production: boolean
  secureCookies: boolean
  filesDir: string
  envPublicUrl: string
}

function SystemTab() {
  const nav = useNavigate()
  const { data: sys } = useQuery({ queryKey: ['admin', 'system'], queryFn: () => api.get<SystemInfo>('/api/admin/system') })
  if (!sys)
    return (
      <div className="flex justify-center p-10">
        <Spinner />
      </div>
    )
  const rows: { label: string; ok: boolean | null; value: ReactNode; hint?: string }[] = [
    { label: t('Base de datos'), ok: sys.database, value: sys.database ? t('Conectada') : t('Sin conexión') },
    { label: 'Redis', ok: sys.redis, value: sys.redis ? t('Conectado') : t('Sin conexión'), hint: sys.redis ? undefined : t('Sin Redis no se ejecutan los monitores programados.') },
    {
      label: t('Clave de cifrado'),
      ok: sys.secretKeyFromEnv,
      value: sys.secretKeyFromEnv ? t('Definida en CARTERO_SECRET_KEY') : t('Clave de desarrollo'),
      hint: sys.secretKeyFromEnv ? undefined : t('Define CARTERO_SECRET_KEY con un valor largo y aleatorio antes de guardar secretos de verdad.'),
    },
    { label: t('Modo'), ok: null, value: sys.production ? t('Producción') : t('Desarrollo') },
    { label: t('Cookies seguras (HTTPS)'), ok: null, value: sys.secureCookies ? t('Sí') : t('No') },
    { label: t('Monitores'), ok: null, value: sys.inlineWorker ? t('En el mismo proceso') : t('En un worker aparte') },
    { label: t('Carpeta de ficheros'), ok: null, value: <code className="font-mono text-xs">{sys.filesDir}</code> },
    { label: t('Versión'), ok: null, value: `Cartero ${sys.version} · Node ${sys.node}` },
  ]
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Panel title={t('Estado del servidor')} description={t('Esto se configura con variables de entorno, porque el servidor lo necesita antes de arrancar.')}>
        <dl className="divide-y divide-[var(--border)]">
          {rows.map((r) => (
            <div key={r.label} className="flex items-start justify-between gap-4 py-2.5">
              <dt className="text-muted">{r.label}</dt>
              <dd className="text-right">
                <span className="inline-flex items-center gap-1.5">
                  {r.ok === true && <CircleCheck className="size-4 text-emerald-500" />}
                  {r.ok === false && <TriangleAlert className="size-4 text-amber-500" />}
                  {r.value}
                </span>
                {r.hint && <div className="mt-0.5 max-w-xs text-xs text-amber-700 dark:text-amber-400">{r.hint}</div>}
              </dd>
            </div>
          ))}
        </dl>
      </Panel>
      <div className="space-y-6">
        <Panel title={t('Actualizaciones')} description={t('Las versiones publicadas de Cartero y cómo llegan a esta instalación.')}>
          <WithSettings>{(s) => <UpdatesPanel s={s} />}</WithSettings>
        </Panel>
        <Panel title={t('Asistente de instalación')} description={t('Repasa la configuración paso a paso, como la primera vez.')}>
          <Button icon={<Wand2 />} onClick={() => nav('/setup')}>
            {t('Abrir el asistente')}
          </Button>
        </Panel>
      </div>
    </div>
  )
}
