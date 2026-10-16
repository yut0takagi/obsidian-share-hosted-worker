import { describe, it, expect, vi, afterEach } from 'vitest'
import { makeEnv, makeCtx, sha256Hex, bytes } from './helpers/env'

vi.mock('../src/auth/cfAccessJwt', () => ({
  verifyAccessJwt: vi.fn(async (jwt: string) => (jwt.startsWith('as:') ? { email: jwt.slice(3) } : null)),
}))

const { app } = await import('../src/index')

const origFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = origFetch })

describe('sign in, share an org note with an image, read it, stop it', () => {
  it('works end to end through the whole app', async () => {
    const env = makeEnv({ RESEND_API_KEY: 'resend-test-key', MAIL_FROM: 'noreply@example.com', CF_ACCESS_TEAM_DOMAIN: 't.example.com', CF_ACCESS_AUD: 'aud' })
    const sent: string[] = []
    globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      sent.push(JSON.parse(init!.body!).text)
      return new Response('{"id":"1"}', { status: 200 })
    }) as any
    const req = (path: string, init: RequestInit = {}) => app.request(`https://w.example${path}`, init, env, makeCtx())

    // 1. The plugin asks for a link with its state.
    const state = 'st_0123456789abcdefghij'
    expect((await req('/auth/request-magic-link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', callback: 'obsidian://share-hosted/auth-callback', state }),
    })).status).toBe(200)
    const link = sent[0].match(/https:\/\/w\.example\/auth\/verify\?token=\S+/)![0]

    // 2. Opening the link (or a scanner fetching it) only shows the confirmation page.
    const page = await req(link.replace('https://w.example', ''))
    expect(page.status).toBe(200)
    const token = (await page.text()).match(/name="token" value="([^"]+)"/)![1]

    // 3. Confirming redirects to Obsidian with a session and the same state.
    const confirm = await req('/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${token}` })
    const cb = new URL(confirm.headers.get('Location')!)
    expect(cb.searchParams.get('state')).toBe(state)
    expect(cb.searchParams.has('api_token')).toBe(false)

    // 3b. The plugin trades the one-time code (and its state) for the session token.
    const exchanged = await req('/auth/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: cb.searchParams.get('code'), state }),
    })
    const { api_token } = await exchanged.json() as { api_token: string }
    const auth = { Authorization: `Bearer ${api_token}` }

    // 4. Upload an image and share an org-wide note that shows it.
    const img = bytes(0x89, 0x50, 0x4e, 0x47, 7, 7, 7)
    const hash = (await sha256Hex(img)).slice(0, 32)
    expect((await req(`/api/asset?hash=${hash}&ext=png`, { method: 'POST', headers: auth, body: img })).status).toBe(200)
    const shared = await req('/api/share', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid: null, mode: 'org', title: 'Plan', source_path: 'Plan.md', html: `<!DOCTYPE html><html><head></head><body><img src="/a/${hash}.png"></body></html>` }),
    })
    const { uuid, url } = await shared.json() as { uuid: string; url: string }
    expect(url).toBe(`https://w.example/n/${uuid}`)

    // 5. A colleague can read it; someone at another domain cannot.
    const read = (who: string) => req(`/n/${uuid}`, { headers: { 'Cf-Access-Jwt-Assertion': `as:${who}` } })
    const ok = await read('bob@example.com')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Content-Security-Policy')).toContain('sandbox')
    expect((await read('eve@example.net')).status).toBe(403)

    // 6. The owner can read the settings back, then stop sharing.
    expect(await (await req(`/api/share/${uuid}`, { headers: auth })).json()).toMatchObject({ mode: 'org', org_domain: 'example.com' })
    env.db.sqlite.prepare('UPDATE assets SET claimed_at = ?').run('2020-01-01T00:00:00.000Z')
    expect((await req(`/api/share/${uuid}`, { method: 'DELETE', headers: auth })).status).toBe(204)
    expect((await read('bob@example.com')).status).toBe(404)
    expect((await req(`/a/${hash}.png`)).status).toBe(404)
  })
})
