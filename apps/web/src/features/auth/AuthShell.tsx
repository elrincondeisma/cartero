import { ArrowRight, Check, Eye, EyeOff, Server } from 'lucide-react'
import { type CSSProperties, type InputHTMLAttributes, type ReactNode, forwardRef, useEffect, useState } from 'react'
import { LanguageLinks } from '@/components/LanguageSwitch'
import { Logo } from '@/components/Logo'
import { Spinner, cx } from '@/components/ui'
import { t } from '@/i18n'

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties

/** Pantalla partida: formulario a la izquierda y una escena viva de Cartero a la derecha. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  shake,
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  shake?: number
}) {
  return (
    <div className="flex min-h-full bg-app">
      <div className="relative flex w-full flex-col px-6 py-6 sm:px-10 lg:w-[46%] lg:px-14 xl:w-[42%]">
        <div className="auth-rise" style={d(0)}>
          <Logo size={28} />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px]">
            <div className="auth-rise inline-flex items-center gap-2 rounded-full border border-app bg-soft px-3 py-1 text-xs text-muted" style={d(60)}>
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-500 opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-brand-500" />
              </span>
              {t('Open source · Autoalojado')}
            </div>
            <h1 className="auth-rise mt-5 text-[34px] leading-[1.1] font-bold tracking-[-0.03em] text-app" style={d(120)}>
              {title}
            </h1>
            {subtitle && (
              <p className="auth-rise mt-2.5 text-[15px] leading-relaxed text-muted" style={d(180)}>
                {subtitle}
              </p>
            )}
            <div key={shake} className={cx('mt-8', shake ? 'auth-shake' : '')}>
              {children}
            </div>
            {footer && (
              <div className="auth-rise mt-7 text-center text-[13px] text-muted" style={d(520)}>
                {footer}
              </div>
            )}
          </div>
        </div>
        <div className="auth-rise flex items-center justify-center gap-4 text-xs text-muted sm:justify-between" style={d(600)}>
          <span className="hidden sm:inline">{t('Cartero · cliente de APIs open source')}</span>
          <LanguageLinks />
        </div>
      </div>
      <Showcase />
    </div>
  )
}

/** Campo con icono a la izquierda y etiqueta encima (accesible: la etiqueta envuelve al input). */
export const AuthField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; icon: ReactNode; hint?: ReactNode; delay?: number; trailing?: ReactNode }
>(function AuthField({ label, icon, hint, delay = 0, trailing, className, ...rest }, ref) {
  return (
    <div className="auth-rise" style={d(delay)}>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-app">{label}</span>
        <span className="group relative flex items-center">
          <span className="pointer-events-none absolute left-3.5 text-muted transition-colors group-focus-within:text-brand-500 [&>svg]:size-[18px]">{icon}</span>
          <input
            ref={ref}
            className={cx(
              'h-12 w-full rounded-xl border border-app bg-soft pr-3 pl-11 text-[15px] text-app outline-none transition-all placeholder:text-muted/60',
              'hover:border-zinc-300 focus:border-brand-500 focus:bg-app focus:ring-4 focus:ring-brand-500/15 dark:hover:border-zinc-600',
              trailing ? 'pr-12' : '',
              className,
            )}
            {...rest}
          />
          {trailing && <span className="absolute right-2">{trailing}</span>}
        </span>
      </label>
      {hint}
    </div>
  )
})

/** Campo de contraseña con botón para verla. */
export function PasswordField(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; icon: ReactNode; hint?: ReactNode; delay?: number }) {
  const [show, setShow] = useState(false)
  return (
    <AuthField
      {...props}
      type={show ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-pressed={show}
          aria-label={show ? t('Ocultar') : t('Mostrar')}
          title={show ? t('Ocultar') : t('Mostrar')}
          className="flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-muted hover:text-app"
        >
          {show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
        </button>
      }
    />
  )
}

/** Fuerza orientativa de la contraseña (0-4). */
export function strength(pw: string) {
  if (pw.length < 8) return 0
  let s = 1
  if (pw.length >= 12) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++
  return Math.min(4, s)
}

export function StrengthMeter({ password }: { password: string }) {
  const s = strength(password)
  const labels = [t('Mínimo 8 caracteres'), t('Débil'), t('Aceptable'), t('Buena'), t('Fuerte')]
  const colors = ['bg-zinc-300 dark:bg-zinc-700', 'bg-red-500', 'bg-amber-500', 'bg-lime-500', 'bg-emerald-500']
  return (
    <div className="mt-2 flex items-center gap-3" aria-live="polite">
      <div className="flex flex-1 gap-1.5">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cx('h-1 flex-1 rounded-full transition-all duration-500', password && s >= i ? colors[s] : 'bg-muted')} />
        ))}
      </div>
      <span className={cx('w-32 text-right text-xs transition-colors', s >= 3 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted')}>{password ? labels[s] : labels[0]}</span>
    </div>
  )
}

