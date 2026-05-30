export interface SendMagicLinkParams {
  to: string
  magicLink: string
  fromAddress: string
  fromName: string
}

export async function sendMagicLinkEmail(params: SendMagicLinkParams): Promise<void> {
  const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: params.to }] }],
      from: { email: params.fromAddress, name: params.fromName },
      subject: 'Sign in to Share Hosted',
      content: [
        {
          type: 'text/plain',
          value: `Click to sign in: ${params.magicLink}\n\nThis link expires in 15 minutes. If you didn't request this, ignore this email.`,
        },
      ],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`MailChannels send failed: ${res.status} ${body}`)
  }
}
