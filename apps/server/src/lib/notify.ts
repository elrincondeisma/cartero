import nodemailer, { type Transporter } from 'nodemailer'
import { config } from '../config.js'

let transport: Transporter | undefined

/** Envía un email si hay SMTP configurado. Devuelve false si no se pudo enviar. */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!config.smtp) return false
  transport ??= nodemailer.createTransport(config.smtp)
  try {
    await transport.sendMail({ from: config.smtpFrom, to, subject, text })
    return true
  } catch (e) {
    console.error('Error enviando email', e)
    return false
  }
}

export interface NotifyTarget {
  type: 'email' | 'webhook' | 'slack' | 'discord' | 'telegram'
  /** email, URL del webhook, o "botToken:chatId" para Telegram */
  target: string
  onlyOnFailure?: boolean
}

export interface NotifyPayload {
  title: string
  text: string
  status: 'passed' | 'failed' | 'error'
  url?: string
  data?: unknown
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function notify(targets: NotifyTarget[], payload: NotifyPayload): Promise<string[]> {
  const errors: string[] = []
  const emoji = payload.status === 'passed' ? '✅' : '❌'
  const line = `${emoji} ${payload.title}\n${payload.text}${payload.url ? `\n${payload.url}` : ''}`
  await Promise.all(
    targets
      .filter((t) => !(t.onlyOnFailure && payload.status === 'passed'))
      .map(async (t) => {
        try {
          switch (t.type) {
            case 'email':
              if (!(await sendMail(t.target, `${emoji} ${payload.title}`, line))) throw new Error('SMTP no configurado')
              break
            case 'slack':
              await post(t.target, { text: line })
              break
            case 'discord':
              await post(t.target, { content: line.slice(0, 1900) })
              break
            case 'telegram': {
              const idx = t.target.lastIndexOf(':')
              const token = t.target.slice(0, idx)
              const chatId = t.target.slice(idx + 1)
              await post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text: line })
              break
            }
            case 'webhook':
              await post(t.target, payload)
              break
          }
        } catch (e) {
          errors.push(`${t.type}: ${(e as Error).message}`)
        }
      }),
  )
  return errors
}
