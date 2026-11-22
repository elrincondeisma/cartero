import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Download, Globe, MoreHorizontal, Plus, Trash2, Variable } from 'lucide-react'
import { api, download } from '@/api/client'
import { qk, useEnvironments } from '@/api/hooks'
import type { EnvironmentRow } from '@/api/types'
import { confirm, prompt } from '@/components/dialogs'
import { Empty, IconButton, Menu, Spinner, cx } from '@/components/ui'
import { useTabs } from '@/store/tabs'
import { useUi } from '@/store/ui'
import { useOpen } from '../workspace/actions'
import { useWs } from '../workspace/context'
import { t } from "@/i18n";

export function EnvironmentsSidebar() {
  const { ws, canEdit } = useWs()
  const { data: envs, isLoading } = useEnvironments(ws)
  const activeEnv = useUi((s) => s.activeEnv[ws])
  const setActiveEnv = useUi((s) => s.setActiveEnv)
  const activeTab = useTabs((s) => s.byWs[ws]?.active)
  const open = useOpen()
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: qk.environments(ws) })

  const create = async () => {
    const name = await prompt(t("Nuevo entorno"), { label: t("Por ejemplo: Local, Staging, Producción"), confirm: t("Crear") })
    if (!name) return
    const env = await api.post<EnvironmentRow>(`/api/workspaces/${ws}/environments`, { name, values: [] })
    refresh()
    open.environment(env.id, env.name)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 pt-2.5 pb-2">
        <span className="flex-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{t("Entornos")}</span>
        {canEdit && (
          <IconButton label={t("Nuevo entorno")} onClick={create}>
            <Plus className="size-4" />
          </IconButton>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5">
        <button
          onClick={() => open.globals()}
          className={cx('flex h-8 w-full items-center gap-2 rounded-md px-2 text-left', activeTab === 'globals' ? 'bg-brand-500/10' : 'hover:bg-muted')}
        >
          <Globe className="size-3.5 text-muted" />
          <span className="flex-1">{t("Globales")}</span>
        </button>
        <div className="my-1.5 h-px bg-muted" />
        {isLoading && <Spinner className="m-3" />}
        {envs?.length === 0 && <Empty title={t("Sin entornos")}>{t("Agrupa variables como baseUrl o token por entorno y cambia entre ellos desde la barra superior.")}</Empty>}
        {envs?.map((e) => (
          <div
            key={e.id}
            onClick={() => open.environment(e.id, e.name)}
            className={cx('group flex h-8 cursor-pointer items-center gap-2 rounded-md px-2', activeTab === `env:${e.id}` ? 'bg-brand-500/10' : 'hover:bg-muted')}
          >
            <Variable className="size-3.5 text-muted" />
            <span className="flex-1 truncate">{e.name}</span>
            <button
              onClick={(ev) => {
                ev.stopPropagation()
                setActiveEnv(ws, activeEnv === e.id ? null : e.id)
              }}
              title={activeEnv === e.id ? t("Entorno activo (clic para desactivar)") : t("Activar entorno")}
              className={cx('rounded p-0.5', activeEnv === e.id ? 'text-brand-600' : 'invisible text-muted group-hover:visible hover:bg-app')}
            >
              <Check className="size-3.5" />
            </button>
            <Menu
              trigger={
                <button onClick={(ev) => ev.stopPropagation()} className="invisible rounded p-0.5 text-muted group-hover:visible hover:bg-app" aria-label={t("Acciones")}>
                  <MoreHorizontal className="size-4" />
                </button>
              }
              items={[
                { label: t("Exportar (Postman)"), icon: <Download />, onSelect: () => download(`/api/environments/${e.id}/export`, `${e.name}.postman_environment.json`) },
                ...(canEdit
                  ? [
                      {
                        label: t("Duplicar"),
                        icon: <Copy />,
                        onSelect: async () => {
                          await api.post(`/api/environments/${e.id}/duplicate`)
                          refresh()
                        },
                      },
                      'separator' as const,
                      {
                        label: t("Eliminar"),
                        icon: <Trash2 />,
                        danger: true,
                        onSelect: async () => {
                          if (!(await confirm(t("Eliminar entorno"), t("Se eliminará «{0}» y sus variables.", [e.name]), { confirm: t("Eliminar"), danger: true }))) return
                          await api.del(`/api/environments/${e.id}`)
                          useTabs.getState().removeWhere(ws, (tItem) => tItem.kind === 'environment' && tItem.envId === e.id)
                          refresh()
                        },
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
