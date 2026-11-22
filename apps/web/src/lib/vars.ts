import { toScope } from '@cartero/core'
import { useMemo } from 'react'
import { useCollection, useEnvironments, useGlobals } from '@/api/hooks'
import { useUi } from '@/store/ui'

/** Variables conocidas (globales < colección < entorno activo) para resaltar y previsualizar. */
export function useKnownVariables(ws: string, collectionId?: string | null) {
  const { data: globals } = useGlobals(ws)
  const { data: envs } = useEnvironments(ws)
  const { data: col } = useCollection(collectionId ?? undefined)
  const activeEnv = useUi((s) => s.activeEnv[ws])
  return useMemo(() => {
    const env = envs?.find((e) => e.id === activeEnv)
    return { ...toScope(globals), ...toScope(col?.data.variable), ...toScope(env?.values) }
  }, [globals, envs, col, activeEnv])
}
