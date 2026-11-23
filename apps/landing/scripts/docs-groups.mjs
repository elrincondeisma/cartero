/**
 * Grupos del manual por número de capítulo: la barra lateral de Starlight (astro.config.mjs) y la
 * portada de /docs (scripts/sync-docs.mjs) salen de aquí. Un capítulo nuevo tiene que estar en un grupo.
 */
export const GROUPS = [
  { en: 'Getting started', es: 'Primeros pasos', items: ['01', '14'] },
  { en: 'Working with APIs', es: 'Trabajar con APIs', items: ['02', '03', '04', '05', '06', '07', '19'] },
  { en: 'Share and automate', es: 'Compartir y automatizar', items: ['08', '09', '10', '11', '12', '13'] },
  { en: 'Install and run', es: 'Instalar y mantener', items: ['15', '20', '21', '17', '22', '18'] },
  { en: 'Help', es: 'Ayuda', items: ['16'] },
]
