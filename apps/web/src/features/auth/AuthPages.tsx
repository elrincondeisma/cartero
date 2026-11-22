import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { qk, useMe } from '@/api/hooks'
import { Lock, Mail, User } from 'lucide-react'
import { Button, Spinner } from '@/components/ui'
import { AuthField, AuthShell, PasswordField, StrengthMeter, SubmitButton } from './AuthShell'
import { lang, t } from "@/i18n";

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [shake, setShake] = useState(0)
  const [params] = useSearchParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['auth-config'], queryFn: () => api.get<{ allowRegistration: boolean }>('/api/auth/config') })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/api/auth/login', { email, password })
      await qc.invalidateQueries({ queryKey: qk.me })
      nav(params.get('next') ?? '/', { replace: true })
    } catch (err) {
      setShake((n) => n + 1)
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title={t('Hola de nuevo')}
      subtitle={t('Accede a tus colecciones y workspaces.')}
      shake={shake}
      footer={
        cfg?.allowRegistration !== false && (
          <>
            {t('¿No tienes cuenta?')}{' '}
            <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`} className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
              {t('Regístrate')}
            </Link>
          </>
        )
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <AuthField label={t('Email')} icon={<Mail />} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required autoComplete="email" placeholder={t('tu@empresa.com')} delay={240} />
        <PasswordField label={t('Contraseña')} icon={<Lock />} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" placeholder="••••••••" delay={300} />
        <SubmitButton loading={loading} delay={380}>
          {t('Entrar')}
        </SubmitButton>
      </form>
    </AuthShell>
  )
}

export function RegisterPage({ invitation, presetEmail }: { invitation?: string; presetEmail?: string }) {
  const [email, setEmail] = useState(presetEmail ?? '')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [shake, setShake] = useState(0)
  const [params] = useSearchParams()
  const nav = useNavigate()
  const qc = useQueryClient()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/api/auth/register', { email, name, password, invitation, lang })
      await qc.invalidateQueries({ queryKey: qk.me })
      await qc.invalidateQueries({ queryKey: qk.workspaces })
      nav(params.get('next') ?? '/', { replace: true })
    } catch (err) {
      setShake((n) => n + 1)
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title={t('Crea tu cuenta')}
      subtitle={invitation ? t('Te han invitado a un workspace. Crea tu cuenta para entrar.') : t('Gratis y sin límites: es tu servidor.')}
      shake={shake}
      footer={
        !invitation && (
          <>
            {t('¿Ya tienes cuenta?')}{' '}
            <Link to="/login" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
              {t('Inicia sesión')}
            </Link>
          </>
        )
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <AuthField label={t('Nombre')} icon={<User />} value={name} onChange={(e) => setName(e.target.value)} autoFocus required autoComplete="name" placeholder="Ada Lovelace" delay={240} />
        <AuthField
          label={t('Email')}
          icon={<Mail />}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          readOnly={!!presetEmail}
          autoComplete="email"
          placeholder={t('tu@empresa.com')}
          className={presetEmail ? 'cursor-not-allowed opacity-70' : ''}
          delay={300}
        />
        <PasswordField
          label={t('Contraseña')}
          icon={<Lock />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
          autoComplete="new-password"
          placeholder="••••••••"
          hint={<StrengthMeter password={password} />}
          delay={360}
        />
        <SubmitButton loading={loading} delay={440}>
          {t('Crear cuenta')}
        </SubmitButton>
      </form>
    </AuthShell>
  )
}

export function InvitePage() {
  const { token } = useParams()
  const { data: me, isLoading: meLoading } = useMe()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [accepting, setAccepting] = useState(false)
  const { data: inv, isLoading, error } = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.get<{ email: string; workspace: string; role: string }>(`/api/invitations/${token}`),
  })

  if (isLoading || meLoading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  if (error || !inv)
    return (
      <AuthShell title={t("Invitación no válida")} subtitle={t("La invitación no existe o ha caducado.")}>
        <Link to="/" className="text-brand-600 hover:underline">
          {t("Ir al inicio")}</Link>
      </AuthShell>
    )

  if (!me) return <RegisterPage invitation={token} presetEmail={inv.email} />

  const accept = async () => {
    setAccepting(true)
    try {
      const { workspaceId } = await api.post<{ workspaceId: string }>(`/api/invitations/${token}/accept`)
      await qc.invalidateQueries({ queryKey: qk.workspaces })
      nav(`/w/${workspaceId}`, { replace: true })
    } catch (e) {
      toast.error((e as Error).message)
      setAccepting(false)
    }
  }

  return (
    <AuthShell title={t("Únete a «{0}»", [inv.workspace])} subtitle={t('Te han invitado como {0}.', [({ owner: t('Propietario'), admin: t('Administrador'), editor: t('Editor'), viewer: t('Lector') } as Record<string, string>)[inv.role] ?? inv.role])}>
      <Button variant="primary" className="w-full" onClick={accept} loading={accepting}>
        {t("Aceptar invitación")}</Button>
    </AuthShell>
  )
}
