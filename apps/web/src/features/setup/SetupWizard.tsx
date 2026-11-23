import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CircleCheck, Database, KeyRound, Lock, Mail, PartyPopper, ShieldCheck, TriangleAlert, User } from 'lucide-react'
import { type CSSProperties, type FormEvent, type ReactNode, createContext, useContext, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { qk, useMe } from '@/api/hooks'
import { LanguageLinks } from '@/components/LanguageSwitch'
import { Logo } from '@/components/Logo'
import { Button, Spinner, cx } from '@/components/ui'
import { lang, t } from '@/i18n'
import { TelemetrySwitch } from '../admin/telemetry'
import { AccessForm, type Actions, type AdminSettings, EmailForm, GeneralForm, ProviderCard, SecurityForm, useAdminSettings, useSaveSettings } from '../admin/forms'
import { AuthField, PasswordField, StrengthMeter, SubmitButton } from '../auth/AuthShell'

export interface SetupStatus {
  needsSetup: boolean
  setupCompleted: boolean
  detectedUrl?: string
  publicUrl?: string
  secretKeyFromEnv?: boolean
  production?: boolean
}

export const useSetupStatus = () => useQuery({ queryKey: ['setup'], queryFn: () => api.get<SetupStatus>('/api/setup'), staleTime: 30_000 })

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties

type StepId = 'welcome' | 'admin' | 'instance' | 'access' | 'social' | 'email' | 'security' | 'done'

const STEP_KEY = 'cartero-setup-step'

/** Asistente de instalación: aparece la primera vez que se abre una instancia nueva. */
export function SetupWizard() {
  const { data: status, isLoading } = useSetupStatus()
  const { data: me, isLoading: meLoading } = useMe()
  const [step, setStepState] = useState<StepId>(() => (localStorage.getItem(STEP_KEY) as StepId) || 'welcome')
  const setStep = (s: StepId) => {
    localStorage.setItem(STEP_KEY, s)
    setStepState(s)
    window.scrollTo({ top: 0 })
  }

  useEffect(() => {
    document.title = `${t('Instalación')} · Cartero`
  }, [])

  if (isLoading || meLoading) return <FullSpinner />
  // Con la instancia ya instalada, solo los admins pueden repasar el asistente
  if (!status?.needsSetup && me?.role !== 'admin') return <Navigate to={me ? '/' : '/login'} replace />
  // Si la cuenta admin ya existe, el paso de crearla queda hecho
  const current: StepId = status?.needsSetup && !['welcome', 'admin'].includes(step) ? 'welcome' : step

  const steps: { id: StepId; label: string; optional?: boolean }[] = [
    { id: 'welcome', label: t('Bienvenida') },
    { id: 'admin', label: t('Cuenta de administrador') },
    { id: 'instance', label: t('Tu instancia') },
    { id: 'access', label: t('Quién puede entrar') },
    { id: 'social', label: t('Google y GitHub'), optional: true },
    { id: 'email', label: t('Email'), optional: true },
    { id: 'security', label: t('Seguridad') },
    { id: 'done', label: t('Listo') },
  ]
  const idx = steps.findIndex((s) => s.id === current)
  const go = (delta: number) => setStep(steps[Math.min(steps.length - 1, Math.max(0, idx + delta))].id)

  return (
    <div className="flex min-h-full bg-app">
      <Sidebar steps={steps} idx={idx} adminDone={!!me} onJump={(i) => me && i > 1 && setStep(steps[i].id)} />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-6 py-5 lg:hidden">
          <Logo size={24} />
          <span className="text-xs text-muted">{t('Paso {0} de {1}', [idx + 1, steps.length])}</span>
        </div>
        <div className="h-1 bg-muted lg:hidden">
          <div className="h-full bg-brand-600 transition-all duration-500" style={{ width: `${((idx + 1) / steps.length) * 100}%` }} />
        </div>
        <div className="flex flex-1 items-start justify-center px-6 py-10 sm:px-10 lg:items-center">
          {/* Un solo movimiento por paso: entra el contenido nuevo entero */}
          <div key={current} className="auth-rise w-full max-w-[600px]">
            <OptionalCtx.Provider value={!!steps[idx].optional}>
              <StepBody step={current} status={status} onNext={() => go(1)} onBack={() => go(-1)} />
            </OptionalCtx.Provider>
          </div>
        </div>
      </main>
    </div>
  )
}

function FullSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  )
}

