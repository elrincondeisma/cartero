import { useQueryClient } from '@tanstack/react-query'
import { Check, History, MessageSquare, RotateCcw, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { qk, useComments, useRevisions } from '@/api/hooks'
import { confirm } from '@/components/dialogs'
import { Button, IconButton, Spinner, SubTabs, Textarea, cx, timeAgo } from '@/components/ui'
import { useWs } from '../workspace/context'
import { t } from "@/i18n";

/** Panel lateral con comentarios e historial de cambios de un elemento (o de toda la colección). */
export function CollabPanel({ collectionId, itemId, onClose, initial = 'comments' }: { collectionId: string; itemId?: string; onClose: () => void; initial?: 'comments' | 'history' }) {
  const [tab, setTab] = useState<'comments' | 'history'>(initial)
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-app bg-app">
      <SubTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'comments', label: <span className="flex items-center gap-1.5"><MessageSquare className="size-3.5" />{t("Comentarios")}</span> },
          { id: 'history', label: <span className="flex items-center gap-1.5"><History className="size-3.5" />{t("Cambios")}</span> },
        ]}
        right={
          <IconButton label={t("Cerrar panel")} onClick={onClose}>
            <X className="size-3.5" />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1">{tab === 'comments' ? <Comments collectionId={collectionId} itemId={itemId} /> : <Revisions collectionId={collectionId} itemId={itemId} />}</div>
    </aside>
  )
}

function Comments({ collectionId, itemId }: { collectionId: string; itemId?: string }) {
  const { me, canEdit } = useWs()
  const { data, isLoading } = useComments(collectionId, itemId)
  const [body, setBody] = useState('')
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: qk.comments(collectionId, itemId) })

  const send = async () => {
    if (!body.trim()) return
    await api.post(`/api/collections/${collectionId}/comments`, { itemId: itemId ?? null, body })
    setBody('')
    refresh()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {isLoading && <Spinner />}
        {data?.length === 0 && <p className="py-6 text-center text-muted">{t("Sin comentarios todavía. Deja notas para tu equipo.")}</p>}
        {data?.map((c) => (
          <div key={c.id} className={cx('group rounded-lg border border-app p-2.5', c.resolved && 'opacity-55')}>
            <div className="mb-1 flex items-center gap-2 text-xs">
              <b>{c.user}</b>
              <span className="text-muted">{timeAgo(c.createdAt)}</span>
              <div className="ml-auto flex opacity-0 transition-opacity group-hover:opacity-100">
                {canEdit && (
                  <IconButton
                    label={c.resolved ? t("Reabrir") : t("Resolver")}
                    onClick={async () => {
                      await api.patch(`/api/comments/${c.id}`, { resolved: !c.resolved })
                      refresh()
                    }}
                  >
                    <Check className="size-3.5" />
                  </IconButton>
                )}
                {c.userId === me.id && (
                  <IconButton
                    label={t("Borrar")}
                    onClick={async () => {
                      await api.del(`/api/comments/${c.id}`)
                      refresh()
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                )}
              </div>
            </div>
            <div className="whitespace-pre-wrap">{c.body}</div>
          </div>
        ))}
      </div>
      <div className="border-t border-app p-3">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder={t("Escribe un comentario… (Ctrl+Enter para enviar)")}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send()
          }}
        />
        <Button variant="primary" size="sm" className="mt-2 w-full" onClick={send} disabled={!body.trim()}>
          {t("Comentar")}</Button>
      </div>
    </div>
  )
}

function Revisions({ collectionId, itemId }: { collectionId: string; itemId?: string }) {
  const { canEdit } = useWs()
  const { data, isLoading } = useRevisions(collectionId, itemId)
  const qc = useQueryClient()
  return (
    <div className="h-full overflow-y-auto p-2">
      {isLoading && <Spinner className="m-3" />}
      {data?.length === 0 && <p className="py-6 text-center text-muted">{t("Sin cambios registrados.")}</p>}
      <ol className="relative ml-2 border-l border-app">
        {data?.map((r) => (
          <li key={r.id} className="group relative mb-1 ml-3 rounded-md px-2 py-1.5 hover:bg-soft">
            <span className="absolute top-3 -left-[17px] size-2 rounded-full border-2 border-[var(--bg)] bg-brand-500" />
            <div className="text-[12.5px]">{r.summary}</div>
            <div className="text-[11px] text-muted">
              {r.user ?? t("Sistema")} · {timeAgo(r.createdAt)}
            </div>
            {canEdit && r.restorable && (
              <button
                className="absolute top-1.5 right-1.5 hidden items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-brand-700 group-hover:flex hover:bg-muted dark:text-brand-400"
                onClick={async () => {
                  const ok = await confirm(t("Restaurar versión"), t("Se restaurará el estado anterior a «{0}».", [r.summary]), { confirm: t("Restaurar") })
                  if (!ok) return
                  try {
                    await api.post(`/api/revisions/${r.id}/restore`)
                    qc.invalidateQueries({ queryKey: qk.collection(collectionId) })
                    qc.invalidateQueries({ queryKey: ['revisions', collectionId] })
                    toast.success(t("Restaurado"))
                  } catch (e) {
                    toast.error((e as Error).message)
                  }
                }}
              >
                <RotateCcw className="size-3" /> {t("Restaurar")}</button>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
