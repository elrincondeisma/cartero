import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Check,
  CircleAlert,
  ExternalLink,
  FolderPlus,
  Globe,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@/api/client'
import { qk } from '@/api/hooks'
import { Badge, Button, Checkbox, Dialog, Input, Select, cx } from '@/components/ui'
import { t, tServer } from '@/i18n'
import { useWs } from '../workspace/context'

const KEYS_URL = 'https://go.postman.co/settings/me/api-keys'

interface Target {
  id: string
  name: string
  role: string
}

interface Connection {
  user: { name: string; username: string; avatar: string | null; team: string | null }
  usage: { limit: number; usage: number } | null
  workspaces: { id: string; name: string; type: string }[]
  targets: Target[]
}

interface Entry {
  uid: string
  name: string
  imported: { workspaceId: string; id: string } | null
}

interface Contents {
  id: string
  name: string
  collections: Entry[]
  environments: Entry[]
  mocks: number
  monitors: number
  apis: number
}

interface Choice {
  loading: boolean
  error?: string
  contents?: Contents
  cols: Set<string>
  envs: Set<string>
  globals: boolean
  /** id de un workspace de Cartero, o 'new' */
  target: string
}

type Event =
  | { type: 'start'; total: number }
  | { type: 'progress'; done: number; total: number; label: string }
  | {
      type: 'item'
      kind: 'collection' | 'environment' | 'globals' | 'workspace'
      name: string
      action: 'created' | 'updated'
      workspaceId: string
      count?: number
    }
  | { type: 'warning'; kind: 'secrets'; name: string; count: number; message: string }
  | { type: 'error'; name: string; message: string }
  | { type: 'done'; calls: number; created: number; updated: number; failed: number }

type Step = 'connect' | 'choose' | 'importing' | 'done'

