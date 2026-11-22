import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { qk, useWorkspaces } from '@/api/hooks'
import type { CollectionSummary } from '@/api/types'
import { Button, Dialog, Field, Input, Select } from '@/components/ui'
import { useWs } from '../workspace/context'
import { t } from "@/i18n";

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
      setTarget(targets.find((tItem) => tItem.type === 'personal')?.id ?? ws)
    }
  }, [open])

  const submit = async () => {
    setLoading(true)
    try {
      await api.post(`/api/collections/${collection.id}/fork`, { workspaceId: target, name })
      qc.invalidateQueries({ queryKey: qk.collections(target) })
      toast.success(t("Fork creado"))
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
      title={t("Fork de la colección")}
      description={t("Crea una copia para trabajar sin afectar a la original. Después puedes hacer merge.")}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Cancelar")}</Button>
          <Button variant="primary" onClick={submit} loading={loading} disabled={!name.trim()}>
            {t("Crear fork")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t("Nombre del fork")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("Workspace destino")}>
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
