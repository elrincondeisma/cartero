/** Descarga directa de la última versión publicada de la app de escritorio (nombres sin versión). */
const RELEASES = 'https://github.com/elrincondeisma/cartero/releases'

export const DESKTOP_RELEASES = RELEASES

export const DESKTOP_DOWNLOADS = [
  { os: 'mac', file: 'Cartero-macos-universal.dmg' },
  { os: 'win', file: 'Cartero-windows-x64-setup.exe' },
  { os: 'deb', file: 'cartero-linux-amd64.deb' },
  { os: 'appimage', file: 'Cartero-linux-x86_64.AppImage' },
] as const

export type DesktopOs = (typeof DESKTOP_DOWNLOADS)[number]['os']

export const downloadUrl = (file: string) => `${RELEASES}/latest/download/${file}`

/** Sistema de quien usa la web (Linux: el .deb, el más habitual). */
export function currentOs(): DesktopOs | null {
  const ua = navigator.userAgent
  if (/iPhone|iPad|Android/.test(ua)) return null
  if (/Mac/.test(ua)) return 'mac'
  if (/Win/.test(ua)) return 'win'
  if (/Linux/.test(ua) && !/Android/.test(ua)) return 'deb'
  return null
}