/** Importar desde Postman con su API: conectar con la API key, elegir y ver cómo se importa. */
export function PostmanImportDialog({
  open,
  onOpenChange,
  onUseFiles,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onUseFiles?: () => void
}) {
  const { ws } = useWs()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [step, setStep] = useState<Step>('connect')
  const [apiKey, setApiKey] = useState('')
  const [conn, setConn] = useState<Connection | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState('')
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [events, setEvents] = useState<Event[]>([])

  // Al cerrar se olvida todo, también la key
  useEffect(() => {
    if (open) return
    const id = setTimeout(() => {
      setStep('connect')
      setApiKey('')
      setConn(null)
      setConnectError('')
      setChoices({})
      setEvents([])
    }, 200)
    return () => clearTimeout(id)
  }, [open])

  const busy = step === 'importing'
  const close = () => !busy && onOpenChange(false)

  const connect = async (e?: FormEvent) => {
    e?.preventDefault()
    setConnecting(true)
    setConnectError('')
    try {
      const c = await api.post<Connection>('/api/postman/connect', { apiKey: apiKey.trim() })
      setConn(c)
      setStep('choose')
      if (c.workspaces.length === 1) toggleWorkspace(c, c.workspaces[0].id)
    } catch (err) {
      setConnectError((err as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  /** Destino por defecto: donde ya se importó; si no, el workspace actual para el personal y uno nuevo para los de equipo. */
  const defaultTarget = (c: Connection, contents: Contents, type: string) => {
    const prev = [...contents.collections, ...contents.environments].find((x) => x.imported)?.imported
      ?.workspaceId
    if (prev && c.targets.some((t) => t.id === prev)) return prev
    if (type === 'personal' && c.targets.some((t) => t.id === ws)) return ws
    return 'new'
  }

  const toggleWorkspace = async (c: Connection, id: string) => {
    if (choices[id]) {
      setChoices(({ [id]: _, ...rest }) => rest)
      return
    }
    setChoices((s) => ({
      ...s,
      [id]: { loading: true, cols: new Set(), envs: new Set(), globals: true, target: 'new' },
    }))
    try {
      const contents = await api.post<Contents>(`/api/postman/workspaces/${id}`, { apiKey: apiKey.trim() })
      const type = c.workspaces.find((w) => w.id === id)?.type ?? 'team'
      setChoices((s) =>
        s[id]
          ? {
              ...s,
              [id]: {
                loading: false,
                contents,
                cols: new Set(contents.collections.map((x) => x.uid)),
                envs: new Set(contents.environments.map((x) => x.uid)),
                globals: true,
                target: defaultTarget(c, contents, type),
              },
            }
          : s,
      )
    } catch (err) {
      setChoices((s) =>
        s[id] ? { ...s, [id]: { ...s[id], loading: false, error: (err as Error).message } } : s,
      )
    }
  }

  const update = (id: string, f: (c: Choice) => Choice) => setChoices((s) => ({ ...s, [id]: f(s[id]) }))

  const ready = Object.entries(choices).filter(([, c]) => c.contents)
  const totals = ready.reduce(
    (n, [, c]) => ({
      cols: n.cols + c.cols.size,
      envs: n.envs + c.envs.size,
      globals: n.globals + (c.globals ? 1 : 0),
    }),
    { cols: 0, envs: 0, globals: 0 },
  )
  const nothing = totals.cols + totals.envs + totals.globals === 0
  const loadingAny = Object.values(choices).some((c) => c.loading)

  const start = async () => {
    if (!conn) return
    setStep('importing')
    setEvents([])
    const body = {
      apiKey: apiKey.trim(),
      workspaces: ready
        .filter(([, c]) => c.cols.size || c.envs.size || c.globals)
        .map(([id, c]) => ({
          postmanId: id,
          name: c.contents!.name,
          targetId: c.target === 'new' ? null : c.target,
          newName: c.contents!.name,
          collections: c
            .contents!.collections.filter((x) => c.cols.has(x.uid))
            .map(({ uid, name }) => ({ uid, name })),
          environments: c
            .contents!.environments.filter((x) => c.envs.has(x.uid))
            .map(({ uid, name }) => ({ uid, name })),
          globals: c.globals,
        })),
    }
    const push = (e: Event) => setEvents((list) => [...list, e])
    try {
      const res = await fetch('/api/postman/import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        throw new Error(tServer(data.message ?? `Error ${res.status}`))
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const l of lines) if (l.trim()) push(JSON.parse(l))
      }
    } catch (err) {
      push({ type: 'error', name: 'Cartero', message: (err as Error).message })
      push({ type: 'done', calls: 0, created: 0, updated: 0, failed: 1 })
    }
    qc.invalidateQueries({ queryKey: qk.workspaces })
    qc.invalidateQueries({ queryKey: ['collections'] })
    qc.invalidateQueries({ queryKey: ['environments'] })
    qc.invalidateQueries({ queryKey: ['globals'] })
    setStep('done')
  }

  const stepIndex = { connect: 0, choose: 1, importing: 2, done: 3 }[step]

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title={
        <span className="flex items-center gap-2">
          <PostmanMark /> {t('Importar desde Postman')}
        </span>
      }
      description={<Stepper index={stepIndex} />}
      width="max-w-3xl"
      footer={
        step === 'connect' ? (
          <>
            {onUseFiles && (
              <Button variant="ghost" className="mr-auto" onClick={onUseFiles}>
                {t('Prefiero importar ficheros')}
              </Button>
            )}
            <Button variant="ghost" onClick={close}>
              {t('Cancelar')}
            </Button>
            <Button
              variant="primary"
              onClick={() => connect()}
              loading={connecting}
              disabled={apiKey.trim().length < 10}
            >
              {t('Conectar')}
            </Button>
          </>
        ) : step === 'choose' ? (
          <>
            <Button variant="ghost" className="mr-auto" onClick={() => setStep('connect')}>
              {t('Cambiar de cuenta')}
            </Button>
            <span className="self-center text-xs text-muted">{summaryText(totals)}</span>
            <Button variant="primary" onClick={start} disabled={nothing || loadingAny}>
              {t('Importar')} <ArrowRight className="size-3.5" />
            </Button>
          </>
        ) : step === 'importing' ? (
          <Button variant="ghost" disabled>
            {t('Importando…')}
          </Button>
        ) : (
          <DoneActions
            events={events}
            onOpen={(id) => {
              onOpenChange(false)
              nav(`/w/${id}`)
            }}
            onClose={close}
            onAgain={() => setStep('choose')}
            currentWs={ws}
          />
        )
      }
    >
      {step === 'connect' && (
        <ConnectStep apiKey={apiKey} setApiKey={setApiKey} onSubmit={connect} error={connectError} />
      )}
      {step === 'choose' && conn && (
        <ChooseStep
          conn={conn}
          choices={choices}
          onToggle={(id) => toggleWorkspace(conn, id)}
          update={update}
        />
      )}
      {(step === 'importing' || step === 'done') && (
        <ProgressStep events={events} finished={step === 'done'} />
      )}
    </Dialog>
  )
}

function summaryText(n: { cols: number; envs: number; globals: number }) {
  const parts: string[] = []
  if (n.cols) parts.push(t('{0} colección(es)', [n.cols]))
  if (n.envs) parts.push(t('{0} entorno(s)', [n.envs]))
  if (n.globals) parts.push(t('globales'))
  return parts.join(' · ')
}

/** Marca de Postman (círculo naranja con el sobre), solo para identificar el origen. */
export function PostmanMark({ className = 'size-5' }: { className?: string }) {
  return (
    <span
      className={cx('grid place-items-center rounded-full bg-[#FF6C37] text-white', className)}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className="size-[62%]"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 2 11 13" />
        <path d="m22 2-7 20-4-9-9-4 20-7z" />
      </svg>
    </span>
  )
}

function Stepper({ index }: { index: number }) {
  const steps = [t('Conectar'), t('Elegir'), t('Importar')]
  return (
    <span className="mt-1.5 flex items-center gap-1.5 text-xs">
      {steps.map((s, i) => (
        <span key={s} className="flex items-center gap-1.5">
          {i > 0 && <span className={cx('h-px w-5', i <= index ? 'bg-brand-500' : 'bg-[var(--border)]')} />}
          <span
            className={cx(
              'grid size-4 place-items-center rounded-full text-[10px] font-semibold',
              i < index
                ? 'bg-brand-600 text-white'
                : i === index
                  ? 'bg-brand-500/15 text-brand-700 ring-1 ring-brand-500'
                  : 'bg-muted text-muted',
            )}
          >
            {i < index ? <Check className="size-2.5" strokeWidth={3} /> : i + 1}
          </span>
          <span className={cx(i === index ? 'font-medium text-app' : 'text-muted')}>{s}</span>
        </span>
      ))}
    </span>
  )
}

function ConnectStep({
  apiKey,
  setApiKey,
  onSubmit,
  error,
}: {
  apiKey: string
  setApiKey: (v: string) => void
  onSubmit: (e: FormEvent) => void
  error: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div className="auth-rise grid gap-6 sm:grid-cols-[1fr_15rem]">
      <form onSubmit={onSubmit} className="space-y-4">
        <p className="leading-relaxed">
          {t(
            'Trae tus workspaces de Postman con todo dentro: colecciones con sus carpetas, scripts y autenticación, entornos y variables globales. Si vuelves a importar más adelante, se actualiza lo que ya trajiste en lugar de duplicarlo.',
          )}
        </p>
        <ol className="space-y-2.5">
          <Howto n={1}>
            {t('Abre')}{' '}
            <a
              href={KEYS_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline dark:text-brand-400"
            >
              {t('tus API keys de Postman')} <ExternalLink className="size-3" />
            </a>
          </Howto>
          <Howto n={2}>
            {t('Pulsa «Generate API Key», ponle un nombre (por ejemplo, «Cartero») y cópiala.')}
          </Howto>
          <Howto n={3}>{t('Pégala aquí:')}</Howto>
        </ol>
        <div>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <Input
              ref={ref}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="PMAK-…"
              className={cx('h-10 pl-9 font-mono', error && 'auth-shake border-red-500')}
            />
          </div>
          {error && (
            <p className="mt-2 flex items-start gap-1.5 text-red-600 dark:text-red-400">
              <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          )}
        </div>
        <button type="submit" className="hidden" />
      </form>
      <aside className="space-y-3 rounded-lg bg-soft p-4 text-xs leading-relaxed text-muted">
        <p className="flex items-start gap-2">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-app" />
          <span>
            <strong className="text-app">{t('Tu key no se guarda.')}</strong>{' '}
            {t(
              'Solo se usa mientras dura la importación y se olvida al cerrar esta ventana. Puedes borrarla en Postman cuando acabes.',
            )}
          </span>
        </p>
        <p className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-app" />
          <span>
            {t(
              'Postman no comparte los valores «actuales» de las variables ni los secretos del Vault: llegan los valores iniciales y te avisamos de los que falten.',
            )}
          </span>
        </p>
      </aside>
    </div>
  )
}

function Howto({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold">
        {n}
      </span>
      <span className="pt-px">{children}</span>
    </li>
  )
}

function ChooseStep({
  conn,
  choices,
  onToggle,
  update,
}: {
  conn: Connection
  choices: Record<string, Choice>
  onToggle: (id: string) => void
  update: (id: string, f: (c: Choice) => Choice) => void
}) {
  return (
    <div className="auth-rise space-y-4">
      <div className="flex items-center gap-3 rounded-lg border border-app px-3 py-2.5">
        {conn.user.avatar ? (
          <img src={conn.user.avatar} alt="" className="size-8 rounded-full" />
        ) : (
          <span className="grid size-8 place-items-center rounded-full bg-[#FF6C37]/15 font-semibold text-[#d9480f]">
            {conn.user.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{conn.user.name}</div>
          <div className="truncate text-xs text-muted">
            @{conn.user.username}
            {conn.user.team && ` · ${conn.user.team}`}
          </div>
        </div>
        {conn.usage && <Usage {...conn.usage} />}
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-muted">
          {t('Elige qué workspaces traer ({0} en tu cuenta)', [conn.workspaces.length])}
        </div>
        {conn.workspaces.length === 0 && (
          <p className="text-muted">{t('Esta cuenta de Postman no tiene workspaces.')}</p>
        )}
        <ul className="space-y-2">
          {conn.workspaces.map((w) => {
            const c = choices[w.id]
            return (
              <li
                key={w.id}
                className={cx(
                  'rounded-lg border transition-colors',
                  c ? 'border-brand-500/60 bg-brand-500/[0.03]' : 'border-app',
                )}
              >
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                  <Checkbox checked={!!c} onChange={() => onToggle(w.id)} />
                  {w.type === 'personal' ? (
                    <Layers className="size-4 text-muted" />
                  ) : (
                    <Users className="size-4 text-muted" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{w.name}</span>
                  <span className="text-xs text-muted">
                    {w.type === 'personal' ? t('Personal') : t('Equipo')}
                  </span>
                  {c?.loading && <Loader2 className="size-4 animate-spin text-muted" />}
                </label>
                {c?.error && (
                  <p className="flex items-center gap-1.5 px-3 pb-3 text-red-600 dark:text-red-400">
                    <CircleAlert className="size-4" /> {c.error}
                  </p>
                )}
                {c?.contents && (
                  <WorkspaceChoice choice={c} targets={conn.targets} onChange={(f) => update(w.id, f)} />
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function Usage({ limit, usage }: { limit: number; usage: number }) {
  const pct = limit ? Math.min(100, (usage / limit) * 100) : 0
  return (
    <div className="w-48 shrink-0 text-right text-xs" title={t('Llamadas a la API de Postman este mes')}>
      <div className="whitespace-nowrap text-muted">
        {t('Cupo de la API: {0} de {1}', [usage.toLocaleString(), limit.toLocaleString()])}
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cx('h-full rounded-full', pct > 85 ? 'bg-red-500' : 'bg-[#FF6C37]')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function WorkspaceChoice({
  choice,
  targets,
  onChange,
}: {
  choice: Choice
  targets: Target[]
  onChange: (f: (c: Choice) => Choice) => void
}) {
  const contents = choice.contents!
  const toggle = (kind: 'cols' | 'envs', uid: string) =>
    onChange((c) => {
      const next = new Set(c[kind])
      next.has(uid) ? next.delete(uid) : next.add(uid)
      return { ...c, [kind]: next }
    })
  const setAll = (kind: 'cols' | 'envs', on: boolean) =>
    onChange((c) => ({
      ...c,
      [kind]: new Set(
        on ? (kind === 'cols' ? contents.collections : contents.environments).map((x) => x.uid) : [],
      ),
    }))
  const skipped = [
    contents.mocks && t('{0} mock(s)', [contents.mocks]),
    contents.monitors && t('{0} monitor(es)', [contents.monitors]),
    contents.apis && t('{0} API(s)', [contents.apis]),
  ].filter(Boolean)
  const updates = [...contents.collections, ...contents.environments].filter(
    (x) => x.imported && x.imported.workspaceId === choice.target,
  ).length

  return (
    <div className="space-y-3 border-t border-app px-3 pt-3 pb-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Group
          title={t('Colecciones')}
          entries={contents.collections}
          selected={choice.cols}
          target={choice.target}
          onToggle={(uid) => toggle('cols', uid)}
          onAll={(on) => setAll('cols', on)}
        />
        <Group
          title={t('Entornos')}
          masculine
          entries={contents.environments}
          selected={choice.envs}
          target={choice.target}
          onToggle={(uid) => toggle('envs', uid)}
          onAll={(on) => setAll('envs', on)}
        />
      </div>
      <Checkbox
        checked={choice.globals}
        onChange={(v) => onChange((c) => ({ ...c, globals: v }))}
        label={
          <span className="flex items-center gap-1.5">
            <Globe className="size-3.5 text-muted" /> {t('Variables globales')}
          </span>
        }
      />
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-soft px-3 py-2">
        <FolderPlus className="size-4 text-muted" />
        <span className="text-xs text-muted">{t('Guardar en')}</span>
        <Select
          value={choice.target}
          onChange={(e) => onChange((c) => ({ ...c, target: e.target.value }))}
          className="h-7 min-w-0 flex-1 text-xs"
        >
          <option value="new">{t('Un workspace nuevo: «{0}»', [contents.name])}</option>
          {targets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </div>
      {(updates > 0 || skipped.length > 0) && (
        <div className="space-y-1 text-xs text-muted">
          {updates > 0 && (
            <p className="flex items-center gap-1.5">
              <RefreshCw className="size-3.5" />
              {t('{0} elemento(s) ya importado(s) se actualizarán con lo que haya ahora en Postman.', [
                updates,
              ])}
            </p>
          )}
          {skipped.length > 0 && (
            <p>
              {t('No se importan: {0}. Créalos en Cartero a partir de las colecciones.', [
                skipped.join(', '),
              ])}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Group({
  title,
  entries,
  selected,
  target,
  onToggle,
  onAll,
  masculine,
}: {
  masculine?: boolean
  title: string
  entries: Entry[]
  selected: Set<string>
  target: string
  onToggle: (uid: string) => void
  onAll: (on: boolean) => void
}) {
  const all = entries.length > 0 && selected.size === entries.length
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium">
          {title}{' '}
          <span className="text-muted">
            {selected.size}/{entries.length}
          </span>
        </span>
        {entries.length > 1 && (
          <button className="text-muted hover:text-app" onClick={() => onAll(!all)}>
            {all ? (masculine ? t('Ninguno') : t('Ninguna')) : masculine ? t('Todos') : t('Todas')}
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted">{t('No hay.')}</p>
      ) : (
        <ul className="max-h-44 space-y-0.5 overflow-auto pr-1">
          {entries.map((e) => (
            <li key={e.uid}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-soft">
                <Checkbox checked={selected.has(e.uid)} onChange={() => onToggle(e.uid)} />
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                {e.imported && e.imported.workspaceId === target && (
                  <Badge tone="blue" className="shrink-0">
                    {t('se actualiza')}
                  </Badge>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ProgressStep({ events, finished }: { events: Event[]; finished: boolean }) {
  const start = events.find((e) => e.type === 'start') as Extract<Event, { type: 'start' }> | undefined
  const progress = [...events].reverse().find((e) => e.type === 'progress') as
    | Extract<Event, { type: 'progress' }>
    | undefined
  const done = events.find((e) => e.type === 'done') as Extract<Event, { type: 'done' }> | undefined
  const total = start?.total ?? 0
  const count = progress?.done ?? 0
  const pct = finished ? 100 : total ? (count / total) * 100 : 4
  // Al acabar, primero lo que necesita atención
  const rank = (e: Event) => (finished ? (({ error: 0, warning: 1 }) as Record<string, number>)[e.type] ?? 2 : 0)
  const log = events
    .filter((e) => e.type === 'item' || e.type === 'error' || e.type === 'warning')
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i)
    .map(({ e }) => e)
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTo({ top: finished ? 0 : el.scrollHeight, behavior: 'smooth' })
  }, [log.length, finished])

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate font-medium">
            {finished
              ? done && done.failed === 0
                ? t('Importación terminada')
                : t('Importación terminada con errores')
              : progress
                ? t('Trayendo tus datos de Postman…')
                : t('Conectando con Postman…')}
          </span>
          <span className="shrink-0 text-xs text-muted tabular-nums">
            {count}/{total}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cx(
              'relative h-full overflow-hidden rounded-full transition-[width] duration-500 ease-out',
              finished && done?.failed ? 'bg-amber-500' : 'bg-brand-600',
            )}
            style={{ width: `${pct}%` }}
          >
            {!finished && (
              <span className="absolute inset-y-0 w-1/3 animate-[auth-shimmer_1.4s_ease-in-out_infinite] bg-white/30" />
            )}
          </div>
        </div>
      </div>

      {finished && done && <Totals done={done} />}

      <ul ref={listRef} className="max-h-72 space-y-1 overflow-auto rounded-lg border border-app p-2">
        {log.length === 0 && (
          <li className="flex items-center gap-2 px-2 py-1.5 text-muted">
            <Loader2 className="size-4 animate-spin" /> {t('Preparando…')}
          </li>
        )}
        {log.map((e, i) => (
          <LogLine key={i} e={e} />
        ))}
      </ul>
    </div>
  )
}

function Totals({ done }: { done: Extract<Event, { type: 'done' }> }) {
  const items = [
    { n: done.created, label: t('nuevos'), tone: 'text-green-600 dark:text-green-400' },
    { n: done.updated, label: t('actualizados'), tone: 'text-blue-600 dark:text-blue-400' },
    {
      n: done.failed,
      label: t('con error'),
      tone: done.failed ? 'text-red-600 dark:text-red-400' : 'text-muted',
    },
  ]
  return (
    <div className="auth-rise grid grid-cols-3 gap-2">
      {items.map((x) => (
        <div key={x.label} className="rounded-lg bg-soft px-3 py-2.5">
          <div className={cx('text-2xl font-semibold tabular-nums', x.tone)}>{x.n}</div>
          <div className="text-xs text-muted">{x.label}</div>
        </div>
      ))}
      {done.calls > 0 && (
        <p className="col-span-3 text-xs text-muted">
          {t('Se han usado {0} llamadas de tu cupo de la API de Postman.', [done.calls])}
        </p>
      )}
    </div>
  )
}

function LogLine({ e }: { e: Event }) {
  if (e.type === 'error')
    return (
      <li className="flex items-start gap-2 rounded px-2 py-1.5 text-red-700 dark:text-red-400">
        <X className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0">
          <strong className="font-medium">{e.name}</strong> — {tServer(e.message)}
        </span>
      </li>
    )
  if (e.type === 'warning')
    return (
      <li className="flex items-start gap-2 rounded bg-amber-500/10 px-2 py-1.5 text-amber-800 dark:text-amber-300">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span className="min-w-0">
          {t('«{0}»: {1} variable(s) secreta(s) han llegado vacías. Postman no comparte sus valores; rellénalas en Cartero.', [e.name, e.count])}
        </span>
      </li>
    )
  if (e.type !== 'item') return null
  const kind = {
    workspace: t('Workspace creado'),
    collection: e.action === 'created' ? t('Colección importada') : t('Colección actualizada'),
    environment: e.action === 'created' ? t('Entorno importado') : t('Entorno actualizado'),
    globals: t('{0} variable(s) global(es)', [e.count ?? 0]),
  }[e.kind]
  return (
    <li className="auth-rise flex items-center gap-2 rounded px-2 py-1.5">
      {e.action === 'updated' ? (
        <RefreshCw className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
      ) : (
        <Check className="size-4 shrink-0 text-green-600 dark:text-green-400" />
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{e.name}</span>
      <span className="shrink-0 text-xs text-muted">{kind}</span>
    </li>
  )
}

function DoneActions({
  events,
  onOpen,
  onClose,
  onAgain,
  currentWs,
}: {
  events: Event[]
  onOpen: (ws: string) => void
  onClose: () => void
  onAgain: () => void
  currentWs: string
}) {
  // Workspace al que llevar: el primero con algo importado (el nuevo, si se creó uno)
  const target = useMemo(() => {
    const items = events.filter((e) => e.type === 'item') as Extract<Event, { type: 'item' }>[]
    return items.find((e) => e.kind === 'workspace')?.workspaceId ?? items[0]?.workspaceId
  }, [events])
  return (
    <>
      <Button variant="ghost" className="mr-auto" onClick={onAgain}>
        {t('Importar algo más')}
      </Button>
      {target && target !== currentWs ? (
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cerrar')}
          </Button>
          <Button variant="primary" onClick={() => onOpen(target)}>
            {t('Abrir el workspace')} <ArrowRight className="size-3.5" />
          </Button>
        </>
      ) : (
        <Button variant="primary" onClick={onClose}>
          {t('Listo')}
        </Button>
      )}
    </>
  )
}
