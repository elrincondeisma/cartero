import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { clsx } from 'clsx'
import { Check, Loader2, X } from 'lucide-react'
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  forwardRef,
} from 'react'
import { locale, t } from "@/i18n";

export const cx = clsx

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }
>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors select-none',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 disabled:opacity-50 disabled:pointer-events-none',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
        variant === 'secondary' && 'bg-muted text-app hover:brightness-95 dark:hover:brightness-125',
        variant === 'outline' && 'border border-app bg-app hover:bg-soft',
        variant === 'ghost' && 'hover:bg-muted text-app',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  )
})

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }>(
  function IconButton({ label, active, className, children, ...rest }, ref) {
    return (
      <Tooltip content={label}>
        <button
          ref={ref}
          aria-label={label}
          className={cx(
            'inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-muted hover:text-app transition-colors disabled:opacity-40',
            active && 'bg-muted text-app',
            className,
          )}
          {...rest}
        >
          {children}
        </button>
      </Tooltip>
    )
  },
)

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        'h-8 w-full rounded-md border border-app bg-app px-2.5 text-[13px] outline-none placeholder:text-muted',
        'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20',
        className,
      )}
      {...rest}
    />
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(
        'w-full rounded-md border border-app bg-app px-2.5 py-2 text-[13px] outline-none placeholder:text-muted',
        'focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20',
        className,
      )}
      {...rest}
    />
  )
})

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        'h-8 rounded-md border border-app bg-app px-2 text-[13px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  )
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; className?: string }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 select-none', className)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
          checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-app bg-app',
        )}
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </button>
      {label}
    </label>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-[18px] w-8 rounded-full transition-colors', checked ? 'bg-brand-600' : 'bg-muted border border-app')}
      >
        <span className={cx('absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-all', checked ? 'left-4' : 'left-0.5')} />
      </button>
      {label}
    </label>
  )
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'green' | 'red' | 'amber' | 'blue' | 'brand'; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-none',
        tone === 'neutral' && 'bg-muted text-muted',
        tone === 'green' && 'bg-green-500/15 text-green-700 dark:text-green-400',
        tone === 'red' && 'bg-red-500/15 text-red-700 dark:text-red-400',
        tone === 'amber' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
        tone === 'blue' && 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
        tone === 'brand' && 'bg-brand-500/15 text-brand-700 dark:text-brand-400',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function MethodBadge({ method, className }: { method: string; className?: string }) {
  const m = (method || 'GET').toUpperCase()
  const short: Record<string, string> = { DELETE: 'DEL', OPTIONS: 'OPT', PATCH: 'PATCH' }
  return <span className={cx('font-mono text-[10.5px] font-semibold', `method-${m}`, className)}>{short[m] ?? m}</span>
}

export function statusTone(code?: number | null): 'green' | 'amber' | 'red' | 'blue' | 'neutral' {
  if (!code) return 'neutral'
  if (code < 300) return 'green'
  if (code < 400) return 'blue'
  if (code < 500) return 'amber'
  return 'red'
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-4 animate-spin text-muted', className)} />
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      {icon && <div className="mb-1 text-muted [&>svg]:size-8">{icon}</div>}
      <div className="font-medium">{title}</div>
      {children && <div className="max-w-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Tooltip({ content, children, side = 'bottom' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <TooltipPrimitive.Root delayDuration={350}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={5}
          className="z-[100] max-w-xs rounded-md bg-zinc-900 px-2 py-1 text-xs text-white shadow-lg dark:bg-zinc-700"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: string
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <DialogPrimitive.Content
          className={cx(
            'fixed top-[12vh] left-1/2 z-50 flex max-h-[76vh] w-[calc(100vw-2rem)] -translate-x-1/2 flex-col rounded-xl border border-app bg-app shadow-2xl outline-none',
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-app px-5 py-3.5">
            <div>
              <DialogPrimitive.Title className="text-[15px] font-semibold">{title}</DialogPrimitive.Title>
              {description && <DialogPrimitive.Description className="mt-0.5 text-muted">{description}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="rounded p-1 text-muted hover:bg-muted hover:text-app" aria-label={t("Cerrar")}>
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-app px-5 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  shortcut?: string
}

export function Menu({ trigger, items, align = 'end' }: { trigger: ReactNode; items: (MenuItem | 'separator')[]; align?: 'start' | 'end' }) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align={align}
          sideOffset={4}
          // Los eventos de React atraviesan portales: sin esto, elegir una opción también "clica" la fila padre
          onClick={(e) => e.stopPropagation()}
          className="z-[60] min-w-44 rounded-lg border border-app bg-app p-1 shadow-xl"
        >
          {items.map((it, i) =>
            it === 'separator' ? (
              <Dropdown.Separator key={`s${i}`} className="my-1 h-px bg-muted" />
            ) : (
              <Dropdown.Item
                key={it.label}
                disabled={it.disabled}
                onSelect={it.onSelect}
                className={cx(
                  'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-muted',
                  it.danger && 'text-red-600 dark:text-red-400',
                )}
              >
                <span className="text-muted [&>svg]:size-3.5">{it.icon}</span>
                <span className="flex-1">{it.label}</span>
                {it.shortcut && <span className="text-[11px] text-muted">{it.shortcut}</span>}
              </Dropdown.Item>
            ),
          )}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block space-y-1', className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted">{hint}</span>}
    </label>
  )
}

export function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
  right,
  className,
}: {
  tabs: { id: T; label: ReactNode; count?: number | string; dot?: boolean }[]
  value: T
  onChange: (v: T) => void
  right?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex items-center gap-1 border-b border-app px-3', className)}>
      {tabs.map((tItem) => (
        <button
          key={tItem.id}
          onClick={() => onChange(tItem.id)}
          className={cx(
            '-mb-px flex items-center gap-1.5 border-b-2 px-2 py-2 text-[12.5px] transition-colors',
            value === tItem.id ? 'border-brand-600 font-medium text-app' : 'border-transparent text-muted hover:text-app',
          )}
        >
          {tItem.label}
          {tItem.count !== undefined && tItem.count !== 0 && <span className="text-[11px] text-brand-600 dark:text-brand-400">{tItem.count}</span>}
          {tItem.dot && <span className="size-1.5 rounded-full bg-brand-500" />}
        </button>
      ))}
      <div className="ml-auto flex items-center gap-1">{right}</div>
    </div>
  )
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function formatMs(n: number) {
  if (n < 1000) return t("{0} ms", [Math.round(n)])
  return t("{0} s", [(n / 1000).toFixed(2)])
}

export function timeAgo(date: string | number | Date) {
  const d = new Date(date).getTime()
  const s = Math.round((Date.now() - d) / 1000)
  if (s < 60) return t("ahora mismo")
  if (s < 3600) return t("hace {0} min", [Math.floor(s / 60)])
  if (s < 86400) return t("hace {0} h", [Math.floor(s / 3600)])
  if (s < 86400 * 30) return t("hace {0} d", [Math.floor(s / 86400)])
  return new Date(date).toLocaleDateString(locale)
}
