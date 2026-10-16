import { describe, it, expect } from 'vitest'
import { isSessionExpired, magicLinkRetryAfter, sessionExpiresAt } from '../src/auth/session'
import { FakeD1 } from './helpers/fakeD1'

const NOW = new Date('2026-10-16T00:00:00.000Z')

describe('isSessionExpired', () => {
  it('uses expires_at when present', () => {
    expect(isSessionExpired({ created_at: '2026-10-01T00:00:00Z', expires_at: '2026-10-15T00:00:00Z' }, NOW)).toBe(true)
    expect(isSessionExpired({ created_at: '2026-10-01T00:00:00Z', expires_at: '2026-10-17T00:00:00Z' }, NOW)).toBe(false)
  })

  it('falls back to created_at + 30 days for rows without expires_at', () => {
    expect(isSessionExpired({ created_at: '2026-09-01T00:00:00Z', expires_at: null }, NOW)).toBe(true)
    expect(isSessionExpired({ created_at: '2026-10-01T00:00:00Z', expires_at: null }, NOW)).toBe(false)
  })

  it('sets new sessions to expire 30 days out', () => {
    expect(sessionExpiresAt(NOW)).toBe('2026-11-15T00:00:00.000Z')
  })
})

describe('magicLinkRetryAfter', () => {
  it('is 0 without an earlier link or after 5 minutes', () => {
    expect(magicLinkRetryAfter(null, NOW)).toBe(0)
    expect(magicLinkRetryAfter('2026-10-15T23:54:59.000Z', NOW)).toBe(0)
  })

  it('counts the seconds left in the 5-minute window', () => {
    expect(magicLinkRetryAfter('2026-10-15T23:59:00.000Z', NOW)).toBe(240)
  })
})

describe('migration 0001', () => {
  it('gives sessions that existed before it 30 days from when it runs', () => {
    const db = new FakeD1({ migrations: false })
    db.sqlite.exec("INSERT INTO users (id, email, created_at) VALUES ('u1', 'alice@example.com', '2026-01-01T00:00:00Z')")
    db.sqlite.exec("INSERT INTO sessions (token, user_id, created_at, name) VALUES ('s_old', 'u1', '2026-01-01T00:00:00Z', 'Obsidian')")
    db.applyMigrations()
    const [row] = db.rows<{ expires_at: string }>("SELECT expires_at FROM sessions WHERE token = 's_old'")
    const days = (Date.parse(row.expires_at) - Date.now()) / 86400000
    expect(days).toBeGreaterThan(29.9)
    expect(days).toBeLessThan(30.1)
  })
})
