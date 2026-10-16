// src/auth/session.ts
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function sessionExpiresAt(now: Date): string {
  return new Date(now.getTime() + SESSION_TTL_MS).toISOString()
}

/** Rows written before migration 0001 have no expires_at; they age out from created_at. */
export function isSessionExpired(s: { created_at: string; expires_at: string | null }, now: Date): boolean {
  const expires = s.expires_at ? Date.parse(s.expires_at) : Date.parse(s.created_at) + SESSION_TTL_MS
  return !(expires > now.getTime())
}
