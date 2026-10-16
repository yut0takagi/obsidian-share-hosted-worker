import { describe, it, expect } from 'vitest'
import { hit, windowStart, purgeOldRecords } from '../src/auth/rateLimit'
import { FakeD1 } from './helpers/fakeD1'

describe('windowStart', () => {
  it('floors to the window', () => {
    expect(windowStart(new Date('2026-10-16T10:14:59Z'), 15 * 60_000)).toBe('2026-10-16T10:00:00.000Z')
    expect(windowStart(new Date('2026-10-16T10:15:00Z'), 15 * 60_000)).toBe('2026-10-16T10:15:00.000Z')
  })
})

describe('hit', () => {
  it('counts per bucket and window and reports when to retry', async () => {
    const db = new FakeD1() as unknown as D1Database
    const limit = { bucket: 'b', windowMs: 60_000, max: 2 }
    const now = new Date('2026-10-16T10:00:20Z')
    expect(await hit(db, limit, now)).toEqual({ ok: true, retryAfter: 0 })
    expect(await hit(db, limit, now)).toEqual({ ok: true, retryAfter: 0 })
    expect(await hit(db, limit, now)).toEqual({ ok: false, retryAfter: 40 })
    expect(await hit(db, { ...limit, bucket: 'other' }, now)).toEqual({ ok: true, retryAfter: 0 })
    expect(await hit(db, limit, new Date('2026-10-16T10:01:00Z'))).toEqual({ ok: true, retryAfter: 0 })
  })
})

describe('purgeOldRecords', () => {
  it('drops old counters and old sign-in tokens', async () => {
    const fake = new FakeD1()
    const db = fake as unknown as D1Database
    const now = new Date('2026-10-16T00:00:00Z')
    await hit(db, { bucket: 'old', windowMs: 60_000, max: 9 }, new Date('2026-10-10T00:00:00Z'))
    await hit(db, { bucket: 'new', windowMs: 60_000, max: 9 }, now)
    fake.sqlite.exec("INSERT INTO magic_link_tokens (token, email, callback, created_at, expires_at) VALUES ('m_old', 'a@example.com', 'obsidian://x', '2026-10-01T00:00:00Z', '2026-10-01T00:15:00Z'), ('m_new', 'a@example.com', 'obsidian://x', '2026-10-15T23:59:00Z', '2026-10-16T00:14:00Z')")
    await purgeOldRecords(db, now)
    expect(fake.rows('SELECT bucket FROM rate_limits')).toEqual([{ bucket: 'new' }])
    expect(fake.rows('SELECT token FROM magic_link_tokens')).toEqual([{ token: 'm_new' }])
  })
})

describe('purgeOldRecords: auth codes', () => {
  it('drops one-time codes that expired more than a day ago', async () => {
    const fake = new FakeD1()
    fake.sqlite.exec("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@example.com', '2026-01-01T00:00:00Z')")
    fake.sqlite.exec("INSERT INTO auth_codes (code, user_id, state, created_at, expires_at) VALUES ('c_old', 'u1', 's', '2026-10-01T00:00:00Z', '2026-10-01T00:05:00Z'), ('c_new', 'u1', 's', '2026-10-15T23:59:00Z', '2026-10-16T00:04:00Z')")
    await purgeOldRecords(fake as unknown as D1Database, new Date('2026-10-16T00:00:00Z'))
    expect(fake.rows('SELECT code FROM auth_codes')).toEqual([{ code: 'c_new' }])
  })
})

