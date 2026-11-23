import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, Globe2, Lock, Send, ShieldCheck, Users, Wifi } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import type { OAuthProvider } from '@/api/types'
import { PROVIDER_NAME, ProviderIcon } from '@/components/ProviderIcon'
import { Badge, Button, Field, Input, Switch, cx } from '@/components/ui'
import { t } from '@/i18n'

/* Formularios de ajustes de la instancia: los usan el panel de administración y el asistente de instalación. */

export interface ProviderInfo {
  enabled: boolean
  clientId: string
  hasSecret: boolean
  callbackUrl: string
}

export interface AdminSettings {
  instanceName: string
  publicUrl: string
  allowRegistration: boolean
  allowedDomains: string[]
  providers: Record<OAuthProvider, ProviderInfo>
  smtp: { configured: boolean; host: string; from: string }
  blockPrivateNetworks: boolean
  updates: { check: boolean; auto: boolean }
  setupCompleted: boolean
}

export const SETTINGS_KEY = ['admin', 'settings']

export function useAdminSettings() {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: () => api.get<AdminSettings>('/api/admin/settings') })
}

/** Guarda un cambio parcial de ajustes y refresca lo que dependa de ellos. */
export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<AdminSettings>('/api/admin/settings', body),
    onSuccess: (data) => {
      qc.setQueryData(SETTINGS_KEY, data)
      qc.invalidateQueries({ queryKey: ['auth-config'] })
      qc.invalidateQueries({ queryKey: ['setup'] })
    },
  })
}

/** Botones de cada formulario: el panel usa «Guardar»; el asistente pone «Atrás / Continuar». */
export type Actions = (a: { dirty: boolean; saving: boolean; submit: () => Promise<boolean> }) => ReactNode

function DefaultActions({ dirty, saving, submit }: Parameters<Actions>[0]) {
  return (
    <div className="flex justify-end">
      <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void submit()}>
        {t('Guardar')}
      </Button>
    </div>
  )
}

/** quiet: sin aviso «Guardado» (en el asistente, pasar al paso siguiente ya lo confirma) */
function useSubmit(build: () => Record<string, unknown> | null, quiet = false) {
  const save = useSaveSettings()
  const submit = async () => {
    const body = build()
    if (!body) return false
    if (!Object.keys(body).length) return true
    try {
      await save.mutateAsync(body)
      if (!quiet) toast.success(t('Guardado'))
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    }
  }
  return { submit, saving: save.isPending }
}

