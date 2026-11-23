import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const env = process.env

function secretKey(): Buffer {
  const raw = env.CARTERO_SECRET_KEY
  if (raw) return createHash('sha256').update(raw).digest()
  if (env.NODE_ENV === 'production') throw new Error('CARTERO_SECRET_KEY es obligatoria en producción')
  return createHash('sha256').update('cartero-dev-secret').digest()
}

/** Versión de la imagen (la graba el build); fuera de una release es «<package.json>-dev». */
function version(): string {
  if (env.CARTERO_VERSION) return env.CARTERO_VERSION
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return `${pkg.version}-dev`
  } catch {
    return '0.0.0-dev'
  }
}

export const config = {
  version: version(),
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? '0.0.0.0',
  databaseUrl: env.DATABASE_URL ?? 'postgres://cartero:cartero@localhost:5433/cartero',
  redisUrl: env.REDIS_URL ?? 'redis://localhost:6380',
  publicUrl: (env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  secretKey: secretKey(),
  /** Bloquear peticiones a redes privadas (SSRF) — útil en despliegues públicos */
  blockPrivateNetworks: env.BLOCK_PRIVATE_NETWORKS === 'true',
  /** Valor inicial: después se cambia desde el panel de administración */
  allowRegistration: env.ALLOW_REGISTRATION !== 'false',
  /** Emails que son admin de la instancia al arrancar (separados por comas) */
  adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  /** Login social desde variables de entorno (el panel de administración tiene prioridad) */
  oauth: {
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
  },
  webDist: env.WEB_DIST,
  filesDir: env.FILES_DIR ?? './data/files',
  secureCookies: env.NODE_ENV === 'production' && !env.PUBLIC_URL?.startsWith('http://'),
  smtp: env.SMTP_URL,
  smtpFrom: env.SMTP_FROM ?? 'Cartero <no-reply@localhost>',
  /** Si es 'false', el servidor no programa monitores (lo hace un worker aparte) */
  inlineWorker: env.INLINE_WORKER !== 'false',
  /** Quién reinicia Cartero al actualizar: ECS (Fargate) o el contenedor updater de Docker Compose */
  updater: (env.CARTERO_UPDATER === 'ecs' || env.CARTERO_UPDATER === 'compose' ? env.CARTERO_UPDATER : undefined) as
    | 'ecs'
    | 'compose'
    | undefined,
  /** Carpeta que comparte con el updater de Docker Compose */
  updaterDir: env.CARTERO_UPDATER_DIR ?? '/data/updater',
  /** Etiqueta de la imagen: «stable» se actualiza; una versión concreta queda fijada */
  channel: env.CARTERO_CHANNEL ?? 'stable',
  /** De dónde salen las versiones publicadas (se cambia solo en pruebas) */
  releasesUrl: env.CARTERO_RELEASES_URL ?? 'https://api.github.com/repos/elrincondeisma/cartero/releases?per_page=30',
}
