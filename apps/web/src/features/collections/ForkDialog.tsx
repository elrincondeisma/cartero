import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { qk, useWorkspaces } from '@/api/hooks'
import type { CollectionSummary } from '@/api/types'
import { Button, Dialog, Field, Input, Select } from '@/components/ui'
import { useWs } from '../workspace/context'

export function ForkDialog({ open, onOpenChange, collection }: { open: boolean; onOpenChange: (v: boolean) => void; collection: CollectionSummary }) {
  const { ws } = useWs()
  const { data: workspaces } = useWorkspaces()
  const targets = (workspaces ?? []).filter((w) => w.role !== 'viewer')
  const [name, setName] = useState('')
  const [target, setTarget] = useState(ws)
  const [loading, setLoading] = useState(false)
  const qc = useQueryClient()
  const nav = useNavigate()

  useEffect(() => {
    if (open) {
      setName(`${collection.name} (fork)`)
      setTarget(targets.find((t) => t.type === 'personal')?.id ?? ws)
    }
  }, [open])

  const submit = async () => {
    setLoading(true)
    try {
      await api.post(`/api/collections/${collection.id}/fork`, { workspaceId: target, name })
      qc.invalidateQueries({ queryKey: qk.collections(target) })
      toast.success('Fork creado')
      onOpenChange(false)
      if (target !== ws) nav(`/w/${target}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Fork de la colección"
      description="Crea una copia para trabajar sin afectar a la original. Después puedes hacer merge."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit} loading={loading} disabled={!name.trim()}>
            Crear fork
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Nombre del fork">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Workspace destino">
          <Select value={target} onChange={(e) => setTarget(e.target.value)} className="w-full">
            {targets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  )
}