function Sidebar({ steps, idx, adminDone, onJump }: { steps: { id: StepId; label: string; optional?: boolean }[]; idx: number; adminDone: boolean; onJump: (i: number) => void }) {
  return (
    <aside className="relative hidden w-[340px] shrink-0 flex-col overflow-hidden bg-[#0c0c0e] px-8 py-8 text-white lg:flex" style={{ '--border': 'rgb(255 255 255 / 0.09)' } as CSSProperties}>
      <div className="auth-grid absolute inset-0" />
      <div className="auth-aurora absolute -top-1/3 -left-1/3 size-[120%] rounded-full bg-[radial-gradient(circle,rgba(249,115,22,0.22),transparent_60%)] blur-2xl" />
      <div className="relative">
        <div className="[&_span]:text-white">
          <Logo size={28} />
        </div>
        <h2 className="mt-10 text-2xl font-bold tracking-tight">{t('Instalación')}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{t('Unos minutos y tu Cartero estará listo. Todo se puede cambiar después en Administración.')}</p>
      </div>
      <ol className="relative mt-10 space-y-1">
        {steps.map((s, i) => {
          const done = i < idx || (s.id === 'admin' && adminDone)
          const active = i === idx
          const reachable = adminDone && i > 1
          return (
            <li key={s.id} className="relative">
              {i < steps.length - 1 && <span className={cx('absolute top-9 left-[15px] h-[calc(100%-20px)] w-px', i < idx ? 'bg-brand-500' : 'bg-white/10')} />}
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onJump(i)}
                className={cx('flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left transition-colors', reachable && !active && 'hover:bg-white/5')}
                aria-current={active ? 'step' : undefined}
              >
                <span
                  className={cx(
                    'flex size-[30px] shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-all duration-300',
                    active && 'border-brand-500 bg-brand-600 text-white shadow-[0_0_0_4px_rgba(249,115,22,0.18)]',
                    done && !active && 'border-brand-500 bg-brand-500/15 text-brand-400',
                    !done && !active && 'border-white/15 text-zinc-500',
                  )}
                >
                  {done && !active ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className={cx('text-sm', active ? 'font-semibold text-white' : done ? 'text-zinc-300' : 'text-zinc-500')}>
                  {s.label}
                  {s.optional && <span className="ml-1.5 text-xs text-zinc-600">{t('opcional')}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <div className="relative mt-auto pt-8 [&_*]:!text-zinc-400 [&_button[aria-current=true]]:!text-white">
        <LanguageLinks className="justify-start" />
      </div>
    </aside>
  )
}

const OptionalCtx = createContext(false)

/** Cabecera de cada paso */
function Head({ title, children }: { title: string; children?: ReactNode }) {
  const optional = useContext(OptionalCtx)
  return (
    <div className="mb-8">
      <h1 className="flex flex-wrap items-center gap-3 text-[30px] leading-tight font-bold tracking-[-0.03em]">
        {title}
        {optional && <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium tracking-normal text-muted">{t('Opcional')}</span>}
      </h1>
      {children && <p className="mt-2.5 max-w-[60ch] text-[15px] leading-relaxed text-muted">{children}</p>}
    </div>
  )
}

/** Atrás / Saltar / Continuar, guardando antes si hay cambios. */
function nav(onBack: () => void, onNext: () => void, opts: { skip?: boolean } = {}): Actions {
  return ({ dirty, saving, submit }) => (
    <Footer
      onBack={onBack}
      onSkip={opts.skip && !dirty ? onNext : undefined}
      next={
        <Button variant="primary" loading={saving} onClick={async () => (await submit()) && onNext()} className="h-10 px-5">
          {t('Continuar')}
        </Button>
      }
    />
  )
}

function Footer({ onBack, onSkip, next }: { onBack?: () => void; onSkip?: () => void; next: ReactNode }) {
  return (
    <div className="mt-8 flex items-center gap-3 border-t border-app pt-6">
      {onBack && (
        <Button onClick={onBack} className="h-10">
          {t('Atrás')}
        </Button>
      )}
      <div className="ml-auto flex items-center gap-2">
        {onSkip && (
          <Button variant="ghost" onClick={onSkip} className="h-10">
            {t('Lo haré más tarde')}
          </Button>
        )}
        {next}
      </div>
    </div>
  )
}

function Body({ children }: { children: ReactNode }) {
  return <div>{children}</div>
}

function StepBody({ step, status, onNext, onBack }: { step: StepId; status?: SetupStatus; onNext: () => void; onBack: () => void }) {
  if (step === 'welcome') return <Welcome status={status} onNext={onNext} />
  if (step === 'admin') return <AdminStep status={status} onNext={onNext} onBack={onBack} />
  return <SettingsStep step={step} onNext={onNext} onBack={onBack} />
}

/* ── 1. Bienvenida ────────────────────────────────────────────── */

function Welcome({ status, onNext }: { status?: SetupStatus; onNext: () => void }) {
  // Antes de instalar, el estado viene en /api/setup; al repasar el asistente, del de Administración → Sistema
  const { data: system } = useQuery({
    queryKey: ['admin', 'system'],
    queryFn: () => api.get<{ secretKeyFromEnv: boolean }>('/api/admin/system'),
    enabled: status?.needsSetup === false,
  })
  const secretKeyFromEnv = status?.needsSetup ? status.secretKeyFromEnv : system?.secretKeyFromEnv
  const checks: { ok: boolean; icon: ReactNode; title: string; text: string }[] = [
    { ok: true, icon: <Database />, title: t('Base de datos conectada'), text: t('Cartero ya ha creado sus tablas.') },
    secretKeyFromEnv === false
      ? {
          ok: false,
          icon: <KeyRound />,
          title: t('Estás usando la clave de cifrado de desarrollo'),
          text: t('Vale para probar. Antes de guardar secretos de verdad, define CARTERO_SECRET_KEY con un valor largo y aleatorio (openssl rand -base64 32) y reinicia.'),
        }
      : { ok: true, icon: <KeyRound />, title: t('Clave de cifrado definida'), text: t('Los secretos se guardarán cifrados con tu CARTERO_SECRET_KEY. No la pierdas.') },
  ]
  return (
    <>
      <Head title={t('Vamos a dejar Cartero listo')}>
        {t('Crearás la cuenta de administrador y decidirás quién puede entrar, cómo y desde dónde. Son unos minutos, y todo se puede cambiar después.')}
      </Head>
      <Body>
        <div className="space-y-3">
          {checks.map((c) => (
            <div key={c.title} className={cx('flex gap-3 rounded-xl border p-4', c.ok ? 'border-app' : 'border-amber-500/40 bg-amber-500/[0.07]')}>
              <span className={cx('flex size-9 shrink-0 items-center justify-center rounded-lg [&>svg]:size-[18px]', c.ok ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-600')}>
                {c.icon}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-semibold">
                  {c.ok ? <CircleCheck className="size-4 text-emerald-500" /> : <TriangleAlert className="size-4 text-amber-500" />}
                  {c.title}
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{c.text}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 rounded-xl bg-soft p-4 text-sm">
          <div className="mb-1 font-medium">{t('Idioma')}</div>
          <p className="mb-3 text-xs text-muted">{t('El de la interfaz. Cada persona puede cambiar el suyo.')}</p>
          <LanguageLinks className="justify-start text-sm" />
        </div>
      </Body>
      <Footer
        next={
          <Button variant="primary" onClick={onNext} className="h-10 px-5">
            {t('Empezar')}
          </Button>
        }
      />
    </>
  )
}

/* ── 2. Cuenta de administrador ───────────────────────────────── */

function AdminStep({ status, onNext, onBack }: { status?: SetupStatus; onNext: () => void; onBack: () => void }) {
  const { data: me } = useMe()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  if (me)
    return (
      <>
        <Head title={t('Cuenta de administrador')} />
        <Body>
          <div className="flex items-center gap-3 rounded-xl border border-app p-4">
            <span className="flex size-10 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
              <User className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{me.name}</div>
              <div className="truncate text-xs text-muted">{me.email}</div>
            </div>
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CircleCheck className="size-4" />
              {t('Creada')}
            </span>
          </div>
        </Body>
        <Footer
          onBack={onBack}
          next={
            <Button variant="primary" onClick={onNext} className="h-10 px-5">
              {t('Continuar')}
            </Button>
          }
        />
      </>
    )

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/api/setup/admin', { name, email, password, lang, publicUrl: status?.detectedUrl })
      await qc.invalidateQueries({ queryKey: qk.me })
      await qc.invalidateQueries({ queryKey: ['setup'] })
      toast.success(t('Cuenta creada'))
      onNext()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Head title={t('Crea la cuenta de administrador')}>{t('Con ella gestionarás Cartero: cuentas, formas de entrar y ajustes. Después podrás nombrar más administradores.')}</Head>
      <form onSubmit={submit} className="space-y-4">
        <AuthField label={t('Nombre')} icon={<User />} value={name} onChange={(e) => setName(e.target.value)} required autoFocus autoComplete="name" placeholder="Ada Lovelace" />
        <AuthField label={t('Email')} icon={<Mail />} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder={t('tu@empresa.com')} />
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
         
        />
        <div className="flex items-center gap-3 pt-2">
          <Button type="button" onClick={onBack} className="h-12">
            {t('Atrás')}
          </Button>
          <div className="flex-1">
            <SubmitButton loading={loading} arrow={false}>
              {t('Crear cuenta y continuar')}
            </SubmitButton>
          </div>
        </div>
      </form>
    </>
  )
}

/* ── 3-8. Ajustes ─────────────────────────────────────────────── */

function SettingsStep({ step, onNext, onBack }: { step: Exclude<StepId, 'welcome' | 'admin'>; onNext: () => void; onBack: () => void }) {
  const { data: s } = useAdminSettings()
  const { data: me } = useMe()
  if (!s) return <FullSpinner />
  switch (step) {
    case 'instance':
      return (
        <>
          <Head title={t('Tu instancia')}>{t('El nombre que verá tu equipo y la dirección pública con la que se llega a Cartero.')}</Head>
          <Body>
            <GeneralForm s={s} actions={nav(onBack, onNext)} quiet />
          </Body>
        </>
      )
    case 'access':
      return (
        <>
          <Head title={t('¿Quién puede crear una cuenta?')}>{t('Tú decides si Cartero está abierto, solo para tu empresa o solo por invitación.')}</Head>
          <Body>
            <AccessForm s={s} actions={nav(onBack, onNext)} quiet />
          </Body>
        </>
      )
    case 'social':
      return (
        <>
          <Head title={t('Entrar con Google y GitHub')}>
            {t('Crea una aplicación OAuth en Google o GitHub, pega aquí sus credenciales y actívala. Puedes dejarlo para más tarde.')}
          </Head>
          <Body>
            <div className="space-y-4">
              {(['google', 'github'] as const).map((p) => (
                <ProviderCard key={p} provider={p} info={s.providers[p]} />
              ))}
            </div>
          </Body>
          <Footer
            onBack={onBack}
            next={
              <Button variant="primary" onClick={onNext} className="h-10 px-5">
                {s.providers.google.enabled || s.providers.github.enabled ? t('Continuar') : t('Saltar este paso')}
              </Button>
            }
          />
        </>
      )
    case 'email':
      return (
        <>
          <Head title={t('Email')}>{t('Con un servidor SMTP, Cartero envía las invitaciones y los avisos de los monitores por email.')}</Head>
          <Body>
            <EmailForm s={s} myEmail={me?.email} actions={nav(onBack, onNext, { skip: true })} quiet />
          </Body>
        </>
      )
    case 'security':
      return (
        <>
          <Head title={t('¿Dónde va a estar Cartero?')}>{t('Las peticiones salen desde tu servidor. Según dónde esté, conviene dejarlas llegar a tu red local o bloquearlas.')}</Head>
          <Body>
            <SecurityForm s={s} actions={nav(onBack, onNext)} quiet />
          </Body>
        </>
      )
    case 'done':
      return <Done s={s} onBack={onBack} />
  }
}

/* ── 8. Listo ─────────────────────────────────────────────────── */

function Done({ s, onBack }: { s: AdminSettings; onBack: () => void }) {
  const save = useSaveSettings()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const social = (['google', 'github'] as const).filter((p) => s.providers[p].enabled).map((p) => (p === 'google' ? 'Google' : 'GitHub'))
  const summary: { label: string; value: string; ok: boolean }[] = [
    { label: t('Nombre'), value: s.instanceName, ok: true },
    { label: t('URL pública'), value: s.publicUrl, ok: true },
    {
      label: t('Registro'),
      value: !s.allowRegistration ? t('Cerrado, solo con invitación') : s.allowedDomains.length ? t('Solo {0}', [s.allowedDomains.join(', ')]) : t('Abierto'),
      ok: true,
    },
    { label: t('Google y GitHub'), value: social.length ? social.join(' · ') : t('Sin configurar'), ok: social.length > 0 },
    { label: t('Email'), value: s.smtp.configured ? s.smtp.host : t('Sin configurar'), ok: s.smtp.configured },
    { label: t('Peticiones a la red local'), value: s.blockPrivateNetworks ? t('Bloqueadas') : t('Permitidas'), ok: true },
  ]
  const finish = async (to: string) => {
    try {
      await save.mutateAsync({ setupCompleted: true })
      // Antes de salir: si el estado en caché sigue «sin terminar», la app devolvería aquí
      await qc.refetchQueries({ queryKey: ['setup'] })
      localStorage.removeItem(STEP_KEY)
      navigate(to, { replace: true })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <>
      <div className="auth-pop mb-6 flex size-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/30" style={d(0)}>
        <PartyPopper className="size-7" />
      </div>
      <Head title={t('¡Cartero está listo!')}>{t('Esto es lo que has configurado. Puedes cambiarlo cuando quieras en Administración (menú de tu cuenta).')}</Head>
      <Body>
        <dl className="divide-y divide-[var(--border)] rounded-xl border border-app">
          {summary.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-muted">{r.label}</dt>
              <dd className="flex min-w-0 items-center gap-2 text-right font-medium">
                <span className="truncate">{r.value}</span>
                {r.ok ? <CircleCheck className="size-4 shrink-0 text-emerald-500" /> : <span className="size-4 shrink-0 rounded-full border-2 border-app" />}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 rounded-xl border border-app p-4">
          <TelemetrySwitch s={s} />
        </div>
        <div className="mt-4 flex items-start gap-3 rounded-xl bg-soft p-4 text-xs leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" />
          {t('Al entrar te ofreceremos un recorrido guiado y datos de ejemplo con APIs reales. Para invitar a tu equipo: Ajustes → Miembros.')}
        </div>
      </Body>
      <Footer
        onBack={onBack}
        next={
          <>
            <Button onClick={() => void finish('/admin')} className="h-10">
              {t('Ir a Administración')}
            </Button>
            <Button variant="primary" loading={save.isPending} onClick={() => void finish('/')} className="h-10 px-5">
              {t('Entrar en Cartero')}
            </Button>
          </>
        }
      />
    </>
  )
}
