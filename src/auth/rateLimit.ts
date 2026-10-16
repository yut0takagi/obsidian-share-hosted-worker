// src/auth/rateLimit.ts
// Fixed-window counters in D1 for sign-in email. Three limits apply:
// - per address *and* IP: a few links per 15 minutes, so nobody elsewhere can use up the
//   allowance of the person actually signing in;
// - per IP: bounds how much one source can send in total;
// - per day: protects the operator's email quota and sender reputation.

export interface Limit { bucket: string; windowMs: number; max: number }

export const ADDRESS_WINDOW_MS = 15 * 60 * 1000
export const ADDRESS_MAX = 3
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export function windowStart(now: Date, windowMs: number): string {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs).toISOString()
}

/** Counts one attempt; ok is false once the window already had `max` attempts. */
export async function hit(db: D1Database, limit: Limit, now: Date): Promise<{ ok: boolean; retryAfter: number }> {
  const start = windowStart(now, limit.windowMs)
  const count = await db.prepare(
    'INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1) ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1 RETURNING count'
  ).bind(limit.bucket, start).first<number>('count')
  if ((count ?? 0) <= limit.max) return { ok: true, retryAfter: 0 }
  return { ok: false, retryAfter: Math.max(1, Math.ceil((Date.parse(start) + limit.windowMs - now.getTime()) / 1000)) }
}

async function digest(value: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(d).slice(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export interface SignInLimitEnv { SIGN_IN_PER_IP_PER_HOUR?: string; MAIL_DAILY_LIMIT?: string }

export async function signInLimits(env: SignInLimitEnv, email: string, ip: string): Promise<{ address: Limit; ip: Limit; day: Limit }> {
  const ipKey = await digest(`ip:${ip}`)
  return {
    address: { bucket: `addr:${await digest(`addr:${email}`)}:${ipKey}`, windowMs: ADDRESS_WINDOW_MS, max: ADDRESS_MAX },
    ip: { bucket: `ip:${ipKey}`, windowMs: HOUR_MS, max: positiveInt(env.SIGN_IN_PER_IP_PER_HOUR, 10) },
    day: { bucket: 'mail:day', windowMs: DAY_MS, max: positiveInt(env.MAIL_DAILY_LIMIT, 100) },
  }
}

/** Removes counters older than two days and sign-in tokens that expired more than a day ago. */
export async function purgeOldRecords(db: D1Database, now: Date): Promise<void> {
  await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(new Date(now.getTime() - 2 * DAY_MS).toISOString()).run()
  await db.prepare('DELETE FROM magic_link_tokens WHERE expires_at < ?').bind(new Date(now.getTime() - DAY_MS).toISOString()).run()
}
