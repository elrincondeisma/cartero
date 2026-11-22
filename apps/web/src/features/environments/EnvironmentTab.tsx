import type { Variable } from '@cartero/core'
import { useQueryClient } from '@tanstack/react-query'
import { Globe, Save, Variable as VarIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ApiError, api } from '@/api/client'
import { qk, useEnvironments, useGlobals } from '@/api/hooks'
import { Badge, Button, Empty, Spinner } from '@/components/ui'
import { useTabs } from '@/store/tabs'
import { useUi } from '@/store/ui'
import { VariablesTable } from '../collections/CollectionTab'
import { useWs } from '../workspace/context'
import { t } from "@/i18n";

export function EnvironmentTab({ envId, globals, tabKey }: { envId?: string; globals?: boolean; tabKey: string }) {
  const { ws, canEdit } = useWs()
  const { data: envs, isLoading: le } = useEnvironments(ws)
  const { data: globalVars, isLoading: lg } = useGlobals(ws)
  const env = envs?.find((e) => e.id === envId)
  const activeEnv = useUi((s) => s.activeEnv[ws])
  const setActiveEnv = useUi((s) => s.setActiveEnv)
  const [name, setName] = useState('')
  const [values, setValues] = useState<Variable[]>([])
  const [dirty, setDirty] = useState(false)
  const [base, setBase] = useState<number>()
  const qc = useQueryClient()

  const source = globals ? globalVars : env?.values
  const srcVersion = globals ? JSON.stringify(globalVars) : env?.version
  useEffect(() => {
    if (!source || dirty) return
    setValues(source)
    setName(env?.name ?? 'Globales')
    setBase(env?.version)
  }, [srcVersion])

  const save = async () => {
    try {
      if (globals) await api.put(`/api/workspaces/${ws}/globals`, values)
      else await api.put(`/api/environments/${envId}`, { name, values, version: base })
      setDirty(false)
      useTabs.getState().update(ws, tabKey, { title: name })
      qc.invalidateQueries({ queryKey: globals ? qk.globals(ws) : qk.environments(ws) })
      toast.success(t("Guardado"))
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(t("Otra persona ha modificado este entorno. Se ha recargado."))
        setDirty(false)
        qc.invalidateQueries({ queryKey: qk.environments(ws) })
      } else toast.error((e as Error).message)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirty && canEdit) void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (le || lg)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  if (!globals && !env) return <Empty title={t("Este entorno ya no existe")} />

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-app px-4">
        {globals ? <Globe className="size-4 text-muted" /> : <VarIcon className="size-4 text-muted" />}
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setDirty(true)
          }}
          readOnly={globals || !canEdit}
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-[15px] font-semibold outline-none hover:bg-muted focus:bg-muted"
        />
        {!globals &&
          (activeEnv === envId ? (
            <Badge tone="brand">{t("Activo")}</Badge>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setActiveEnv(ws, envId!)}>
              {t("Activar")}</Button>
          ))}
        {canEdit && (
          <Button size="sm" variant={dirty ? 'primary' : 'ghost'} icon={<Save className="size-3.5" />} onClick={save} disabled={!dirty}>
            {t("Guardar")}</Button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <VariablesTable
          values={values}
          onChange={(v) => {
            setValues(v)
            setDirty(true)
          }}
          readOnly={!canEdit}
          hint={
            globals
              ? t("Variables globales del workspace: disponibles en todas las colecciones, con la prioridad más baja.")
              : t("Úsalas con {{nombre}} en URLs, cabeceras y bodies, o desde scripts con pm.environment. Los scripts que las modifican se guardan aquí automáticamente.")
          }
        />
      </div>
    </div>
  )
}
