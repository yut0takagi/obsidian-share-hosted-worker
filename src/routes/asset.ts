// src/routes/asset.ts
import { Hono } from 'hono'
import { sessionMiddleware } from '../auth/sessionMiddleware'
import { putAsset, getAsset, headAsset } from '../r2'
import { checkAssetUpload, parseAssetFilename, ASSET_CSP, MAX_ASSET_BYTES } from '../assets'
import { declaredTooLarge } from '../util/bodySize'
import { claimAsset, markLegacyAsset } from '../assetRefs'

type Bindings = { R2: R2Bucket; DB: D1Database }
type Vars = { session: any; userId: string }

const route = new Hono<{ Bindings: Bindings; Variables: Vars }>()

route.post('/api/asset', sessionMiddleware, async (c) => {
  if (declaredTooLarge(c.req.header('Content-Length'), MAX_ASSET_BYTES)) return c.text('Payload Too Large: asset too large', 413)
  const body = await c.req.arrayBuffer()
  const check = await checkAssetUpload(c.req.query('hash'), c.req.query('ext'), body)
  if (!check.ok) return c.text(`Bad Request: ${check.error}`, check.status)

  // Claim before looking at R2, so a clean-up running now cannot remove what we rely on.
  const created = await claimAsset(c.env.DB, check.key, new Date())
  // Same key + verified bytes means same content, so an existing verified object is left alone.
  const existing = await headAsset(c.env.R2, check.key)
  if (!existing || existing.sha256 !== check.sha256) {
    await putAsset(c.env.R2, check.key, body, check.contentType, check.sha256)
  }
  // Objects already in R2 without a row predate reference tracking and are kept forever.
  if (created && existing) await markLegacyAsset(c.env.DB, check.key)

  const [hash, ext] = check.key.split('.')
  return c.json({ hash, ext, url: `/a/${check.key}` })
})

route.get('/a/:filename', async (c) => {
  const parsed = parseAssetFilename(c.req.param('filename'))
  if (!parsed) return c.text('Not Found', 404)
  const body = await getAsset(c.env.R2, parsed.key)
  if (!body) return c.text('Not Found', 404)
  return new Response(body, {
    headers: {
      // The type comes from the extension, never from what was stored with the upload.
      'Content-Type': parsed.contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': ASSET_CSP,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
})

export default route
