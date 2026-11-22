import { t } from '@/i18n'
import { type KeyboardEvent, useMemo, useRef } from 'react'
import { cx } from './ui'

/**
 * Input de una línea que resalta las {{variables}}: verde/naranja si existen, rojo si no.
 * Usa una capa por debajo con el texto coloreado y el input transparente encima.
 */
export function VarInput({
  value,
  onChange,
  known,
  placeholder,
  className,
  onKeyDown,
  onPaste,
  autoFocus,
  mono = true,
}: {
  value: string
  onChange: (v: string) => void
  known?: Record<string, string>
  placeholder?: string
  className?: string
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void
  autoFocus?: boolean
  mono?: boolean
}) {
  const overlay = useRef<HTMLDivElement>(null)
  const parts = useMemo(() => {
    const out: { text: string; var?: string }[] = []
    let last = 0
    for (const m of value.matchAll(/\{\{([^{}]+?)\}\}/g)) {
      if (m.index! > last) out.push({ text: value.slice(last, m.index) })
      out.push({ text: m[0], var: m[1].trim() })
      last = m.index! + m[0].length
    }
    if (last < value.length) out.push({ text: value.slice(last) })
    return out
  }, [value])

  const title = parts
    .filter((p) => p.var)
    .map((p) => `${p.var} = ${p.var!.startsWith('$') ? t('(dinámica)') : (known?.[p.var!] ?? t('(no definida)'))}`)
    .join('\n')

  return (
    <div className={cx('relative min-w-0 flex-1', className)} title={title || undefined}>
      <div
        ref={overlay}
        aria-hidden
        className={cx('pointer-events-none absolute inset-0 overflow-hidden px-2.5 py-0 whitespace-pre', mono && 'font-mono text-[12.5px]')}
        style={{ lineHeight: 'inherit', display: 'flex', alignItems: 'center' }}
      >
        <span>
          {parts.map((p, i) =>
            p.var ? (
              <span key={i} className={p.var.startsWith('$') || (known && p.var in known) ? 'var-ok' : 'var-missing'}>
                {p.text}
              </span>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </span>
      </div>
      <input
        value={value}
        autoFocus={autoFocus}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onScroll={(e) => {
          if (overlay.current) overlay.current.scrollLeft = e.currentTarget.scrollLeft
        }}
        className={cx(
          'relative h-full w-full bg-transparent px-2.5 text-transparent caret-current outline-none placeholder:text-muted selection:text-transparent',
          mono && 'font-mono text-[12.5px]',
        )}
        style={{ caretColor: 'var(--fg)' }}
      />
    </div>
  )
}
