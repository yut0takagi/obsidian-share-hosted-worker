import { describe, it, expect, beforeEach } from 'vitest'
import * as q from '../../src/db/queries'

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
  else if (s.startsWith('update sessions set last_used_at')) { const x = db.rows.sessions.find((r: any) => r.token === p[1]); if (x) x.last_used_at = p[0] }
  else if (s.startsWith('update users set default_org_domain')) { const x = db.rows.users.find((r: any) => r.id === p[2]); if (x) { x.default_org_domain = p[0]; x.default_owner_name = p[1] } }
  else if (s.startsWith('delete from sessions')) db.rows.sessions = db.rows.sessions.filter((r: any) => r.token !== p[0])
}
function sel(db: any, sql: string, p: any[]): any[] {
  const s = sql.trim().toLowerCase()
  if (s.startsWith('select * from users where email')) return db.rows.users.filter((r: any) => r.email === p[0])
  if (s.startsWith('select * from users where id')) return db.rows.users.filter((r: any) => r.id === p[0])
  if (s.startsWith('select * from sessions where token')) return db.rows.sessions.filter((r: any) => r.token === p[0])
  if (s.startsWith('select * from magic_link_tokens where token')) return db.rows.magic_link_tokens.filter((r: any) => r.token === p[0])
  return []
}

describe('queries', () => {
  let db: any
  beforeEach(() => { db = new FakeD1() })

  it('creates+finds user by email', async () => {
    await q.createUser(db, { id: 'u_abc', email: 'a@b.com', created_at: '2026-05-30T00:00:00Z', default_org_domain: null, default_owner_name: null })
    expect((await q.findUserByEmail(db, 'a@b.com'))?.id).toBe('u_abc')
  })

  it('returns null for unknown email', async () => {
    expect(await q.findUserByEmail(db, 'no@x.com')).toBeNull()
  })

  it('updates user profile', async () => {
    await q.createUser(db, { id: 'u_abc', email: 'a@b.com', created_at: '2026-05-30T00:00:00Z', default_org_domain: null, default_owner_name: null })
    await q.updateUserProfile(db, 'u_abc', { default_org_domain: 'x.com', default_owner_name: 'Alice' })
    const u = await q.findUserById(db, 'u_abc')
    expect(u?.default_org_domain).toBe('x.com')
    expect(u?.default_owner_name).toBe('Alice')
  })

  it('creates+finds+deletes session', async () => {
    await q.createSession(db, { token: 's_xyz', user_id: 'u_abc', created_at: '2026-05-30T00:00:00Z', name: 'Obsidian', expires_at: '2026-06-29T00:00:00Z' })
    expect((await q.findSessionByToken(db, 's_xyz'))?.user_id).toBe('u_abc')
    await q.deleteSession(db, 's_xyz')
    expect(await q.findSessionByToken(db, 's_xyz')).toBeNull()
  })

  it('creates+consumes magic token', async () => {
    await q.createMagicToken(db, { token: 'm_abc', email: 'a@b.com', callback: 'obsidian://x', created_at: '2026-05-30T00:00:00Z', expires_at: '2026-05-30T00:15:00Z' })
    expect((await q.findMagicToken(db, 'm_abc'))?.email).toBe('a@b.com')
    await q.consumeMagicToken(db, 'm_abc', '2026-05-30T00:05:00Z')
    expect((await q.findMagicToken(db, 'm_abc'))?.used_at).toBe('2026-05-30T00:05:00Z')
  })
})
