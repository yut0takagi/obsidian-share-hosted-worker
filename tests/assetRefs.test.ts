import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import assetRoute from '../src/routes/asset'
import shareRoute from '../src/routes/share'
import { extractAssetKeys, sweepExpiredNotes, ASSET_GRACE_MS } from '../src/assetRefs'
import { makeEnv, makeCtx, signIn, bearer, sha256Hex, bytes, type TestEnv } from './helpers/env'

describe('extractAssetKeys', () => {
  it('finds each /a/ image key once', () => {
    const html = '<img src="/a/abcdef0123456789abcdef0123456789.png"><p>x</p><img alt="y" src="/a/abcdef0123456789abcdef0123456789.png"><img src="/a/0123456789abcdef0123456789abcdef.webp">'
    expect(extractAssetKeys(html).sort()).toEqual(['0123456789abcdef0123456789abcdef.webp', 'abcdef0123456789abcdef0123456789.png'])
  })

  it('ignores other paths', () => {
    expect(extractAssetKeys('<img src="https://example.com/a/abc.png"><a href="/n/xyz">')).toEqual([])
  })
})

function app() {
  const a = new Hono()
  a.route('/', assetRoute)
  a.route('/', shareRoute)
  return a
}

let env: TestEnv
let alice: { token: string; userId: string }
const IMG1 = bytes(0x89, 0x50, 0x4e, 0x47, 1, 1, 1)
const IMG2 = bytes(0x89, 0x50, 0x4e, 0x47, 2, 2, 2)

beforeEach(() => {
  env = makeEnv()
  alice = signIn(env, 'alice@example.com')
})

async function upload(img: ArrayBuffer): Promise<string> {
  const hash = (await sha256Hex(img)).slice(0, 32)
  const res = await app().request(`/api/asset?hash=${hash}&ext=png`, { method: 'POST', headers: bearer(alice.token), body: img }, env, makeCtx())
  expect(res.status).toBe(200)
  return `${hash}.png`
}

async function share(keys: string[], uuid: string | null = null, extra: Record<string, unknown> = {}): Promise<string> {
  const html = keys.map((k) => `<img src="/a/${k}">`).join('') || '<p>empty</p>'
  const res = await app().request('/api/share', {
    method: 'POST',
    headers: { ...bearer(alice.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ uuid, mode: 'public', title: 't', source_path: 't.md', html, ...extra }),
  }, env, makeCtx())
  expect(res.status).toBe(200)
  return ((await res.json()) as { uuid: string }).uuid
}

async function stop(uuid: string) {
  const res = await app().request(`/api/share/${uuid}`, { method: 'DELETE', headers: bearer(alice.token) }, env, makeCtx())
  expect(res.status).toBe(204)
}

function age(key: string) {
  const old = new Date(Date.now() - ASSET_GRACE_MS - 60_000).toISOString()
  env.db.sqlite.prepare('UPDATE assets SET claimed_at = ? WHERE key = ?').run(old, key)
}

const stored = (key: string) => env.r2.objects.has(`assets/${key}`)

describe('image clean-up when a share stops', () => {
  it('deletes images only that note used', async () => {
    const k = await upload(IMG1)
    const uuid = await share([k])
    age(k)
    await stop(uuid)
    expect(stored(k)).toBe(false)
    expect(env.db.rows('SELECT * FROM assets')).toHaveLength(0)
    expect(env.db.rows('SELECT * FROM note_assets')).toHaveLength(0)
  })

  it('keeps images another note still uses', async () => {
    const k = await upload(IMG1)
    const a = await share([k])
    await share([k])
    age(k)
    await stop(a)
    expect(stored(k)).toBe(true)
  })

  it('keeps images uploaded within the last hour (an upload may be about to be shared)', async () => {
    const k = await upload(IMG1)
    const uuid = await share([k])
    await stop(uuid)
    expect(stored(k)).toBe(true)
  })

  it('keeps images that were in storage before references were tracked', async () => {
    const hash = (await sha256Hex(IMG1)).slice(0, 32)
    env.r2.seed(`assets/${hash}.png`, new Uint8Array(IMG1), 'image/png')
    const k = await upload(IMG1)
    const uuid = await share([k])
    age(k)
    await stop(uuid)
    expect(stored(k)).toBe(true)
    expect(env.db.rows('SELECT legacy FROM assets WHERE key = ?', k)).toEqual([{ legacy: 1 }])
  })

  it('releases images an update no longer uses', async () => {
    const k1 = await upload(IMG1)
    const k2 = await upload(IMG2)
    const uuid = await share([k1, k2])
    age(k1)
    await share([k2], uuid)
    expect(stored(k1)).toBe(false)
    expect(stored(k2)).toBe(true)
    expect(env.db.rows('SELECT asset_key FROM note_assets WHERE note_uuid = ?', uuid)).toEqual([{ asset_key: k2 }])
  })
})

