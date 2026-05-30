// src/auth/sessionMiddleware.ts
import type { MiddlewareHandler } from 'hono'
import type { Session } from '../types'
import * as q from '../db/queries'

type Env = { Bindings: { DB: D1Database }; Variables: { session: Session; userId: string } }

export const sessionMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return c.json({ error: 'unauthorized' }, 401)
  const token = auth.slice('Bearer '.length).trim()
  if (!token.startsWith('s_')) return c.json({ error: 'invalid session token' }, 401)

  const session = await q.findSessionByToken(c.env.DB, token)
  if (!session) return c.json({ error: 'invalid session' }, 401)

  c.set('session', session)
  c.set('userId', session.user_id)
  c.executionCtx.waitUntil(q.touchSession(c.env.DB, token, new Date().toISOString()))

  await next()
}