export function SubmitButton({ loading, children, delay = 0 }: { loading?: boolean; children: ReactNode; delay?: number }) {
  return (
    <div className="auth-rise pt-2" style={d(delay)}>
      <button
        type="submit"
        disabled={loading}
        className="auth-btn group relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-b from-brand-500 to-brand-600 text-[15px] font-semibold text-white shadow-lg shadow-brand-600/25 transition-all hover:shadow-xl hover:shadow-brand-600/35 active:scale-[0.99] disabled:opacity-80"
      >
        {loading ? <Spinner className="size-4 text-white" /> : children}
        {!loading && <ArrowRight className="size-[18px] transition-transform duration-300 group-hover:translate-x-1" />}
      </button>
    </div>
  )
}

/* ── Escena de la derecha ─────────────────────────────────────── */

interface Scenario {
  method: string
  methodColor: string
  url: string
  status: string
  ms: number
  size: string
  body: [string, string][]
  tests: string[]
}

const CYCLE = 6000

function useScenarios(): Scenario[] {
  return [
    {
      method: 'GET',
      methodColor: 'text-emerald-400',
      url: '{{baseUrl}}/users/1',
      status: '200 OK',
      ms: 84,
      size: '509 B',
      body: [
        ['"id"', '1'],
        ['"name"', '"Leanne Graham"'],
        ['"email"', '"Sincere@april.biz"'],
      ],
      tests: [t('El status es 200'), t('Devuelve un email'), t('Responde en menos de 200 ms')],
    },
    {
      method: 'POST',
      methodColor: 'text-amber-400',
      url: '{{baseUrl}}/posts',
      status: '201 Created',
      ms: 142,
      size: '96 B',
      body: [
        ['"id"', '101'],
        ['"title"', '"Hello, Cartero"'],
        ['"userId"', '1'],
      ],
      tests: [t('El status es 201'), t('Devuelve el id'), t('Responde en menos de 200 ms')],
    },
    {
      method: 'GET',
      methodColor: 'text-emerald-400',
      url: '{{weather}}/forecast?city=Madrid',
      status: '200 OK',
      ms: 61,
      size: '1.2 KB',
      body: [
        ['"temperature"', '21.4'],
        ['"wind_speed"', '8.2'],
        ['"is_day"', 'true'],
      ],
      tests: [t('El status es 200'), t('Trae la temperatura'), t('Responde en menos de 200 ms')],
    },
  ]
}

