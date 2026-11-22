import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { qk } from '@/api/hooks'
import { confirm } from '@/components/dialogs'
import { Button } from '@/components/ui'
import { useDemoLoader } from '../onboarding/Welcome'

/** Cargar o quitar el workspace de ejemplo con APIs públicas reales. */
export function DemoSettings() {
  const { data, refetch } = useQuery({ queryKey: ['demo'], queryFn: () => api.get<{ status: string; workspaceId?: string }>('/api/demo') })
  const demo = useDemoLoader()
  const [removing, setRemoving] = useState(false)
  const qc = useQueryClient()
  const nav = useNavigate()
  const loading = demo.status?.status === 'running'
  const exists = data?.status === 'done' && data.workspaceId

  return (
    <section className="mb-10">
      <h3 className="text-[15px] font-semibold">Datos de ejemplo</h3>
      <p className="mt-0.5 mb-4 text-muted">
        Un workspace «Demo Cartero» con APIs públicas reales (JSONPlaceholder, httpbin, Open-Meteo, PokeAPI, GraphQL, Petstore, GitHub): tests, entornos, ejemplos, un mock, monitores, documentación
        publicada y una compañera de demo con comentarios. Se quita entero con un clic.
      </p>
      {loading ? (
        <div className="rounded-lg border border-app p-4">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <Loader2 className="size-4 animate-spin text-brand-600" /> Cargando…
          </div>
          <ul className="space-y-1 text-xs text-muted">
            {demo.status?.log.map((l) => (
              <li key={l} className="flex gap-1.5">
                <Check className="size-3.5 text-green-600" />
                {l}
              </li>
            ))}
          </ul>
        </div>
      ) : exists ? (
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => nav(`/w/${data.workspaceId}`)}>
            Ir al workspace de ejemplo
          </Button>
          <Button
            variant="ghost"
            icon={<Trash2 className="size-3.5" />}
            loading={removing}
            onClick={async () => {
              if (!(await confirm('Quitar los datos de ejemplo', 'Se borrará el workspace «Demo Cartero» con todo su contenido (y la usuaria de demo). Tus otros workspaces no se tocan.', { confirm: 'Quitar', danger: true }))) return
              setRemoving(true)
              try {
                await api.del('/api/demo')
                await qc.invalidateQueries({ queryKey: qk.workspaces })
                await refetch()
                toast.success('Datos de ejemplo eliminados')
                nav('/')
              } catch (e) {
                toast.error((e as Error).message)
              } finally {
                setRemoving(false)
              }
            }}
          >
            Quitar datos de ejemplo
          </Button>
        </div>
      ) : (
        <Button
          variant="primary"
          icon={<Sparkles className="size-3.5" />}
          onClick={async () => {
            try {
              const ws = await demo.start()
              await refetch()
              toast.success('Datos de ejemplo cargados')
              nav(`/w/${ws}`)
            } catch (e) {
              toast.error((e as Error).message)
            }
          }}
        >
          Cargar datos de ejemplo
        </Button>
      )}
    </section>
  )
}