/** Tarjeta para elegir una opción entre varias (registro, exposición a Internet…). */
export function ChoiceCard({ selected, onSelect, icon, title, children }: { selected: boolean; onSelect: () => void; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cx(
        'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-all',
        selected ? 'border-brand-500 bg-brand-500/[0.06] ring-4 ring-brand-500/10' : 'border-app bg-app hover:border-zinc-300 dark:hover:border-zinc-600',
      )}
    >
      <span className={cx('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg [&>svg]:size-[18px]', selected ? 'bg-brand-600 text-white' : 'bg-muted text-muted')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-app">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted">{children}</span>
      </span>
      <span className={cx('mt-1 flex size-[18px] shrink-0 items-center justify-center rounded-full border-2', selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-app')}>
        {selected && <Check className="size-3" strokeWidth={3.5} />}
      </span>
    </button>
  )
}

/* ── General: nombre y URL pública ────────────────────────────── */

export function GeneralForm({ s, actions = DefaultActions, quiet }: { s: AdminSettings; actions?: Actions; quiet?: boolean }) {
  const [name, setName] = useState(s.instanceName)
  const [url, setUrl] = useState(s.publicUrl)
  useEffect(() => {
    setName(s.instanceName)
    setUrl(s.publicUrl)
  }, [s.instanceName, s.publicUrl])
  const here = window.location.origin
  const dirty = name !== s.instanceName || url !== s.publicUrl
  const { submit, saving } = useSubmit(() => (dirty ? { instanceName: name.trim(), publicUrl: url.trim() } : {}), quiet)
  return (
    <div className="space-y-5">
      <Field label={t('Nombre de la instancia')} hint={t('Aparece en los emails y en el título de la página.')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Cartero" />
      </Field>
      <Field
        label={t('URL pública')}
        hint={t('La dirección con la que se entra a Cartero. Se usa en las invitaciones, los callbacks de Google y GitHub y los avisos de los monitores.')}
      >
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cartero.empresa.com" spellCheck={false} className="font-mono text-xs" />
      </Field>
      {url.replace(/\/$/, '') !== here && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
          <span>{t('Ahora mismo has entrado por {0}.', [here])}</span>
          <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => setUrl(here)}>
            {t('Usar esta URL')}
          </button>
        </div>
      )}
      {actions({ dirty, saving, submit })}
    </div>
  )
}

/* ── Acceso: registro abierto, por dominio o cerrado ──────────── */

type AccessMode = 'open' | 'domains' | 'closed'

export function AccessForm({ s, actions = DefaultActions, quiet }: { s: AdminSettings; actions?: Actions; quiet?: boolean }) {
  const initialMode: AccessMode = !s.allowRegistration ? 'closed' : s.allowedDomains.length ? 'domains' : 'open'
  const [mode, setMode] = useState<AccessMode>(initialMode)
  const [domains, setDomains] = useState(s.allowedDomains.join(', '))
  useEffect(() => {
    setMode(initialMode)
    setDomains(s.allowedDomains.join(', '))
  }, [s.allowRegistration, s.allowedDomains.join(',')])
  const list = domains
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
  const dirty = mode !== initialMode || (mode === 'domains' && list.join(',') !== s.allowedDomains.join(','))
  const { submit, saving } = useSubmit(() => {
    if (mode === 'domains' && !list.length) {
      toast.error(t('Escribe al menos un dominio'))
      return null
    }
    if (!dirty) return {}
    if (mode === 'open') return { allowRegistration: true, allowedDomains: [] }
    if (mode === 'domains') return { allowRegistration: true, allowedDomains: list }
    return { allowRegistration: false }
  }, quiet)
  return (
    <div className="space-y-3" role="radiogroup" aria-label={t('Quién puede crear una cuenta nueva.')}>
      <ChoiceCard selected={mode === 'open'} onSelect={() => setMode('open')} icon={<Users />} title={t('Abierto')}>
        {t('Cualquiera con acceso a esta URL puede crearse una cuenta, también con Google o GitHub.')}
      </ChoiceCard>
      <ChoiceCard selected={mode === 'domains'} onSelect={() => setMode('domains')} icon={<Globe2 />} title={t('Solo mi empresa')}>
        {t('Solo emails de los dominios que elijas (subdominios incluidos). Las invitaciones no se ven afectadas.')}
      </ChoiceCard>
      {mode === 'domains' && (
        <div className="pl-12">
          <Input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="empresa.com, empresa.es" aria-label={t('Dominios permitidos')} autoFocus />
        </div>
      )}
      <ChoiceCard selected={mode === 'closed'} onSelect={() => setMode('closed')} icon={<Lock />} title={t('Cerrado')}>
        {t('Solo pueden entrar las cuentas que ya existen y las personas invitadas a un workspace.')}
      </ChoiceCard>
      <div className="pt-2">{actions({ dirty, saving, submit })}</div>
    </div>
  )
}

/* ── Google y GitHub ──────────────────────────────────────────── */

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

export function ProviderCard({ provider, info }: { provider: OAuthProvider; info: ProviderInfo }) {
  const save = useSaveSettings()
  const [clientId, setClientId] = useState(info.clientId)
  const [secret, setSecret] = useState('')
  useEffect(() => {
    setClientId(info.clientId)
    setSecret('')
  }, [info.clientId, info.hasSecret])
  const dirty = clientId !== info.clientId || secret !== ''
  const ready = !!clientId && (info.hasSecret || !!secret)
  const name = PROVIDER_NAME[provider]
  const send = async (body: Record<string, unknown>) => {
    try {
      await save.mutateAsync({ providers: { [provider]: body } })
      toast.success(t('Guardado'))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <section className="rounded-xl border border-app bg-app p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h3 className="flex items-center gap-2.5 text-[15px] font-semibold">
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
        </h3>
        <Switch
          checked={info.enabled}
          onChange={(v) => {
            if (v && !ready) return toast.error(t('Rellena el Client ID y el Client secret antes de activarlo'))
            void send({ enabled: v, ...(dirty ? { clientId, ...(secret ? { clientSecret: secret } : {}) } : {}) })
          }}
          label={<span className="sr-only">{t('Activar {0}', [name])}</span>}
        />
      </div>
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
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={info.hasSecret ? '••••••••••••' : ''} autoComplete="new-password" />
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
          <Button variant="primary" size="sm" loading={save.isPending} disabled={!dirty} onClick={() => void send({ clientId, ...(secret ? { clientSecret: secret } : {}) })}>
            {t('Guardar credenciales')}
          </Button>
        </div>
      </div>
    </section>
  )
}

/* ── Email (SMTP) ─────────────────────────────────────────────── */

export function EmailForm({ s, actions = DefaultActions, myEmail, quiet }: { s: AdminSettings; actions?: Actions; myEmail?: string; quiet?: boolean }) {
  const [url, setUrl] = useState('')
  const [from, setFrom] = useState(s.smtp.from)
  const [testing, setTesting] = useState(false)
  useEffect(() => {
    setUrl('')
    setFrom(s.smtp.from)
  }, [s.smtp.configured, s.smtp.host, s.smtp.from])
  const dirty = url !== '' || from !== s.smtp.from
  const { submit, saving } = useSubmit(() => (dirty ? { smtp: { ...(url ? { url: url.trim() } : {}), from: from.trim() } } : {}), quiet)
  const test = async () => {
    setTesting(true)
    try {
      const r = await api.post<{ to: string }>('/api/admin/test-email', { url: url.trim() || undefined, from: from.trim() || undefined })
      toast.success(t('Email de prueba enviado a {0}', [r.to]))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setTesting(false)
    }
  }
  return (
    <div className="space-y-5">
      {s.smtp.configured && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
          <span className="flex items-center gap-2">
            <Check className="size-4" />
            {t('Configurado con {0}', [s.smtp.host || 'SMTP'])}
          </span>
          <SaveButton label={t('Quitar')} onClick={() => ({ smtp: { url: '' } })} />
        </div>
      )}
      <Field
        label={t('URL del servidor SMTP')}
        hint={
          <>
            {s.smtp.configured ? t('Guardada y cifrada. Escribe una nueva para cambiarla.') : t('Con usuario y contraseña dentro de la URL.')}{' '}
            <span className="font-mono">smtps://usuario:contraseña@smtp.ejemplo.com:465</span>
          </>
        }
      >
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={s.smtp.configured ? '••••••••••••' : 'smtps://…'} spellCheck={false} autoComplete="off" className="font-mono text-xs" />
      </Field>
      <Field label={t('Remitente')} hint={t('Nombre y dirección de los emails que envía Cartero.')}>
        <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Cartero <no-reply@empresa.com>" />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-soft px-3 py-2.5 text-xs text-muted">
        <span>{t('Sirve para enviar invitaciones y avisos de monitores por email. Sin email, las invitaciones se comparten con un enlace.')}</span>
        <Button size="sm" icon={<Send />} loading={testing} disabled={!url && !s.smtp.configured} onClick={() => void test()}>
          {myEmail ? t('Probar (a {0})', [myEmail]) : t('Enviar prueba')}
        </Button>
      </div>
      {actions({ dirty, saving, submit })}
    </div>
  )
}

function SaveButton({ label, onClick }: { label: string; onClick: () => Record<string, unknown> }) {
  const save = useSaveSettings()
  return (
    <button
      type="button"
      className="font-semibold underline-offset-2 hover:underline"
      onClick={() =>
        save.mutate(onClick(), {
          onSuccess: () => toast.success(t('Guardado')),
          onError: (e) => toast.error(e.message),
        })
      }
    >
      {label}
    </button>
  )
}

/* ── Seguridad ────────────────────────────────────────────────── */

export function SecurityForm({ s, actions = DefaultActions, quiet }: { s: AdminSettings; actions?: Actions; quiet?: boolean }) {
  const [block, setBlock] = useState(s.blockPrivateNetworks)
  useEffect(() => setBlock(s.blockPrivateNetworks), [s.blockPrivateNetworks])
  const dirty = block !== s.blockPrivateNetworks
  const { submit, saving } = useSubmit(() => (dirty ? { blockPrivateNetworks: block } : {}), quiet)
  return (
    <div className="space-y-3" role="radiogroup" aria-label={t('Dónde está tu instancia')}>
      <ChoiceCard selected={!block} onSelect={() => setBlock(false)} icon={<Wifi />} title={t('Red privada, VPN o homelab')}>
        {t('Solo entra gente de confianza. Las peticiones pueden llegar a tu red local (localhost, 192.168.x.x…), útil para probar tus servicios internos.')}
      </ChoiceCard>
      <ChoiceCard selected={block} onSelect={() => setBlock(true)} icon={<ShieldCheck />} title={t('Expuesta a Internet')}>
        {t('Recomendado si cualquiera puede registrarse. Cartero bloquea las peticiones a IPs privadas para que nadie lo use para entrar en tu red (protección SSRF).')}
      </ChoiceCard>
      <div className="pt-2">{actions({ dirty, saving, submit })}</div>
    </div>
  )
}

