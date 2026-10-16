import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import shareRoute from '../../src/routes/share'
import { makeEnv, makeCtx, signIn, bearer, type TestEnv } from '../helpers/env'

function app() {
  const a = new Hono()
  a.route('/', shareRoute)
  return a
}

let env: TestEnv
let alice: { token: string; userId: string }
let mallory: { token: string; userId: string }

beforeEach(() => {
  env = makeEnv()
  alice = signIn(env, 'alice@example.com')
  mallory = signIn(env, 'mallory@example.net')
})

function body(over: Record<string, unknown> = {}) {
  return {
    uuid: null, mode: 'list', audience: ['bob@example.com'], expires_at: null,
    title: 'Plan', source_path: 'Plan.md', html: '<p>v1</p>', owner_email: 'alice@example.com', ...over,
  }
}

async function share(token: string, b: Record<string, unknown>) {
  return app().request('/api/share', {
    method: 'POST',
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  }, env, makeCtx())
}

async function stop(token: string, uuid: string) {
  return app().request(`/api/share/${uuid}`, { method: 'DELETE', headers: bearer(token) }, env, makeCtx())
}

function meta(uuid: string) {
  const t = env.r2.text(`notes/${uuid}.json`)
  return t ? JSON.parse(t) : null
}

describe('POST /api/share: who picks the uuid', () => {
  it('issues a new uuid on the server for a new share', async () => {
    const res = await share(alice.token, body())
    expect(res.status).toBe(200)
    const { uuid, url } = await res.json() as { uuid: string; url: string }
    expect(uuid).toMatch(/^[A-Za-z0-9_-]{12}$/)
    expect(url).toBe(`http://localhost/n/${uuid}`)
    expect(meta(uuid).owner_id).toBe(alice.userId)
  })

  it('returns 404 for a uuid that does not exist, and stores nothing', async () => {
    const res = await share(alice.token, body({ uuid: 'chosenByClnt' }))
    expect(res.status).toBe(404)
    expect(env.r2.objects.size).toBe(0)
  })

  it('lets the owner update an existing share in place', async () => {
    const { uuid } = await (await share(alice.token, body())).json() as { uuid: string }
    const created = meta(uuid).created_at
    const res = await share(alice.token, body({ uuid, html: '<p>v2</p>' }))
    expect(res.status).toBe(200)
    expect((await res.json() as { uuid: string }).uuid).toBe(uuid)
    expect(env.r2.text(`notes/${uuid}.html`)).toContain('v2')
    expect(meta(uuid).created_at).toBe(created)
  })

  it('refuses updates from anyone but the owner', async () => {
    const { uuid } = await (await share(alice.token, body())).json() as { uuid: string }
    const res = await share(mallory.token, body({ uuid, html: '<p>defaced</p>' }))
    expect(res.status).toBe(403)
    expect(env.r2.text(`notes/${uuid}.html`)).toContain('v1')
  })

  it('does not let anyone take over a stopped share URL', async () => {
    const { uuid } = await (await share(alice.token, body())).json() as { uuid: string }
    expect((await stop(alice.token, uuid)).status).toBe(204)
    expect((await share(mallory.token, body({ uuid }))).status).toBe(404)
    expect((await share(alice.token, body({ uuid }))).status).toBe(404)
  })

  it('records the signed-in email as owner_email, not the one the client sent', async () => {
    const { uuid } = await (await share(alice.token, body({ owner_email: 'ceo@example.org' }))).json() as { uuid: string }
    expect(meta(uuid).owner_email).toBe('alice@example.com')
  })

  it('uses /p/ for public shares', async () => {
    const res = await share(alice.token, body({ mode: 'public', audience: [] }))
    expect((await res.json() as { url: string }).url).toMatch(/\/p\/[A-Za-z0-9_-]{12}$/)
  })
})

