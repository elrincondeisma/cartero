import { useEffect, useMemo, useState } from 'react'
import { useCollection, useCollections } from '@/api/hooks'
import { Button, Dialog, Field, Input, Select } from '@/components/ui'
import { buildTree, type TreeNode } from '@/lib/tree'
import { useWs } from '../workspace/context'
import { t } from "@/i18n";

export function SaveDialog({
  open,
  onOpenChange,
  defaultName,
  onSave,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultName: string
  onSave: (target: { collectionId: string; parentId: string | null; name: string }) => Promise<void>
}) {
  const { ws } = useWs()
  const { data: collections } = useCollections(ws)
  const [name, setName] = useState(defaultName)
  const [collectionId, setCollectionId] = useState('')
  const [parentId, setParentId] = useState('')
  const [saving, setSaving] = useState(false)
  const { data: col } = useCollection(collectionId || undefined)
  const folders = useMemo(() => {
    const out: { id: string; label: string }[] = []
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const n of nodes)
        if (n.row.type === 'folder') {
          out.push({ id: n.row.id, label: `${'— '.repeat(depth)}${n.row.name}` })
          walk(n.children, depth + 1)
        }
    }
    if (col) walk(buildTree(col.items), 0)
    return out
  }, [col])

  useEffect(() => {
    if (open) {
      setName(defaultName)
      if (!collectionId && collections?.length) setCollectionId(collections[0].id)
    }
  }, [open, collections])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Guardar petición")}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Cancelar")}</Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!name.trim() || !collectionId}
            onClick={async () => {
              setSaving(true)
              try {
                await onSave({ collectionId, parentId: parentId || null, name: name.trim() })
                onOpenChange(false)
              } finally {
                setSaving(false)
              }
            }}
          >
            {t("Guardar")}</Button>
        </>
      }
    >
      {collections?.length === 0 ? (
        <p className="text-muted">{t("Primero crea una colección desde la barra lateral.")}</p>
      ) : (
        <div className="space-y-3">
          <Field label={t("Nombre")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label={t("Colección")}>
            <Select
              value={collectionId}
              onChange={(e) => {
                setCollectionId(e.target.value)
                setParentId('')
              }}
              className="w-full"
            >
              {collections?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Carpeta")}>
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)} className="w-full">
              <option value="">{t("(raíz de la colección)")}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </Dialog>
  )
}
