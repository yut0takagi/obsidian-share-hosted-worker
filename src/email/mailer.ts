// src/email/mailer.ts
// Sign-in email goes through an API that needs an operator-owned key and a verified sender
// domain. (MailChannels' free path for Workers ended on 2024-08-31.) Settings come from
// the Worker environment: RESEND_API_KEY as a secret, MAIL_FROM / MAIL_FROM_NAME as vars.
import { EMAIL_RE } from '../util/email'

export interface MailEnv {
  RESEND_API_KEY?: string
  MAIL_FROM?: string
  MAIL_FROM_NAME?: string
}

export interface MailConfig {
  provider: 'resend'
  apiKey: string
  from: string
  fromName: string
}

export type MailConfigResult = { ok: true; config: MailConfig } | { ok: false; missing: string[] }

export function resolveMailConfig(env: MailEnv): MailConfigResult {
  const apiKey = (env.RESEND_API_KEY ?? '').trim()
  const from = (env.MAIL_FROM ?? '').trim()
  const missing: string[] = []
  if (!apiKey) missing.push('RESEND_API_KEY')
  if (!from) missing.push('MAIL_FROM')
  else if (!EMAIL_RE.test(from)) missing.push('MAIL_FROM (not an email address)')
  if (missing.length) return { ok: false, missing }
  return { ok: true, config: { provider: 'resend', apiKey, from, fromName: (env.MAIL_FROM_NAME ?? '').trim() || 'Share Hosted' } }
}

export interface MagicLinkMail {
  to: string
  magicLink: string
}

type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>

export async function sendMagicLink(config: MailConfig, mail: MagicLinkMail, fetchImpl: FetchLike = fetch): Promise<void> {
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      // Resend rejects requests without a User-Agent, and Workers do not add one.
      'User-Agent': 'obsidian-share-hosted-worker/0.2.0',
    },
    body: JSON.stringify({
      from: `${config.fromName} <${config.from}>`,
      to: [mail.to],
      subject: 'Sign in to Share Hosted',
      text: [
        'Open this link to sign in to Share Hosted in Obsidian:',
        '',
        mail.magicLink,
        '',
        'The page asks you to confirm before Obsidian opens. The link expires in 15 minutes and works once.',
        "If you didn't ask to sign in, you can ignore this email.",
      ].join('\n'),
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Resend send failed: ${res.status} ${body.slice(0, 200)}`)
  }
}
