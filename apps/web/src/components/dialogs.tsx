import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Button, Dialog, Input } from './ui'
import { t } from "@/i18n";

type Pending =
  | { kind: 'prompt'; title: string; label?: string; value: string; confirm: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; message: string; confirm: string; danger?: boolean; resolve: (v: boolean) => void }

const useDialogs = create<{ pending?: Pending; set: (p?: Pending) => void }>((set) => ({ set: (pending) => set({ pending }) }))

export function prompt(title: string, opts: { label?: string; value?: string; confirm?: string } = {}): Promise<string | null> {
  return new Promise((resolve) =>
    useDialogs.getState().set({ kind: 'prompt', title, label: opts.label, value: opts.value ?? '', confirm: opts.confirm ?? t("Aceptar"), resolve }),
  )
}

export function confirm(title: string, message: string, opts: { confirm?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) =>
    useDialogs.getState().set({ kind: 'confirm', title, message, confirm: opts.confirm ?? t("Aceptar"), danger: opts.danger, resolve }),
  )
}

export function DialogHost() {
  const { pending, set } = useDialogs()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (pending?.kind === 'prompt') {
      setValue(pending.value)
      setTimeout(() => inputRef.current?.select(), 30)
    }
  }, [pending])

  if (!pending) return null
  const close = (result: any) => {
    ;(pending.resolve as (v: unknown) => void)(result)
    set(undefined)
  }

  if (pending.kind === 'prompt') {
    return (
      <Dialog
        open
        onOpenChange={(o) => !o && close(null)}
        title={pending.title}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => close(null)}>
              {t("Cancelar")}</Button>
            <Button variant="primary" disabled={!value.trim()} onClick={() => close(value.trim())}>
              {pending.confirm}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim()) close(value.trim())
          }}
        >
          {pending.label && <div className="mb-1.5 text-xs text-muted">{pending.label}</div>}
          <Input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </form>
      </Dialog>
    )
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close(false)}
      title={pending.title}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            {t("Cancelar")}</Button>
          <Button variant={pending.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
            {pending.confirm}
          </Button>
        </>
      }
    >
      <p className="text-muted">{pending.message}</p>
    </Dialog>
  )
}
