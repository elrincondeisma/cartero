import { createHash } from 'node:crypto'

const env = process.env

function secretKey(): Buffer {
  const raw = env.CARTERO_SECRET_KEY
  if (raw) return createHash('sha256').update(raw).digest()
  if (env.NODE_ENV === 'production') throw new Error('CARTERO_SECRET_KEY es obligatoria en producción')
  return createHash('sha256').update('cartero-dev-secret').digest()
}

export const config = {
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
}
