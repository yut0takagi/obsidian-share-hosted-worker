// src/routes/auth.ts
import { Hono } from 'hono'
import * as q from '../db/queries'
import { userId, sessionToken, magicToken, authCode } from '../db/nanoid'
import { resolveMailConfig, sendMagicLink, type MailEnv } from '../email/mailer'
import { sessionMiddleware } from '../auth/sessionMiddleware'
import { orgDomainFor, parseExtraFreeMailDomains } from '../auth/orgDomain'
import { sessionExpiresAt } from '../auth/session'
import { hit, signInLimits, type SignInLimitEnv } from '../auth/rateLimit'
import { renderConfirmPage, renderMessagePage, VERIFY_PAGE_HEADERS } from '../auth/verifyPage'
import { EMAIL_RE, normalizeEmail } from '../util/email'

type Bindings = { DB: D1Database; EXTRA_FREE_MAIL_DOMAINS?: string } & MailEnv & SignInLimitEnv

const route = new Hono<{ Bindings: Bindings; Variables: { session: any; userId: string } }>()

const CALLBACK_RE = /^obsidian:\/\/share-hosted\/auth-callback(?:\?|$)/
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/
const MAGIC_TTL_MS = 15 * 60 * 1000
const AUTH_CODE_TTL_MS = 5 * 60 * 1000
const AUTH_CODE_RE = /^c_[A-Za-z0-9_-]{32}$/

route.post('/auth/request-magic-link', async (c) => {
  let body: { email?: string; callback?: string; state?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid json' }, 400) }
  const email = normalizeEmail(body.email || '')
  const callbackRaw = (body.callback || '').trim()
  if (!email || !EMAIL_RE.test(email)) return c.json({ error: 'invalid email' }, 400)
  if (!callbackRaw || !CALLBACK_RE.test(callbackRaw)) return c.json({ error: 'invalid callback' }, 400)
  if (body.state !== undefined && (typeof body.state !== 'string' || !STATE_RE.test(body.state))) {
    return c.json({ error: 'invalid state' }, 400)
  }

  const mail = resolveMailConfig(c.env)
  if (!mail.ok) {
    console.error('[auth] sign-in email is not configured; missing:', mail.missing.join(', '))
    return c.json({ error: 'email_not_configured', message: 'Sign-in email is not set up on this server yet.', missing: mail.missing }, 503)
  }

  const now = new Date()
  const limits = await signInLimits(c.env, email, c.req.header('CF-Connecting-IP') || 'unknown')
  const checks = [
    { limit: limits.address, error: 'rate_limited', message: 'A few sign-in links were sent to this address recently. Check your inbox or try again in a few minutes.' },
    { limit: limits.ip, error: 'rate_limited', message: 'Too many sign-in requests from this network. Try again later.' },
    { limit: limits.day, error: 'daily_limit', message: 'Sign-in email is paused for today. Try again tomorrow.' },
  ]
  for (const { limit, error, message } of checks) {
    const r = await hit(c.env.DB, limit, now)
    if (!r.ok) {
      c.header('Retry-After', String(r.retryAfter))
      return c.json({ error, message, retry_after: r.retryAfter }, 429)
    }
  }

  // The plugin's state rides on the callback, so the protocol handler gets it back unchanged.
  const callback = new URL(callbackRaw)
  if (body.state) callback.searchParams.set('state', body.state)

  const token = magicToken()
  await q.createMagicToken(c.env.DB, {
    token,
    email,
    callback: callback.toString(),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + MAGIC_TTL_MS).toISOString(),
  })

  const origin = new URL(c.req.url).origin
  const verifyUrl = `${origin}/auth/verify?token=${encodeURIComponent(token)}`

  try {
    await sendMagicLink(mail.config, { to: email, magicLink: verifyUrl })
  } catch (e: any) {
    console.error('[auth] mail send failed:', e?.message)
    // Nothing was delivered, so do not let this attempt count against the rate limit.
    await q.deleteMagicToken(c.env.DB, token)
    return c.json({ error: 'email_send_failed', message: 'Could not send the sign-in email. Try again later.' }, 502)
  }

  return c.json({ ok: true, message: 'Magic link sent' })
})

function checkToken(row: { used_at: string | null; expires_at: string } | null): string | null {
  if (!row) return 'This sign-in link is not valid.'
  if (row.used_at) return 'This sign-in link has already been used.'
  if (new Date(row.expires_at) < new Date()) return 'This sign-in link has expired.'
  return null
}

route.get('/auth/verify', async (c) => {
  const token = c.req.query('token')
  if (!token) return new Response(renderMessagePage('Sign-in link incomplete', 'The link is missing its token. Open the link from the email again.'), { status: 400, headers: VERIFY_PAGE_HEADERS })

  const row = await q.findMagicToken(c.env.DB, token)
  const problem = checkToken(row)
  if (problem) return new Response(renderMessagePage('Cannot sign in', `${problem} Request a new link from Obsidian settings.`), { status: 410, headers: VERIFY_PAGE_HEADERS })

  return new Response(renderConfirmPage(token, row!.email), { status: 200, headers: VERIFY_PAGE_HEADERS })
})

