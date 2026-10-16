import type { User, Session, MagicLinkToken } from '../types'

export async function createUser(db: D1Database, u: { id: string; email: string; created_at: string; default_org_domain: string | null; default_owner_name: string | null }): Promise<void> {
  await db.prepare(
    'INSERT INTO users (id, email, created_at, default_org_domain, default_owner_name) VALUES (?, ?, ?, ?, ?)'
  ).bind(u.id, u.email, u.created_at, u.default_org_domain, u.default_owner_name).run()
}

export async function findUserByEmail(db: D1Database, email: string): Promise<User | null> {
  return await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>()
}

export async function findUserById(db: D1Database, id: string): Promise<User | null> {
  return await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>()
}

export async function updateUserProfile(db: D1Database, id: string, patch: { default_org_domain?: string | null; default_owner_name?: string | null }): Promise<void> {
  await db.prepare(
    'UPDATE users SET default_org_domain = ?, default_owner_name = ? WHERE id = ?'
  ).bind(patch.default_org_domain ?? null, patch.default_owner_name ?? null, id).run()
}

export async function createSession(db: D1Database, s: { token: string; user_id: string; created_at: string; name: string | null; expires_at: string }): Promise<void> {
  await db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, name, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(s.token, s.user_id, s.created_at, s.name, s.expires_at).run()
}

export async function findSessionByToken(db: D1Database, token: string): Promise<Session | null> {
  return await db.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first<Session>()
}

export async function touchSession(db: D1Database, token: string, at: string): Promise<void> {
  await db.prepare('UPDATE sessions SET last_used_at = ? WHERE token = ?').bind(at, token).run()
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
}

export async function deleteSessionsForUser(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run()
}

export async function createMagicToken(db: D1Database, t: { token: string; email: string; callback: string; created_at: string; expires_at: string }): Promise<void> {
  await db.prepare(
    'INSERT INTO magic_link_tokens (token, email, callback, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(t.token, t.email, t.callback, t.created_at, t.expires_at).run()
}

export async function findMagicToken(db: D1Database, token: string): Promise<MagicLinkToken | null> {
  return await db.prepare('SELECT * FROM magic_link_tokens WHERE token = ?').bind(token).first<MagicLinkToken>()
}

export async function consumeMagicToken(db: D1Database, token: string, at: string): Promise<void> {
  await db.prepare('UPDATE magic_link_tokens SET used_at = ? WHERE token = ?').bind(at, token).run()
}

/** Marks the token used only if it is still unused and unexpired. True when this call won. */
export async function consumeMagicTokenOnce(db: D1Database, token: string, at: string): Promise<boolean> {
  const r = await db.prepare(
    'UPDATE magic_link_tokens SET used_at = ? WHERE token = ? AND used_at IS NULL AND expires_at > ?'
  ).bind(at, token, at).run()
  return (r.meta?.changes ?? 0) === 1
}

export async function deleteMagicToken(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM magic_link_tokens WHERE token = ?').bind(token).run()
}
