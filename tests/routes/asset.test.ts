import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import assetRoute from '../../src/routes/asset'
import { makeEnv, makeCtx, signIn, bearer, sha256Hex, bytes, utf8, type TestEnv } from '../helpers/env'

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4)
const OTHER = bytes(0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9)

function app() {
  const a = new Hono()
  a.route('/', assetRoute)
  return a
}

let env: TestEnv
let token: string

beforeEach(() => {
  env = makeEnv()
  token = signIn(env).token
})

async function upload(hash: string, ext: string, body: ArrayBuffer, contentType = 'image/png') {
  return app().request(`/api/asset?hash=${hash}&ext=${ext}`, {
    method: 'POST',
    headers: { ...bearer(token), 'Content-Type': contentType },
    body,
  }, env, makeCtx())
}

describe('POST /api/asset', () => {
  it('requires a session', async () => {
    const hash = (await sha256Hex(PNG)).slice(0, 32)
    const res = await app().request(`/api/asset?hash=${hash}&ext=png`, { method: 'POST', body: PNG }, env, makeCtx())
    expect(res.status).toBe(401)
  })

  it('stores the image when the hash matches (32-hex prefix, as the plugin sends)', async () => {
    const hash = (await sha256Hex(PNG)).slice(0, 32)
    const res = await upload(hash, 'png', PNG)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hash, ext: 'png', url: `/a/${hash}.png` })
    expect(env.r2.objects.has(`assets/${hash}.png`)).toBe(true)
  })

  it('accepts the full 64-hex SHA-256', async () => {
    const hash = await sha256Hex(PNG)
    expect((await upload(hash, 'png', PNG)).status).toBe(200)
  })

  it('rejects a body whose SHA-256 does not match the hash', async () => {
    const hash = (await sha256Hex(PNG)).slice(0, 32)
    const res = await upload(hash, 'png', OTHER)
    expect(res.status).toBe(400)
    expect(env.r2.objects.size).toBe(0)
  })

  it('rejects hashes shorter than 128 bits', async () => {
    const hash = (await sha256Hex(PNG)).slice(0, 16)
    expect((await upload(hash, 'png', PNG)).status).toBe(400)
  })

  it('accepts SVG uploads, stored as image/svg+xml whatever the request says', async () => {
    const svg = utf8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const hash = (await sha256Hex(svg)).slice(0, 32)
    const res = await upload(hash, 'svg', svg, 'text/html')
    expect(res.status).toBe(200)
    expect(env.r2.objects.get(`assets/${hash}.svg`)?.httpMetadata.contentType).toBe('image/svg+xml')
  })

  it('serves uploaded SVGs sandboxed, so their scripts cannot run on this origin', async () => {
    const svg = utf8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const hash = (await sha256Hex(svg)).slice(0, 32)
    await upload(hash, 'svg', svg)
    const res = await app().request(`/a/${hash}.svg`, {}, env, makeCtx())
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Security-Policy')).toMatch(/default-src 'none'.*sandbox/)
    expect(res.headers.get('Content-Security-Policy')).not.toContain('allow-scripts')
  })

  it('rejects an empty body', async () => {
    const hash = (await sha256Hex(bytes())).slice(0, 32)
    expect((await upload(hash, 'png', bytes())).status).toBe(400)
  })

  it('derives Content-Type from ext and ignores the request header', async () => {
    const hash = (await sha256Hex(PNG)).slice(0, 32)
    await upload(hash, 'jpg', PNG, 'text/html')
    expect(env.r2.objects.get(`assets/${hash}.jpg`)?.httpMetadata.contentType).toBe('image/jpeg')
  })

  it('does not overwrite an object that was already stored and verified', async () => {
    const hash = (await sha256Hex(PNG)).slice(0, 32)
    await upload(hash, 'png', PNG)
    const before = env.r2.putCount
    const res = await upload(hash, 'png', PNG)
    expect(res.status).toBe(200)
    expect(env.r2.putCount).toBe(before)
  })

  it('replaces an unverified object written before 0.2.0 with the verified bytes', async () => {
    const hash = (await sha256Hex(PNG)).slice(0, 32)
    env.r2.seed(`assets/${hash}.png`, '<html>not an image</html>', 'text/html')
    expect((await upload(hash, 'png', PNG)).status).toBe(200)
    const stored = env.r2.objects.get(`assets/${hash}.png`)!
    expect(Array.from(stored.body)).toEqual(Array.from(new Uint8Array(PNG)))
    expect(stored.httpMetadata.contentType).toBe('image/png')
  })
})

describe('GET /a/:filename', () => {
  it('serves with a Content-Type from the extension, nosniff and a sandbox CSP', async () => {
    env.r2.seed('assets/abcdef0123456789abcdef0123456789.png', 'x', 'text/html')
    const res = await app().request('/a/abcdef0123456789abcdef0123456789.png', {}, env, makeCtx())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox')
  })

  it('keeps serving SVGs stored before 0.2.0, but sandboxed', async () => {
    env.r2.seed('assets/abcdef0123456789abcdef0123456789.svg', '<svg/>', 'image/svg+xml')
    const res = await app().request('/a/abcdef0123456789abcdef0123456789.svg', {}, env, makeCtx())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml')
    expect(res.headers.get('Content-Security-Policy')).toMatch(/default-src 'none'.*sandbox/)
  })

  it('returns 404 for extensions it does not serve', async () => {
    env.r2.seed('assets/abcdef0123456789abcdef0123456789.html', '<script></script>', 'text/html')
    const res = await app().request('/a/abcdef0123456789abcdef0123456789.html', {}, env, makeCtx())
    expect(res.status).toBe(404)
  })
})
