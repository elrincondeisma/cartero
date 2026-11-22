import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, KeyRound, Trash2, UserPlus } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api, download } from '@/api/client'
import { qk } from '@/api/hooks'
import type { Role } from '@/api/types'
import { confirm, prompt } from '@/components/dialogs'
import { Badge, Button, Field, Input, Select, cx, timeAgo } from '@/components/ui'
import { useUi } from '@/store/ui'
import { useWs } from '../workspace/context'
import { DemoSettings } from './DemoSettings'
import { McpSettings } from './McpSettings'

type Tab = 'workspace' | 'members' | 'tokens' | 'ai' | 'profile'

const ROLE_LABEL: Record<Role, string> = { owner: 'Propietario', admin: 'Administrador', editor: 'Editor', viewer: 'Lector' }

export function SettingsPage() {
  const initial = useUi((s) => s.settingsTab) as Tab
  const [tab, setTab] = useState<Tab>(initial)
  useEffect(() => setTab(initial), [initial])
  const items: { id: Tab; label: string }[] = [
    { id: 'workspace', label: 'Workspace' },
    { id: 'members', label: 'Miembros' },
    { id: 'tokens', label: 'Tokens de API' },
    { id: 'ai', label: 'Conectar IA (MCP)' },
    { id: 'profile', label: 'Mi perfil' },
  ]
  return (
    <div className="flex h-full">
      <nav className="w-56 shrink-0 space-y-0.5 border-r border-app bg-soft p-3">
        <h2 className="px-2 pb-2 font-semibold">Ajustes</h2>
        {items.map((i) => (
          <button key={i.id} onClick={() => setTab(i.id)} className={cx('block w-full rounded-md px-2.5 py-1.5 text-left', tab === i.id ? 'bg-app font-medium shadow-sm' : 'text-muted hover:bg-muted')}>
            {i.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-8">
          {tab === 'workspace' && <WorkspaceSettings />}
          {tab === 'members' && <Members />}
          {tab === 'tokens' && <Tokens />}
          {tab === 'ai' && <McpSettings />}
          {tab === 'profile' && <Profile />}
        </div>
      </div>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description && <p className="mt-0.5 mb-4 text-muted">{description}</p>}
      <div className={description ? '' : 'mt-4'}>{children}</div>
    </section>
  )
}

function WorkspaceSettings() {
  const { ws, workspace, isAdmin, role } = useWs()
  const [name, setName] = useState(workspace.name)
  const qc = useQueryClient()
  const nav = useNavigate()
  useEffect(() => setName(workspace.name), [workspace.name])
  return (
    <>
      <Section title="General">
        <div className="flex items-end gap-2">
          <Field label="Nombre" className="flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} />
          </Field>
          {isAdmin && (
            <Button
              variant="primary"
              disabled={!name.trim() || name === workspace.name}
              onClick={async () => {
                await api.patch(`/api/workspaces/${ws}`, { name })
                qc.invalidateQueries({ queryKey: qk.workspaces })
                toast.success('Guardado')
              }}
            >
              Guardar
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">
          Tipo: {workspace.type === 'personal' ? 'personal' : 'equipo'} · Tu rol: {ROLE_LABEL[role]}
        </p>
      </Section>
      <DemoSettings />
      <Section title="Copia de seguridad" description="Exporta todas las colecciones, entornos y globales en un único JSON compatible con Postman (v2.1). Puedes reimportarlo en Cartero.">
        <Button icon={<Download className="size-3.5" />} variant="outline" onClick={() => download(`/api/workspaces/${ws}/export`, 'cartero-export.json')}>
          Exportar workspace
        </Button>
      </Section>
      {role === 'owner' && workspace.type !== 'personal' && (
        <Section title="Zona peligrosa">
          <Button
            variant="danger"
            onClick={async () => {
              if (!(await confirm('Eliminar workspace', `Se eliminará «${workspace.name}» con todas sus colecciones, entornos, mocks y monitores. No se puede deshacer.`, { confirm: 'Eliminar para siempre', danger: true }))) return
              await api.del(`/api/workspaces/${ws}`)
              await qc.invalidateQueries({ queryKey: qk.workspaces })
              nav('/')
            }}
          >
            Eliminar workspace
          </Button>
        </Section>
      )}
    </>
  )
}

function Members() {
  const { ws, isAdmin, role: myRole, me, workspace } = useWs()
  const qc = useQueryClient()
  const nav = useNavigate()
  const { data } = useQuery({
    queryKey: qk.members(ws),
    queryFn: () =>
      api.get<{ members: { id: string; name: string; email: string; role: Role }[]; invitations: { id: string; email: string; role: Role; expiresAt: string }[] }>(`/api/workspaces/${ws}/members`),
  })
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const refresh = () => qc.invalidateQueries({ queryKey: qk.members(ws) })

  const invite = async () => {
    try {
      const r = await api.post<{ link: string; emailSent: boolean }>(`/api/workspaces/${ws}/invitations`, { email, role })
      setEmail('')
      refresh()
      await navigator.clipboard.writeText(r.link).catch(() => {})
      toast.success(r.emailSent ? 'Invitación enviada por email' : 'Enlace de invitación copiado al portapapeles (no hay SMTP configurado)', { description: r.link, duration: 10_000 })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (workspace.type === 'personal')
    return (
      <Section title="Miembros" description="Tu workspace personal es solo tuyo. Para colaborar, crea un workspace de equipo desde el selector de workspaces de la barra superior.">
        <span />
      </Section>
    )

  return (
    <>
      {isAdmin && (
        <Section title="Invitar" description="La persona recibe un enlace para unirse. Los roles: Lector (solo ver y ejecutar), Editor (crear y modificar), Administrador (gestionar miembros).">
          <div className="flex gap-2">
            <Input type="email" placeholder="email@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} className="flex-1" />
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="viewer">Lector</option>
              <option value="editor">Editor</option>
              {myRole === 'owner' && <option value="admin">Administrador</option>}
            </Select>
            <Button variant="primary" icon={<UserPlus className="size-3.5" />} onClick={invite} disabled={!/^\S+@\S+\.\S+$/.test(email)}>
              Invitar
            </Button>
          </div>
        </Section>
      )}
      <Section title={`Miembros (${data?.members.length ?? 0})`}>
        <div className="divide-y divide-[var(--border)] rounded-lg border border-app">
          {data?.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {m.name} {m.id === me.id && <span className="text-muted">(tú)</span>}
                </div>
                <div className="text-xs text-muted">{m.email}</div>
              </div>
              {isAdmin && m.id !== me.id ? (
                <Select
                  value={m.role}
                  onChange={async (e) => {
                    try {
                      await api.patch(`/api/workspaces/${ws}/members/${m.id}`, { role: e.target.value })
                      refresh()
                    } catch (err) {
                      toast.error((err as Error).message)
                    }
                  }}
                  className="h-7 text-xs"
                >
                  {(['viewer', 'editor', 'admin', 'owner'] as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
              ) : (
                <Badge>{ROLE_LABEL[m.role]}</Badge>
              )}
              {(isAdmin || m.id === me.id) && (
                <button
                  className="rounded p-1 text-muted hover:bg-muted hover:text-red-500"
                  title={m.id === me.id ? 'Salir del workspace' : 'Quitar'}
                  onClick={async () => {
                    const self = m.id === me.id
                    if (!(await confirm(self ? 'Salir del workspace' : 'Quitar miembro', self ? 'Perderás el acceso a este workspace.' : `${m.name} perderá el acceso.`, { confirm: self ? 'Salir' : 'Quitar', danger: true }))) return
                    try {
                      await api.del(`/api/workspaces/${ws}/members/${m.id}`)
                      if (self) {
                        await qc.invalidateQueries({ queryKey: qk.workspaces })
                        nav('/')
                      } else refresh()
                    } catch (e) {
                      toast.error((e as Error).message)
                    }
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </Section>
      {!!data?.invitations.length && (
        <Section title="Invitaciones pendientes">
          <div className="divide-y divide-[var(--border)] rounded-lg border border-app">
            {data.invitations.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex-1">{i.email}</span>
                <Badge>{ROLE_LABEL[i.role]}</Badge>
                <span className="text-xs text-muted">caduca {new Date(i.expiresAt).toLocaleDateString()}</span>
                {isAdmin && (
                  <button
                    className="rounded p-1 text-muted hover:text-red-500"
                    onClick={async () => {
                      await api.del(`/api/workspaces/${ws}/invitations/${i.id}`)
                      refresh()
                    }}
                    aria-label="Cancelar invitación"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

function Tokens() {
  const qc = useQueryClient()
  const { ws } = useWs()
  const { data } = useQuery({ queryKey: qk.tokens, queryFn: () => api.get<{ id: string; name: string; prefix: string; lastUsedAt: string | null; createdAt: string }[]>('/api/tokens') })
  const [created, setCreated] = useState<string>()

  const create = async () => {
    const name = await prompt('Nuevo token de API', { label: 'Para qué lo usarás (ej. CI de GitHub)', confirm: 'Crear' })
    if (!name) return
    const r = await api.post<{ token: string }>('/api/tokens', { name })
    setCreated(r.token)
    qc.invalidateQueries({ queryKey: qk.tokens })
  }

  return (
    <>
      <Section
        title="Tokens de API"
        description={
          <>
            Para la CLI (<code>cartero run</code>), integraciones y mocks privados. Envíalos como <code>Authorization: Bearer crt_…</code> o <code>x-api-key</code>. Tienen los mismos permisos que tu usuario.
          </>
        }
      >
        <Button variant="primary" icon={<KeyRound className="size-3.5" />} onClick={create}>
          Crear token
        </Button>
        {created && (
          <div className="mt-4 rounded-lg border border-green-500/40 bg-green-500/8 p-3">
            <div className="mb-1 text-xs font-medium text-green-700 dark:text-green-400">Copia el token ahora: no se volverá a mostrar.</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-xs break-all">{created}</code>
              <Button
                size="sm"
                icon={<Copy className="size-3.5" />}
                onClick={() => {
                  navigator.clipboard.writeText(created)
                  toast.success('Copiado')
                }}
              >
                Copiar
              </Button>
            </div>
          </div>
        )}
        <div className="mt-4 divide-y divide-[var(--border)] rounded-lg border border-app">
          {data?.length === 0 && <div className="p-4 text-center text-muted">No tienes tokens.</div>}
          {data?.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1">
                <div className="font-medium">{t.name}</div>
                <div className="font-mono text-xs text-muted">
                  {t.prefix}… · creado {timeAgo(t.createdAt)} · {t.lastUsedAt ? `usado ${timeAgo(t.lastUsedAt)}` : 'sin usar'}
                </div>
              </div>
              <button
                className="rounded p-1 text-muted hover:text-red-500"
                onClick={async () => {
                  if (!(await confirm('Revocar token', `«${t.name}» dejará de funcionar inmediatamente.`, { confirm: 'Revocar', danger: true }))) return
                  await api.del(`/api/tokens/${t.id}`)
                  qc.invalidateQueries({ queryKey: qk.tokens })
                }}
                aria-label="Revocar"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Uso en CI">
        <pre className="overflow-auto rounded-lg bg-soft p-4 font-mono text-xs leading-relaxed">{`npx @cartero/cli run <id-de-colección> \\
  --server ${location.origin} \\
  --token $CARTERO_TOKEN \\
  --workspace ${ws} \\
  -e <id-de-entorno> -r cli,junit --report`}</pre>
      </Section>
    </>
  )
}

function Profile() {
  const { me } = useWs()
  const qc = useQueryClient()
  const [name, setName] = useState(me.name)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  return (
    <>
      <Section title="Perfil">
        <div className="flex items-end gap-2">
          <Field label="Nombre" className="flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button
            variant="primary"
            disabled={!name.trim() || name === me.name}
            onClick={async () => {
              await api.patch('/api/auth/me', { name })
              qc.invalidateQueries({ queryKey: qk.me })
              toast.success('Guardado')
            }}
          >
            Guardar
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">{me.email}</p>
      </Section>
      <Section title="Cambiar contraseña">
        <div className="max-w-sm space-y-3">
          <Field label="Contraseña actual">
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="Nueva contraseña" hint="Mínimo 8 caracteres">
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </Field>
          <Button
            variant="primary"
            disabled={!current || next.length < 8}
            onClick={async () => {
              try {
                await api.patch('/api/auth/me', { currentPassword: current, newPassword: next })
                setCurrent('')
                setNext('')
                toast.success('Contraseña cambiada')
              } catch (e) {
                toast.error((e as Error).message)
              }
            }}
          >
            Cambiar contraseña
          </Button>
        </div>
      </Section>
    </>
  )
}
