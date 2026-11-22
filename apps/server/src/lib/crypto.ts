import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { config } from '../config.js'

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split('$')
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length)
  return timingSafeEqual(expected, actual)
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

const PREFIX = 'enc:v1:'

/** Cifra un valor con AES-256-GCM. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', config.secretKey, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(value: string): string {
  if (!value.startsWith(PREFIX)) return value
  const buf = Buffer.from(value.slice(PREFIX.length), 'base64')
  const decipher = createDecipheriv('aes-256-gcm', config.secretKey, buf.subarray(0, 12))
  decipher.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8')
}

/** Cifra los valores de las variables de tipo secret (para guardar en BD). */
export function sealVariables<T extends { type?: string; value?: any }>(vars: T[]): T[] {
  return (vars ?? []).map((v) =>
    v.type === 'secret' && typeof v.value === 'string' && v.value && !v.value.startsWith(PREFIX)
      ? { ...v, value: encrypt(v.value) }
      : v,
  )
}

/** Descifra los valores secret (para enviar al cliente autorizado o ejecutar). */
export function openVariables<T extends { type?: string; value?: any }>(vars: T[]): T[] {
  return (vars ?? []).map((v) =>
    typeof v.value === 'string' && v.value.startsWith(PREFIX) ? { ...v, value: decrypt(v.value) } : v,
  )
}
