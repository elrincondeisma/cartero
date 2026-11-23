import { Download, ExternalLink } from 'lucide-react'
import { Dialog, cx } from '@/components/ui'
import { t } from '@/i18n'
import { DESKTOP_DOWNLOADS, DESKTOP_RELEASES, type DesktopOs, currentOs, downloadUrl } from '@/lib/downloads'

function label(os: DesktopOs): [string, string] {
  switch (os) {
    case 'mac':
      return [t('macOS'), t('Apple Silicon e Intel · firmada y notarizada')]
    case 'win':
      return [t('Windows'), t('64 bits')]
    case 'deb':
      return [t('Linux (.deb)'), t('Debian, Ubuntu')]
    case 'appimage':
      return [t('Linux (AppImage)'), t('Cualquier distribución')]
  }
}

/** Diálogo con las descargas de la app de escritorio; la del sistema actual va primero y destacada. */
export function DesktopDownloadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const mine = currentOs()
  const list = [...DESKTOP_DOWNLOADS].sort((a, b) => Number(b.os === mine) - Number(a.os === mine))
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('App de escritorio')}
      description={t('Las peticiones salen de tu equipo, así que llegan a localhost y a tu VPN. Puede sincronizar tus workspaces con este servidor.')}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {list.map(({ os, file }) => {
          const [name, sub] = label(os)
          const highlight = os === mine
          return (
            <a
              key={os}
              href={downloadUrl(file)}
              className={cx(
                'flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors',
                highlight ? 'border-brand-500 bg-brand-500/10 hover:bg-brand-500/15' : 'border-app hover:bg-soft',
              )}
            >
              <Download className={cx('size-4 shrink-0', highlight ? 'text-brand-600 dark:text-brand-400' : 'text-muted')} />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{name}</span>
                <span className="block truncate text-xs text-muted">{sub}</span>
              </span>
            </a>
          )
        })}
      </div>
      <a href={DESKTOP_RELEASES} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted hover:text-app">
        {t('Todas las versiones')} <ExternalLink className="size-3" />
      </a>
    </Dialog>
  )
}
