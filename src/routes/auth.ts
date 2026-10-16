// src/routes/auth.ts
import { Hono } from 'hono'
import * as q from '../db/queries'
import { userId, sessionToken, magicToken } from '../db/nanoid'
import { sendMagicLinkEmail } from '../email/mailchannels'
import { sessionMiddleware } from '../auth/sessionMiddleware'
import { orgDomainFor } from '../auth/orgDomain'
import { sessionExpiresAt, magicLinkRetryAfter } from '../auth/session'
import { renderConfirmPage, renderMessagePage, VERIFY_PAGE_HEADERS } from '../auth/verifyPage'
import { EMAIL_RE, normalizeEmail } from '../util/email'

type Bindings = {
  DB: D1Database
  MAILCHANNELS_FROM: string
  MAILCHANNELS_FROM_NAME: string
}

const route = new Hono<{ Bindings: Bindings; Variables: { session: any; userId: string } }>()

const CALLBACK_RE = /^obsidian:\/\/share-hosted\/auth-callback(?:\?|$)/
const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/
const MAGIC_TTL_MS = 15 * 60 * 1000

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

  const now = new Date()
  const retryAfter = magicLinkRetryAfter(await q.latestMagicTokenAt(c.env.DB, email), now)
  if (retryAfter > 0) {
    c.header('Retry-After', String(retryAfter))
    return c.json({ error: 'rate_limited', message: 'A sign-in link was sent to this address recently. Check your inbox or try again in a few minutes.', retry_after: retryAfter }, 429)
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
    await sendMagicLinkEmail({
      to: email,
      magicLink: verifyUrl,
      fromAddress: c.env.MAILCHANNELS_FROM,
      fromName: c.env.MAILCHANNELS_FROM_NAME,
    })
  } catch (e: any) {
    console.error('[auth] mail send failed:', e?.message)
    return c.json({ error: 'email send failed; try again later' }, 502)
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
  const sToken = sessionToken()
  await q.createSession(c.env.DB, {
    token: sToken,
    user_id: user.id,
    created_at: now.toISOString(),
    name: 'Obsidian',
    expires_at: sessionExpiresAt(now),
  })

  const callback = new URL(row!.callback)
  callback.searchParams.set('api_token', sToken)
  callback.searchParams.set('email', user.email)
  return new Response(null, { status: 303, headers: { Location: callback.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
})

route.get('/auth/me', sessionMiddleware, async (c) => {
  const userIdVar = c.get('userId')
  const user = await q.findUserById(c.env.DB, userIdVar)
  if (!user) return c.json({ error: 'user not found' }, 404)
  return c.json({ user, org: orgDomainFor(user.email) })
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
  return c.json({ user, org: user ? orgDomainFor(user.email) : null })
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
