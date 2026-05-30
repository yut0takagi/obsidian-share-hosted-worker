import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import authRoute from '../../src/routes/auth'

class FakeD1 {
  rows: any = { users: [], sessions: [], magic_link_tokens: [] }
  prepare(sql: string) { return new FakeStmt(this, sql) }
}
class FakeStmt {
  private params: any[] = []
  constructor(private db: any, private sql: string) {}
  bind(...args: any[]) { this.params = args; return this }
  async run() { exec(this.db, this.sql, this.params); return { meta: {} } }
  async first<T>() { const r = sel(this.db, this.sql, this.params); return (r[0] as T) ?? null }
  async all<T>() { return { results: sel(this.db, this.sql, this.params) as T[] } }
}
function exec(db: any, sql: string, p: any[]) {
  const s = sql.trim().toLowerCase()
  if (s.startsWith('insert into users')) db.rows.users.push({ id: p[0], email: p[1], created_at: p[2], default_org_domain: p[3], default_owner_name: p[4] })
  else if (s.startsWith('insert into sessions')) db.rows.sessions.push({ token: p[0], user_id: p[1], created_at: p[2], name: p[3], last_used_at: null })
  else if (s.startsWith('insert into magic_link_tokens')) db.rows.magic_link_tokens.push({ token: p[0], email: p[1], callback: p[2], created_at: p[3], expires_at: p[4], used_at: null })
  else if (s.startsWith('update magic_link_tokens')) { const t = db.rows.magic_link_tokens.find((r: any) => r.token === p[1]); if (t) t.used_at = p[0] }
}
function sel(db: any, sql: string, p: any[]): any[] {
  const s = sql.trim().toLowerCase()
  if (s.startsWith('select * from users where email')) return db.rows.users.filter((r: any) => r.email === p[0])
  if (s.startsWith('select * from users where id')) return db.rows.users.filter((r: any) => r.id === p[0])
  if (s.startsWith('select * from magic_link_tokens where token')) return db.rows.magic_link_tokens.filter((r: any) => r.token === p[0])
  return []
}

const origFetch = globalThis.fetch
beforeEach(() => { globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 202 })) as any })
afterEach(() => { globalThis.fetch = origFetch })

describe('POST /auth/request-magic-link', () => {
  it('rejects invalid email', async () => {
    const env: any = { DB: new FakeD1(), MAILCHANNELS_FROM: 'noreply@x.dev', MAILCHANNELS_FROM_NAME: 'Share' }
    const app = new Hono(); app.route('/', authRoute)
    const res = await app.request('/auth/request-magic-link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', callback: 'obsidian://x' }),
    }, env)
    expect(res.status).toBe(400)
  })

  it('rejects non-obsidian:// callback', async () => {
    const env: any = { DB: new FakeD1(), MAILCHANNELS_FROM: 'noreply@x.dev', MAILCHANNELS_FROM_NAME: 'Share' }
    const app = new Hono(); app.route('/', authRoute)
    const res = await app.request('/auth/request-magic-link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', callback: 'https://evil.com' }),
    }, env)
    expect(res.status).toBe(400)
  })

  it('creates magic token and sends email', async () => {
    const env: any = { DB: new FakeD1(), MAILCHANNELS_FROM: 'noreply@x.dev', MAILCHANNELS_FROM_NAME: 'Share' }
    const app = new Hono(); app.route('/', authRoute)
    const res = await app.request('/auth/request-magic-link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', callback: 'obsidian://share-hosted/auth-callback' }),
    }, env)
    expect(res.status).toBe(200)
    expect(env.DB.rows.magic_link_tokens.length).toBe(1)
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe('https://api.mailchannels.net/tx/v1/send')
  })
})

describe('GET /auth/verify', () => {
  it('returns 400 when token missing', async () => {
    const env: any = { DB: new FakeD1() }
    const app = new Hono(); app.route('/', authRoute)
    const res = await app.request('/auth/verify', {}, env)
    expect(res.status).toBe(400)
  })

  it('returns 410 when token expired', async () => {
    const db = new FakeD1()
    db.rows.magic_link_tokens.push({ token: 'm_old', email: 'a@b.com', callback: 'obsidian://x', created_at: '2020-01-01T00:00:00Z', expires_at: '2020-01-01T00:01:00Z', used_at: null })
    const env: any = { DB: db }
    const app = new Hono(); app.route('/', authRoute)
    const res = await app.request('/auth/verify?token=m_old', {}, env)
    expect(res.status).toBe(410)
  })

  it('redirects to obsidian:// callback when token valid', async () => {
    const db = new FakeD1()
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    db.rows.magic_link_tokens.push({ token: 'm_ok', email: 'a@b.com', callback: 'obsidian://share-hosted/auth-callback', created_at: '2026-05-30T00:00:00Z', expires_at: future, used_at: null })
    const env: any = { DB: db }
    const app = new Hono(); app.route('/', authRoute)
    const res = await app.request('/auth/verify?token=m_ok', {}, env)
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toMatch(/^obsidian:\/\/share-hosted\/auth-callback\?api_token=s_/)
    expect(db.rows.users.length).toBe(1)
    expect(db.rows.sessions.length).toBe(1)
  })
})
