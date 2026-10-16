import { describe, it, expect, vi } from 'vitest'
import { resolveMailConfig, sendMagicLink } from '../src/email/mailer'

describe('resolveMailConfig', () => {
  it('lists every missing setting by name', () => {
    expect(resolveMailConfig({})).toEqual({ ok: false, missing: ['RESEND_API_KEY', 'MAIL_FROM'] })
  })

  it('treats blank values as missing', () => {
    expect(resolveMailConfig({ RESEND_API_KEY: '  ', MAIL_FROM: 'noreply@example.com' })).toEqual({ ok: false, missing: ['RESEND_API_KEY'] })
  })

  it('rejects a sender that is not an email address', () => {
    expect(resolveMailConfig({ RESEND_API_KEY: 'resend-test-key', MAIL_FROM: 'Share Hosted' })).toEqual({ ok: false, missing: ['MAIL_FROM (not an email address)'] })
  })

  it('defaults the sender name', () => {
    expect(resolveMailConfig({ RESEND_API_KEY: 'resend-test-key', MAIL_FROM: 'noreply@example.com' })).toEqual({
      ok: true,
      config: { provider: 'resend', apiKey: 'resend-test-key', from: 'noreply@example.com', fromName: 'Share Hosted' },
    })
  })
})

describe('sendMagicLink via Resend', () => {
  const config = { provider: 'resend' as const, apiKey: 'resend-test-key', from: 'noreply@example.com', fromName: 'Share Hosted' }

  it('posts to the Resend API with auth and a User-Agent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"id":"x"}', { status: 200 }))
    await sendMagicLink(config, { to: 'alice@example.com', magicLink: 'https://w.example/auth/verify?token=m_1' }, fetchImpl)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer resend-test-key')
    expect(init.headers['User-Agent']).toMatch(/^obsidian-share-hosted-worker\//)
    const body = JSON.parse(init.body)
    expect(body.from).toBe('Share Hosted <noreply@example.com>')
    expect(body.to).toEqual(['alice@example.com'])
    expect(body.text).toContain('https://w.example/auth/verify?token=m_1')
  })

  it('throws with the status when Resend refuses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"message":"domain not verified"}', { status: 403 }))
    await expect(sendMagicLink(config, { to: 'alice@example.com', magicLink: 'https://x' }, fetchImpl)).rejects.toThrow(/403/)
  })
})
