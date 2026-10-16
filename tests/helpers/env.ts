import { FakeD1 } from './fakeD1'
import { FakeR2 } from './fakeR2'

export interface TestEnv {
  DB: D1Database
  R2: R2Bucket
  db: FakeD1
  r2: FakeR2
  [key: string]: unknown
}

export function makeEnv(vars: Record<string, unknown> = {}): TestEnv {
  const db = new FakeD1()
  const r2 = new FakeR2()
  return { DB: db as unknown as D1Database, R2: r2 as unknown as R2Bucket, db, r2, ...vars }
}

export function makeCtx(): ExecutionContext & { pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = []
  return {
    pending,
    waitUntil: (p: Promise<unknown>) => { pending.push(p) },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext & { pending: Promise<unknown>[] }
}

let seq = 0

/** Creates a user plus a live session and returns the bearer token. */
export function signIn(env: TestEnv, email = 'alice@example.com'): { token: string; userId: string } {
  seq++
  const userId = `u_test${seq}`
  const token = `s_test${seq}`
  const now = new Date().toISOString()
  env.db.sqlite.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(userId, email, now)
  const cols = env.db.rows<{ name: string }>('PRAGMA table_info(sessions)').map((c) => c.name)
  if (cols.includes('expires_at')) {
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    env.db.sqlite.prepare('INSERT INTO sessions (token, user_id, created_at, name, expires_at) VALUES (?, ?, ?, ?, ?)').run(token, userId, now, 'Obsidian', expires)
  } else {
    env.db.sqlite.prepare('INSERT INTO sessions (token, user_id, created_at, name) VALUES (?, ?, ?, ?)').run(token, userId, now, 'Obsidian')
  }
  return { token, userId }
}

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

export function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer
}

export function utf8(text: string): ArrayBuffer {
  const u = new TextEncoder().encode(text)
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
}

export async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', body)
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