route.post('/auth/verify', async (c) => {
  const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>))
  const token = typeof form.token === 'string' ? form.token : ''
  if (!token) return new Response(renderMessagePage('Sign-in link incomplete', 'The link is missing its token.'), { status: 400, headers: VERIFY_PAGE_HEADERS })

  const row = await q.findMagicToken(c.env.DB, token)
  const nowIso = new Date().toISOString()
  // The conditional update makes a second submit (or a race) lose cleanly.
  if (checkToken(row) || !(await q.consumeMagicTokenOnce(c.env.DB, token, nowIso))) {
    return new Response(renderMessagePage('Cannot sign in', 'This sign-in link is no longer valid. Request a new link from Obsidian settings.'), { status: 410, headers: VERIFY_PAGE_HEADERS })
  }

  let user = await q.findUserByEmail(c.env.DB, row!.email)
  if (!user) {
    const id = userId()
    await q.createUser(c.env.DB, {
      id,
      email: row!.email,
      created_at: nowIso,
      default_org_domain: null,
      default_owner_name: null,
    })
    user = (await q.findUserById(c.env.DB, id))!
  }

  const now = new Date()
  const callback = new URL(row!.callback)
  const state = callback.searchParams.get('state')
  if (state) {
    // Plugins that send a state get a short-lived one-time code; the session token is handed
    // over by /auth/exchange so it never sits in a URL or the browser history.
    const code = authCode()
    await q.createAuthCode(c.env.DB, {
      code,
      user_id: user.id,
      state,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + AUTH_CODE_TTL_MS).toISOString(),
    })
    callback.searchParams.set('code', code)
  } else {
    // 0.1.0 plugins expect the token on the callback.
    const sToken = await startSession(c.env.DB, user.id, now)
    callback.searchParams.set('api_token', sToken)
    callback.searchParams.set('email', user.email)
  }
  return new Response(null, { status: 303, headers: { Location: callback.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
})

route.post('/auth/exchange', async (c) => {
  let body: { code?: unknown; state?: unknown }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid json' }, 400) }
  c.header('Cache-Control', 'no-store')
  const code = typeof body.code === 'string' ? body.code : ''
  const state = typeof body.state === 'string' ? body.state : ''
  if (!AUTH_CODE_RE.test(code) || !STATE_RE.test(state)) return c.json({ error: 'invalid_code' }, 400)

  const now = new Date()
  const uid = await q.consumeAuthCode(c.env.DB, code, state, now.toISOString())
  const user = uid ? await q.findUserById(c.env.DB, uid) : null
  if (!user) return c.json({ error: 'invalid_code', message: 'This sign-in has expired or was already used. Send a new link from Obsidian settings.' }, 400)

  const sToken = await startSession(c.env.DB, user.id, now)
  return c.json({ api_token: sToken, email: user.email })
})

async function startSession(db: D1Database, uid: string, now: Date): Promise<string> {
  const token = sessionToken()
  await q.createSession(db, {
    token,
    user_id: uid,
    created_at: now.toISOString(),
    name: 'Obsidian',
    expires_at: sessionExpiresAt(now),
  })
  return token
}

route.get('/auth/me', sessionMiddleware, async (c) => {
  const userIdVar = c.get('userId')
  const user = await q.findUserById(c.env.DB, userIdVar)
  if (!user) return c.json({ error: 'user not found' }, 404)
  return c.json({ user, org: orgDomainFor(user.email, parseExtraFreeMailDomains(c.env.EXTRA_FREE_MAIL_DOMAINS)) })
})

route.patch('/auth/me', sessionMiddleware, async (c) => {
  let body: { default_org_domain?: string | null; default_owner_name?: string | null }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid json' }, 400) }
  const userIdVar = c.get('userId')
  await q.updateUserProfile(c.env.DB, userIdVar, {
    default_org_domain: body.default_org_domain ?? null,
    default_owner_name: body.default_owner_name ?? null,
  })
  const user = await q.findUserById(c.env.DB, userIdVar)
  return c.json({ user, org: user ? orgDomainFor(user.email, parseExtraFreeMailDomains(c.env.EXTRA_FREE_MAIL_DOMAINS)) : null })
})

route.post('/auth/logout', sessionMiddleware, async (c) => {
  const session = c.get('session')
  await q.deleteSession(c.env.DB, session.token)
  return c.body(null, 204)
})

// Signs the account out everywhere, e.g. after losing a device.
route.post('/auth/logout-all', sessionMiddleware, async (c) => {
  await q.deleteSessionsForUser(c.env.DB, c.get('userId'))
  return c.body(null, 204)
})

export default route
