import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { qk, useMe } from '@/api/hooks'
import { Logo } from '@/components/Logo'
import { Button, Field, Input, Spinner } from '@/components/ui'

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-soft p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo size={30} />
        </div>
        <div className="rounded-xl border border-app bg-app p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        <p className="mt-4 text-center text-xs text-muted">Cartero · cliente de APIs open source</p>
      </div>
    </div>
  )
}

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
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
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell title="Inicia sesión" subtitle="Accede a tus colecciones y workspaces.">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required autoComplete="email" />
        </Field>
        <Field label="Contraseña">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={loading}>
          Entrar
        </Button>
      </form>
      {cfg?.allowRegistration !== false && (
        <p className="mt-4 text-center text-muted">
          ¿No tienes cuenta?{' '}
          <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`} className="text-brand-600 hover:underline">
            Regístrate
          </Link>
        </p>
      )}
    </AuthShell>
  )
}

export function RegisterPage({ invitation, presetEmail }: { invitation?: string; presetEmail?: string }) {
  const [email, setEmail] = useState(presetEmail ?? '')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [params] = useSearchParams()
  const nav = useNavigate()
  const qc = useQueryClient()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/api/auth/register', { email, name, password, invitation })
      await qc.invalidateQueries({ queryKey: qk.me })
      await qc.invalidateQueries({ queryKey: qk.workspaces })
      nav(params.get('next') ?? '/', { replace: true })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell title="Crea tu cuenta" subtitle="Gratis y sin límites: es tu servidor.">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required autoComplete="name" />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required readOnly={!!presetEmail} autoComplete="email" />
        </Field>
        <Field label="Contraseña" hint="Mínimo 8 caracteres">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={loading}>
          Crear cuenta
        </Button>
      </form>
      {!invitation && (
        <p className="mt-4 text-center text-muted">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-brand-600 hover:underline">
            Inicia sesión
          </Link>
        </p>
      )}
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
      <AuthShell title="Invitación no válida" subtitle="La invitación no existe o ha caducado.">
        <Link to="/" className="text-brand-600 hover:underline">
          Ir al inicio
        </Link>
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
    <AuthShell title={`Únete a «${inv.workspace}»`} subtitle={`Te han invitado como ${inv.role}.`}>
      <Button variant="primary" className="w-full" onClick={accept} loading={accepting}>
        Aceptar invitación
      </Button>
    </AuthShell>
  )
}
