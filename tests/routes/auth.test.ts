import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import authRoute from '../../src/routes/auth'
import shareRoute from '../../src/routes/share'
import { makeEnv, makeCtx, signIn, bearer, type TestEnv } from '../helpers/env'

const CALLBACK = 'obsidian://share-hosted/auth-callback'
const STATE = 'st_0123456789abcdef'

function app() {
  const a = new Hono()
  a.route('/', authRoute)
  a.route('/', shareRoute)
  return a
}

let env: TestEnv
const origFetch = globalThis.fetch
beforeEach(() => {
  env = makeEnv({ MAILCHANNELS_FROM: 'noreply@example.dev', MAILCHANNELS_FROM_NAME: 'Share' })
  globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 202 })) as any
})
afterEach(() => { globalThis.fetch = origFetch; vi.useRealTimers() })

async function requestLink(body: Record<string, unknown>) {
  return app().request('/auth/request-magic-link', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env, makeCtx())
}

function seedToken(token: string, over: Record<string, unknown> = {}) {
  const row = {
    email: 'alice@example.com', callback: CALLBACK,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    used_at: null, ...over,
  }
  env.db.sqlite.prepare('INSERT INTO magic_link_tokens (token, email, callback, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(token, row.email, row.callback, row.created_at, row.expires_at, row.used_at)
}

async function confirm(token: string) {
  return app().request('/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  }, env, makeCtx())
}

describe('POST /auth/request-magic-link', () => {
  it('rejects invalid email', async () => {
    expect((await requestLink({ email: 'not-an-email', callback: CALLBACK })).status).toBe(400)
  })

  it('rejects non-obsidian:// callback', async () => {
    expect((await requestLink({ email: 'alice@example.com', callback: 'https://evil.example' })).status).toBe(400)
  })

  it('rejects obsidian:// callbacks other than this plugin', async () => {
    expect((await requestLink({ email: 'alice@example.com', callback: 'obsidian://other-plugin/x' })).status).toBe(400)
  })

  it('creates a magic token and sends one email', async () => {
    const res = await requestLink({ email: 'alice@example.com', callback: CALLBACK })
    expect(res.status).toBe(200)
    expect(env.db.rows('SELECT * FROM magic_link_tokens')).toHaveLength(1)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('sends at most one link per address every 5 minutes', async () => {
    expect((await requestLink({ email: 'alice@example.com', callback: CALLBACK })).status).toBe(200)
    const again = await requestLink({ email: 'Alice@example.com', callback: CALLBACK })
    expect(again.status).toBe(429)
    expect(Number(again.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('allows another link once 5 minutes have passed', async () => {
    seedToken('m_old', { created_at: new Date(Date.now() - 6 * 60 * 1000).toISOString() })
    expect((await requestLink({ email: 'alice@example.com', callback: CALLBACK })).status).toBe(200)
  })

  it('stores the plugin state on the callback', async () => {
    await requestLink({ email: 'alice@example.com', callback: CALLBACK, state: STATE })
    const [row] = env.db.rows<{ callback: string }>('SELECT callback FROM magic_link_tokens')
    expect(new URL(row.callback).searchParams.get('state')).toBe(STATE)
  })

  it('rejects a malformed state', async () => {
    expect((await requestLink({ email: 'alice@example.com', callback: CALLBACK, state: 'a b' })).status).toBe(400)
  })
})

describe('GET /auth/verify', () => {
  it('returns 400 when token missing', async () => {
    expect((await app().request('/auth/verify', {}, env, makeCtx())).status).toBe(400)
  })

  it('returns 410 when token expired', async () => {
    seedToken('m_old', { created_at: '2020-01-01T00:00:00Z', expires_at: '2020-01-01T00:01:00Z' })
    expect((await app().request('/auth/verify?token=m_old', {}, env, makeCtx())).status).toBe(410)
  })

  it('shows a confirmation page and does not use up the token', async () => {
    seedToken('m_ok')
    const res = await app().request('/auth/verify?token=m_ok', {}, env, makeCtx())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    const html = await res.text()
    expect(html).toMatch(/<form method="post" action="\/auth\/verify">/)
    expect(html).toContain('value="m_ok"')
    expect(env.db.rows('SELECT used_at FROM magic_link_tokens')[0]).toEqual({ used_at: null })
    expect(env.db.rows('SELECT * FROM sessions')).toHaveLength(0)
  })

  it('lets the confirmation form post back and open Obsidian', async () => {
    seedToken('m_ok')
    const html = await (await app().request('/auth/verify?token=m_ok', {}, env, makeCtx())).text()
    const csp = (await app().request('/auth/verify?token=m_ok', {}, env, makeCtx())).headers.get('Content-Security-Policy')!
    expect(csp).toContain("form-action 'self' obsidian:")
    expect(csp).toContain("default-src 'none'")
    expect(html).not.toContain('<script')
  })

  it('escapes the token in the page', async () => {
    const res = await app().request(`/auth/verify?token=${encodeURIComponent('"><b>x')}`, {}, env, makeCtx())
    expect(await res.text()).not.toContain('"><b>x')
  })
})

describe('POST /auth/verify', () => {
  it('redirects to the obsidian:// callback with a session token', async () => {
    seedToken('m_ok')
    const res = await confirm('m_ok')
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toMatch(/^obsidian:\/\/share-hosted\/auth-callback\?api_token=s_/)
    expect(env.db.rows('SELECT * FROM users')).toHaveLength(1)
    expect(env.db.rows('SELECT * FROM sessions')).toHaveLength(1)
  })

  it('passes the stored state back to the plugin', async () => {
    seedToken('m_ok', { callback: `${CALLBACK}?state=${STATE}` })
    const loc = new URL((await confirm('m_ok')).headers.get('Location')!)
    expect(loc.searchParams.get('state')).toBe(STATE)
    expect(loc.searchParams.get('email')).toBe('alice@example.com')
  })

  it('works only once', async () => {
    seedToken('m_ok')
    expect((await confirm('m_ok')).status).toBe(303)
    expect((await confirm('m_ok')).status).toBe(410)
    expect(env.db.rows('SELECT * FROM sessions')).toHaveLength(1)
  })

  it('refuses expired tokens', async () => {
    seedToken('m_old', { created_at: '2020-01-01T00:00:00Z', expires_at: '2020-01-01T00:01:00Z' })
    expect((await confirm('m_old')).status).toBe(410)
  })

  it('gives sessions a 30-day expiry', async () => {
    seedToken('m_ok')
    await confirm('m_ok')
    const [s] = env.db.rows<{ created_at: string; expires_at: string }>('SELECT created_at, expires_at FROM sessions')
    const days = (Date.parse(s.expires_at) - Date.parse(s.created_at)) / 86400000
    expect(days).toBeCloseTo(30, 3)
  })
})

describe('sessions', () => {
  it('rejects expired sessions and deletes them', async () => {
    const { token } = signIn(env)
    env.db.sqlite.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run('2020-01-01T00:00:00.000Z', token)
    const res = await app().request('/auth/me', { headers: bearer(token) }, env, makeCtx())
    expect(res.status).toBe(401)
    expect(env.db.rows('SELECT * FROM sessions WHERE token = ?', token)).toHaveLength(0)
  })

  it('POST /auth/logout deletes the current session only', async () => {
    const a = signIn(env, 'alice@example.com')
    const res = await app().request('/auth/logout', { method: 'POST', headers: bearer(a.token) }, env, makeCtx())
    expect(res.status).toBe(204)
    expect(env.db.rows('SELECT * FROM sessions WHERE token = ?', a.token)).toHaveLength(0)
    expect((await app().request('/auth/me', { headers: bearer(a.token) }, env, makeCtx())).status).toBe(401)
  })

  it('POST /auth/logout-all deletes every session of the account', async () => {
    const a = signIn(env, 'alice@example.com')
    const other = signIn(env, 'bob@example.com')
    env.db.sqlite.prepare('INSERT INTO sessions (token, user_id, created_at, name, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run('s_second_device', a.userId, new Date().toISOString(), 'Obsidian', new Date(Date.now() + 86400000).toISOString())
    const res = await app().request('/auth/logout-all', { method: 'POST', headers: bearer(a.token) }, env, makeCtx())
    expect(res.status).toBe(204)
    expect(env.db.rows('SELECT * FROM sessions WHERE user_id = ?', a.userId)).toHaveLength(0)
    expect(env.db.rows('SELECT * FROM sessions WHERE token = ?', other.token)).toHaveLength(1)
  })
})
