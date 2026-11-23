import { t } from '@/i18n'

/** Resumen de cambios de un contrato: «1 cambio que rompe, 2 compatibles» o «sin cambios de estructura». */
function contractChanges(s: string): string {
  if (s === 'creado') return t('creado')
  if (s === 'eliminado') return t('eliminado')
  if (s === 'sin cambios de estructura') return t('sin cambios de estructura')
  return s
    .split(', ')
    .map((part) => {
      let m = /^(\d+) cambios? que rompen?$/.exec(part)
      if (m) return m[1] === '1' ? t('1 cambio que rompe') : t('{0} cambios que rompen', [m[1]])
      m = /^(\d+) compatibles?$/.exec(part)
      if (m) return m[1] === '1' ? t('1 compatible') : t('{0} compatibles', [m[1]])
      return part
    })
    .join(', ')
}

/**
 * El servidor guarda el resumen de cada revisión en español (queda así en la base de datos).
 * Aquí se reconoce cada forma y se traduce al idioma de la interfaz.
 */
export function revisionSummary(s: string): string {
  let m: RegExpExecArray | null
  if ((m = /^Restaurado: (.*)$/s.exec(s))) return t('Restaurado: {0}', [revisionSummary(m[1])])
  if ((m = /^Contrato de «(.*)»: (.*)$/s.exec(s))) return t('Contrato de «{0}»: {1}', [m[1], contractChanges(m[2])])
  if ((m = /^«(.*)» modificado$/s.exec(s))) return t('«{0}» modificado', [m[1]])
  if ((m = /^«(.*)» movido$/s.exec(s))) return t('«{0}» movido', [m[1]])
  if ((m = /^«(.*)» duplicado$/s.exec(s))) return t('«{0}» duplicado', [m[1]])
  if ((m = /^«(.*)» eliminado$/s.exec(s))) return t('«{0}» eliminado', [m[1] === 'Elemento' ? t('Elemento') : m[1]])
  if ((m = /^Carpeta «(.*)» creada$/s.exec(s))) return t('Carpeta «{0}» creada', [m[1]])
  if ((m = /^Petición «(.*)» creada$/s.exec(s))) return t('Petición «{0}» creada', [m[1]])
  if ((m = /^Merge desde el fork «(.*)»$/s.exec(s))) return t('Merge desde el fork «{0}»', [m[1]])
  if ((m = /^Importada desde (.*)$/s.exec(s))) return t('Importada desde {0}', [m[1]])
  switch (s) {
    case 'Colección creada':
      return t('Colección creada')
    case 'Configuración de la colección':
      return t('Configuración de la colección')
    case 'Fork creado':
      return t('Fork creado')
    case 'Actualizada desde Postman':
      return t('Actualizada desde Postman')
  }
  return s
}
