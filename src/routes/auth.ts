// src/routes/auth.ts
import { Hono } from 'hono'
import * as q from '../db/queries'
import { userId, sessionToken, magicToken } from '../db/nanoid'
import { sendMagicLinkEmail } from '../email/mailchannels'
import { sessionMiddleware } from '../auth/sessionMiddleware'

type Bindings = {
  DB: D1Database
  MAILCHANNELS_FROM: string
  MAILCHANNELS_FROM_NAME: string
}

const route = new Hono<{ Bindings: Bindings; Variables: { session: any; userId: string } }>()

const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i
const CALLBACK_RE = /^obsidian:\/\//
const MAGIC_TTL_MS = 15 * 60 * 1000

route.post('/auth/request-magic-link', async (c) => {
  let body: { email?: string; callback?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid json' }, 400) }
  const email = (body.email || '').trim().toLowerCase()
  const callback = (body.callback || '').trim()
  if (!email || !EMAIL_RE.test(email)) return c.json({ error: 'invalid email' }, 400)
  if (!callback || !CALLBACK_RE.test(callback)) return c.json({ error: 'invalid callback' }, 400)

  const now = Date.now()
  const token = magicToken()
  await q.createMagicToken(c.env.DB, {
    token,
    email,
    callback,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + MAGIC_TTL_MS).toISOString(),
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

route.get('/auth/verify', async (c) => {
  const token = c.req.query('token')
  if (!token) return c.text('Missing token', 400)

  const row = await q.findMagicToken(c.env.DB, token)
  if (!row) return c.text('Invalid token', 410)
  if (row.used_at) return c.text('Token already used', 410)
  if (new Date(row.expires_at) < new Date()) return c.text('Token expired', 410)

  await q.consumeMagicToken(c.env.DB, token, new Date().toISOString())

  let user = await q.findUserByEmail(c.env.DB, row.email)
  if (!user) {
    const id = userId()
    await q.createUser(c.env.DB, {
      id,
      email: row.email,
      created_at: new Date().toISOString(),
      default_org_domain: null,
      default_owner_name: null,
    })
    user = (await q.findUserById(c.env.DB, id))!
  }

  const sToken = sessionToken()
  await q.createSession(c.env.DB, {
    token: sToken,
    user_id: user.id,
    created_at: new Date().toISOString(),
    name: 'Obsidian',
  })

  const callback = new URL(row.callback)
  callback.searchParams.set('api_token', sToken)
  callback.searchParams.set('email', user.email)
  return c.redirect(callback.toString(), 302)
})

route.get('/auth/me', sessionMiddleware, async (c) => {
  const userIdVar = c.get('userId')
  const user = await q.findUserById(c.env.DB, userIdVar)
  if (!user) return c.json({ error: 'user not found' }, 404)
  return c.json({ user })
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
  return c.json({ user })
})

route.post('/auth/logout', sessionMiddleware, async (c) => {
  const session = c.get('session')
  await q.deleteSession(c.env.DB, session.token)
  return c.body(null, 204)
})

export default route
