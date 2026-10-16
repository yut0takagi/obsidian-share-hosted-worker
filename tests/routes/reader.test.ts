import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { makeEnv, makeCtx, signIn, type TestEnv } from '../helpers/env'

vi.mock('../../src/auth/cfAccessJwt', () => ({
  verifyAccessJwt: vi.fn(async (jwt: string) => (jwt.startsWith('as:') ? { email: jwt.slice(3) } : jwt === 'good' ? { email: 'bob@example.com' } : null)),
}))

const { default: noteRoute } = await import('../../src/routes/note')
const { default: publicRoute } = await import('../../src/routes/public')

function app() {
  const a = new Hono()
  a.route('/', noteRoute)
  a.route('/', publicRoute)
  return a
}

const PAGE = '<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body>secret body</body></html>'

let env: TestEnv
beforeEach(() => {
  env = makeEnv({ CF_ACCESS_TEAM_DOMAIN: 'team.example.com', CF_ACCESS_AUD: 'aud' })
})

function seedNote(uuid: string, meta: Record<string, unknown>) {
  env.r2.seed(`notes/${uuid}.json`, JSON.stringify({
    uuid, owner_id: 'u_owner', audience: [], org_domain: '', expires_at: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    title: 't', source_path: 't.md', owner_email: 'owner@example.com', ...meta,
  }), 'application/json')
  env.r2.seed(`notes/${uuid}.html`, PAGE, 'text/html')
}

describe('GET /p/:uuid', () => {
  it('serves public notes with the share page CSP and without the CDN script', async () => {
    seedNote('pub1', { mode: 'public' })
    const res = await app().request('/p/pub1', {}, env, makeCtx())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    const body = await res.text()
    expect(body).toContain('secret body')
    expect(body).not.toContain('cdn.tailwindcss.com')
  })
})

describe('GET /n/:uuid', () => {
  it('serves allowed readers with the share page CSP', async () => {
    seedNote('list1', { mode: 'list', audience: ['bob@example.com'] })
    const res = await app().request('/n/list1', { headers: { 'Cf-Access-Jwt-Assertion': 'good' } }, env, makeCtx())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('GET /n/:uuid in org mode', () => {
  async function read(uuid: string, viewer: string) {
    return app().request(`/n/${uuid}`, { headers: { 'Cf-Access-Jwt-Assertion': `as:${viewer}` } }, env, makeCtx())
  }

  it('lets people at the owner domain read', async () => {
    const { userId } = signIn(env, 'owner@example.com')
    seedNote('org1', { mode: 'org', org_domain: 'example.com', owner_id: userId })
    expect((await read('org1', 'carol@example.com')).status).toBe(200)
    expect((await read('org1', 'carol@example.net')).status).toBe(403)
  })

  it('refuses notes stored for a free-mail domain before 0.2.0', async () => {
    const { userId } = signIn(env, 'owner@gmail.com')
    seedNote('org2', { mode: 'org', org_domain: 'gmail.com', owner_id: userId })
    expect((await read('org2', 'anyone@gmail.com')).status).toBe(403)
  })

  it('refuses notes whose stored domain is not the owner domain', async () => {
    const { userId } = signIn(env, 'owner@example.com')
    seedNote('org3', { mode: 'org', org_domain: 'other.com', owner_id: userId })
    expect((await read('org3', 'dave@other.com')).status).toBe(403)
  })
})
