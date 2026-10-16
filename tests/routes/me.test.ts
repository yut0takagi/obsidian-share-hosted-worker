import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import authRoute from '../../src/routes/auth'
import { makeEnv, makeCtx, signIn, bearer } from '../helpers/env'

function app() {
  const a = new Hono()
  a.route('/', authRoute)
  return a
}

describe('GET /auth/me', () => {
  it('reports the org domain derived from the sign-in email', async () => {
    const env = makeEnv()
    const { token } = signIn(env, 'alice@example.com')
    const res = await app().request('/auth/me', { headers: bearer(token) }, env, makeCtx())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ user: { email: 'alice@example.com' }, org: { domain: 'example.com', available: true } })
  })

  it('reports org sharing as unavailable for free mail', async () => {
    const env = makeEnv()
    const { token } = signIn(env, 'gina@gmail.com')
    const res = await app().request('/auth/me', { headers: bearer(token) }, env, makeCtx())
    expect(await res.json()).toMatchObject({ org: { domain: 'gmail.com', available: false } })
  })
})