function Showcase() {
  const scenarios = useScenarios()
  const [i, setI] = useState(0)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => setI((n) => n + 1), CYCLE)
    return () => clearInterval(id)
  }, [])
  const s = scenarios[i % scenarios.length]
  const chips: { label: string; cls: string; delay: number }[] = [
    { label: t('Runner sin límites'), cls: '-left-24 -top-6', delay: 0 },
    { label: 'Mock servers', cls: '-right-20 -top-6', delay: 1200 },
    { label: t('Monitores'), cls: '-left-20 -bottom-6', delay: 2400 },
    { label: t('Servidor MCP'), cls: '-right-16 -bottom-6', delay: 600 },
  ]

  return (
    <div
      className="relative hidden flex-1 overflow-hidden bg-[#0c0c0e] text-white lg:flex lg:flex-col lg:items-center lg:justify-center"
      style={{ '--border': 'rgb(255 255 255 / 0.09)' } as CSSProperties}
      aria-hidden
    >
      <div className="auth-grid absolute inset-0" />
      <div className="auth-aurora absolute -top-1/4 left-1/4 size-[70%] rounded-full bg-[radial-gradient(circle,rgba(249,115,22,0.35),transparent_65%)] blur-2xl" />
      <div className="auth-aurora absolute right-0 -bottom-1/3 size-[55%] rounded-full bg-[radial-gradient(circle,rgba(234,88,12,0.18),transparent_65%)] blur-2xl [animation-delay:-9s]" />


      <div className="relative z-20 w-full max-w-[640px] px-8">
        <div className="auth-rise relative mx-auto max-w-[456px]" style={d(250)}>
        {chips.map((c) => (
          <div key={c.label} className={cx('auth-float absolute z-30 hidden xl:block', c.cls)} style={d(c.delay)}>
            <div className="auth-rise flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/80 px-3.5 py-2 text-[13px] font-medium text-zinc-200 shadow-xl backdrop-blur" style={d(500 + c.delay / 3)}>
              <span className="size-1.5 rounded-full bg-brand-500 shadow-[0_0_10px] shadow-brand-500" />
              {c.label}
            </div>
          </div>
        ))}
          <div key={i} className="auth-cycle overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/85 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9),0_0_80px_-20px_rgba(249,115,22,0.35)] backdrop-blur-xl" style={{ '--cycle': `${CYCLE}ms` } as CSSProperties}>
            {/* Barra de ventana */}
            <div className="flex items-center gap-2 border-b border-white/[0.07] bg-zinc-950/60 px-4 py-3">
              <span className="size-2.5 rounded-full bg-[#ff5f57]" />
              <span className="size-2.5 rounded-full bg-[#febc2e]" />
              <span className="size-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-3 flex items-center gap-1.5 text-xs text-zinc-400">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                </span>
                {t('En vivo')}
              </span>
            </div>

            {/* URL */}
            <div className="flex items-center gap-2 p-4">
              <div className="flex h-10 flex-1 items-center gap-3 overflow-hidden rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-[13px]">
                <span className={cx('font-bold', s.methodColor)}>{s.method}</span>
                <span className="text-zinc-200">
                  <span className="auth-type" style={{ '--w': `${s.url.length}ch`, '--n': s.url.length, ...d(250) } as CSSProperties}>
                    <UrlText url={s.url} />
                  </span>
                  <span className="auth-caret ml-px inline-block h-4 w-[2px] translate-y-[3px] bg-brand-500" />
                </span>
              </div>
              <span className="auth-press flex h-10 items-center rounded-lg bg-brand-600 px-4 text-[13px] font-semibold" style={d(1000)}>
                {t('Enviar')}
              </span>
            </div>

            {/* Viaje de la petición */}
            <div className="flex items-center gap-3 px-4 pb-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/40">
                <Logo size={18} withText={false} />
              </div>
              <div className="relative h-9 flex-1">
                <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/15" />
                <div className="auth-packet flex items-center justify-center shadow-[0_0_20px] shadow-brand-500/60" style={d(1100)}>
                  <svg viewBox="0 0 32 32" className="size-3.5" aria-hidden>
                    <path d="M7 11.5 16 17l9-5.5V22a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 7 22z" fill="#fff" />
                    <path d="M7.5 9.5h17L16 15z" fill="#fff" opacity=".85" />
                  </svg>
                </div>
              </div>
              <div className="auth-node flex h-9 shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 text-xs text-zinc-400" style={d(1550)}>
                <Server className="size-4" />
                {t('tu API')}
              </div>
            </div>

            {/* Respuesta */}
            <div className="relative border-t border-white/[0.07] bg-black/25 p-4">
              <div className="auth-out absolute inset-x-4 top-4 space-y-3" style={d(2200)}>
                <div className="h-6 w-40 animate-pulse rounded-md bg-white/[0.06]" />
                {[72, 88, 64, 80].map((w) => (
                  <div key={w} className="h-3.5 animate-pulse rounded bg-white/[0.05]" style={{ width: `${w}%` }} />
                ))}
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="auth-pop rounded-md bg-emerald-500/15 px-2 py-1 font-semibold text-emerald-400" style={d(2250)}>
                  {s.status}
                </span>
                <span className="auth-fade text-zinc-400" style={d(2350)}>
                  {s.ms} ms
                </span>
                <span className="auth-fade text-zinc-500" style={d(2400)}>
                  {s.size}
                </span>
              </div>
              <div className="mt-3 font-mono text-[13px] leading-6">
                <div className="auth-fade text-zinc-500" style={d(2400)}>
                  {'{'}
                </div>
                {s.body.map(([k, v], n) => (
                  <div key={k} className="auth-rise pl-4" style={d(2450 + n * 110)}>
                    <span className="text-sky-300">{k}</span>
                    <span className="text-zinc-500">: </span>
                    <span className={v.startsWith('"') ? 'text-amber-200' : 'text-violet-300'}>{v}</span>
                    {n < s.body.length - 1 && <span className="text-zinc-500">,</span>}
                  </div>
                ))}
                <div className="auth-fade text-zinc-500" style={d(2750)}>
                  {'}'}
                </div>
              </div>
              <div className="auth-fade mt-4 space-y-2 border-t border-white/[0.07] pt-4" style={d(2800)}>
                {s.tests.map((name, n) => (
                  <div key={name + n} className="flex items-center gap-2.5 text-[13px] text-zinc-300">
                    <span className="auth-pop flex size-[18px] items-center justify-center rounded-full bg-emerald-500 text-zinc-950" style={d(3000 + n * 260)}>
                      <Check className="size-3" strokeWidth={3.5} />
                    </span>
                    <span className="auth-fade" style={d(3000 + n * 260)}>
                      {name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="auth-rise mt-10 text-center" style={d(450)}>
          <p className="text-[28px] leading-tight font-bold tracking-[-0.03em] text-balance">
            {t('Todo lo que Postman cobra.')}
            <br />
            <span className="bg-gradient-to-r from-brand-400 to-brand-600 bg-clip-text text-transparent">{t('Gratis, en tu servidor.')}</span>
          </p>
          <p className="mt-3 text-sm text-zinc-400">{t('Open source · MIT · Tus datos se quedan contigo')}</p>
        </div>
      </div>
    </div>
  )
}

/** Resalta las {{variables}} como en el editor. */
function UrlText({ url }: { url: string }) {
  return (
    <>
      {url.split(/(\{\{[^}]+\}\})/).map((part, n) =>
        part.startsWith('{{') ? (
          <span key={n} className="text-brand-400">
            {part}
          </span>
        ) : (
          <span key={n}>{part}</span>
        ),
      )}
    </>
  )
}
