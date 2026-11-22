import { Globe } from 'lucide-react'
import { api } from '@/api/client'
import { LANGS, type Lang, lang, setLang } from '@/i18n'
import { cx } from './ui'

/** Guarda el idioma en la cuenta (si hay sesión) y recarga la app. */
export async function changeLanguage(l: Lang) {
  if (l === lang) return
  await api.patch('/api/auth/me', { settings: { lang: l } }).catch(() => {})
  setLang(l)
}

/** Enlaces compactos «Español · English» para las pantallas sin sesión. */
export function LanguageLinks({ className }: { className?: string }) {
  return (
    <div className={cx('flex items-center justify-center gap-2 text-xs text-muted', className)}>
      <Globe className="size-3.5" />
      {LANGS.map((l, i) => (
        <span key={l.id} className="flex items-center gap-2">
          {i > 0 && <span>·</span>}
          <button onClick={() => setLang(l.id)} className={cx('hover:text-app', l.id === lang && 'font-semibold text-app')} aria-current={l.id === lang}>
            {l.label}
          </button>
        </span>
      ))}
    </div>
  )
}