describe('sweepExpiredNotes', () => {
  it('removes notes expired for more than 7 days, with their images', async () => {
    const k = await upload(IMG1)
    const longGone = await share([k], null, { expires_at: new Date(Date.now() - 8 * 86400000).toISOString() })
    const recent = await share([], null, { expires_at: new Date(Date.now() - 86400000).toISOString() })
    const live = await share([], null, { expires_at: new Date(Date.now() + 86400000).toISOString() })
    const forever = await share([])
    age(k)

    const removed = await sweepExpiredNotes(env as unknown as { DB: D1Database; R2: R2Bucket }, new Date())
    expect(removed).toBe(1)
    expect(env.r2.objects.has(`notes/${longGone}.json`)).toBe(false)
    expect(env.r2.objects.has(`notes/${longGone}.html`)).toBe(false)
    expect(stored(k)).toBe(false)
    for (const u of [recent, live, forever]) expect(env.r2.objects.has(`notes/${u}.json`)).toBe(true)
  })

  it('reads expiry from notes written before 0.2.0, which lack object metadata', async () => {
    env.r2.seed('notes/legacy1.json', JSON.stringify({ uuid: 'legacy1', owner_id: alice.userId, mode: 'public', audience: [], org_domain: '', expires_at: '2020-01-01T00:00:00Z', created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z', title: '', source_path: '', owner_email: '' }), 'application/json')
    env.r2.seed('notes/legacy1.html', '<p>old</p>', 'text/html')
    expect(await sweepExpiredNotes(env as unknown as { DB: D1Database; R2: R2Bucket }, new Date())).toBe(1)
    expect(env.r2.objects.has('notes/legacy1.html')).toBe(false)
  })
})

describe('ordering and races', () => {
  it('publishes nothing if the new image references cannot be recorded', async () => {
    const k = await upload(IMG1)
    const realPrepare = env.DB.prepare.bind(env.DB)
    ;(env.DB as any).prepare = (sql: string) => {
      if (sql.startsWith('INSERT OR IGNORE INTO note_assets')) throw new Error('D1 down')
      return realPrepare(sql)
    }
    const res = await app().request('/api/share', {
      method: 'POST',
      headers: { ...bearer(alice.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid: null, mode: 'public', title: 't', source_path: 't.md', html: `<img src="/a/${k}">` }),
    }, env, makeCtx())
    expect(res.status).toBe(500)
    expect([...env.r2.objects.keys()].filter((key) => key.startsWith('notes/'))).toEqual([])
  })

  it('keeps the images the old version used when writing the new version fails', async () => {
    const k1 = await upload(IMG1)
    const k2 = await upload(IMG2)
    const uuid = await share([k1])
    age(k1)
    env.r2.failPut = (key) => key === `notes/${uuid}.html`
    const res = await app().request('/api/share', {
      method: 'POST',
      headers: { ...bearer(alice.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid, mode: 'public', title: 't', source_path: 't.md', html: `<img src="/a/${k2}">` }),
    }, env, makeCtx())
    expect(res.status).toBe(500)
    expect(stored(k1)).toBe(true)
    expect(env.db.rows('SELECT asset_key FROM note_assets WHERE note_uuid = ? AND asset_key = ?', uuid, k1)).toHaveLength(1)
  })

  it('keeps an image that someone uploads again while it is being cleaned up', async () => {
    const k = await upload(IMG1)
    const uuid = await share([k])
    age(k)
    let raced = false
    env.r2.beforeDelete = async (key) => {
      if (key !== `assets/${k}` || raced) return
      raced = true
      await upload(IMG1)
    }
    await stop(uuid)
    expect(raced).toBe(true)
    expect(stored(k)).toBe(true)
    expect(env.db.rows('SELECT key FROM assets WHERE key = ?', k)).toHaveLength(1)
  })

  it('does not delete images while ASSET_CLEANUP is "off"', async () => {
    env.ASSET_CLEANUP = 'off'
    const k = await upload(IMG1)
    const uuid = await share([k])
    age(k)
    await stop(uuid)
    expect(stored(k)).toBe(true)
    expect(env.r2.objects.has(`notes/${uuid}.json`)).toBe(false)
  })
})