describe('POST /api/share: input checks', () => {
  it('rejects an unknown mode', async () => {
    expect((await share(alice.token, body({ mode: 'everyone' }))).status).toBe(400)
  })

  it('rejects list mode without recipients', async () => {
    expect((await share(alice.token, body({ audience: [] }))).status).toBe(400)
  })

  it('rejects recipients that are not email addresses', async () => {
    expect((await share(alice.token, body({ audience: ['bob@example.com', 'not an email'] }))).status).toBe(400)
  })

  it('normalizes recipients to lower case without duplicates', async () => {
    const { uuid } = await (await share(alice.token, body({ audience: [' Bob@Example.com', 'bob@example.com'] }))).json() as { uuid: string }
    expect(meta(uuid).audience).toEqual(['bob@example.com'])
  })

  it('rejects an expiry that is not a date', async () => {
    expect((await share(alice.token, body({ expires_at: 'next week' }))).status).toBe(400)
  })

  it('rejects a missing html body', async () => {
    expect((await share(alice.token, body({ html: undefined }))).status).toBe(400)
  })

  it('rejects malformed uuids', async () => {
    expect((await share(alice.token, body({ uuid: '../../etc' }))).status).toBe(400)
  })

  it('requires a session', async () => {
    const res = await app().request('/api/share', { method: 'POST', body: JSON.stringify(body()) }, env, makeCtx())
    expect(res.status).toBe(401)
  })
})

describe('POST /api/share: org mode follows the sign-in domain', () => {
  it('uses the domain of the signed-in email when the client sends none', async () => {
    const { uuid } = await (await share(alice.token, body({ mode: 'org', audience: [], org_domain: '' }))).json() as { uuid: string }
    expect(meta(uuid).org_domain).toBe('example.com')
  })

  it('accepts a client value that matches the sign-in domain', async () => {
    const res = await share(alice.token, body({ mode: 'org', audience: [], org_domain: 'Example.com' }))
    expect(res.status).toBe(200)
  })

  it('refuses a client value for some other domain', async () => {
    const res = await share(alice.token, body({ mode: 'org', audience: [], org_domain: 'gmail.com' }))
    expect(res.status).toBe(400)
    expect(env.r2.objects.size).toBe(0)
  })

  it('refuses org mode for free-mail accounts', async () => {
    const freemailUser = signIn(env, 'freemail-test-user@gmail.com')
    const res = await share(freemailUser.token, body({ mode: 'org', audience: [] }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'org_mode_unavailable' })
  })

  it('still lets free-mail accounts share with specific people', async () => {
    const freemailUser = signIn(env, 'freemail-test-user@gmail.com')
    expect((await share(freemailUser.token, body({ mode: 'list' }))).status).toBe(200)
  })
})

describe('GET /api/share/:uuid', () => {
  async function get(token: string, uuid: string) {
    return app().request(`/api/share/${uuid}`, { headers: bearer(token) }, env, makeCtx())
  }

  it('returns recipients, expiry and mode to the owner', async () => {
    const expires = '2030-01-01T00:00:00.000Z'
    const { uuid, url } = await (await share(alice.token, body({ audience: ['bob@example.com', 'carol@example.com'], expires_at: expires }))).json() as { uuid: string; url: string }
    const res = await get(alice.token, uuid)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toMatchObject({
      uuid, url, mode: 'list', audience: ['bob@example.com', 'carol@example.com'], expires_at: expires, org_domain: '',
    })
  })

  it('hides the share from other users', async () => {
    const { uuid } = await (await share(alice.token, body())).json() as { uuid: string }
    const res = await get(mallory.token, uuid)
    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).not.toContain('bob@example.com')
  })

  it('returns 404 for unknown shares', async () => {
    expect((await get(alice.token, 'nothingHere1')).status).toBe(404)
  })

  it('requires a session', async () => {
    expect((await app().request('/api/share/abcdefghijkl', {}, env, makeCtx())).status).toBe(401)
  })
})
