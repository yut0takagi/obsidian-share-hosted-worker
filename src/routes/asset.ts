// src/routes/asset.ts
import { Hono } from 'hono'
import { sessionMiddleware } from '../auth/sessionMiddleware'
import { putAsset, getAsset } from '../r2'

type Bindings = { R2: R2Bucket; DB: D1Database }
type Vars = { session: any; userId: string }

const route = new Hono<{ Bindings: Bindings; Variables: Vars }>()

route.post('/api/asset', sessionMiddleware, async (c) => {
  const hash = c.req.query('hash')
  const ext = c.req.query('ext')
  if (!hash || !ext) return c.text('Bad Request: hash and ext required', 400)
  if (!/^[a-f0-9]{16,64}$/.test(hash)) return c.text('Bad Request: invalid hash', 400)
  if (!/^(png|jpg|jpeg|gif|webp|svg)$/.test(ext)) return c.text('Bad Request: invalid ext', 400)

  const contentType = c.req.header('Content-Type') || 'application/octet-stream'
  const body = await c.req.arrayBuffer()
  await putAsset(c.env.R2, hash, ext, body, contentType)
  return c.json({ hash, ext, url: `/a/${hash}.${ext}` })
})

route.get('/a/:filename', async (c) => {
  const filename = c.req.param('filename')
  const match = filename.match(/^([a-f0-9]+)\.(\w+)$/)
  if (!match) return c.text('Bad Request', 400)
  const [, hash, ext] = match
  const asset = await getAsset(c.env.R2, hash, ext)
  if (!asset) return c.text('Not Found', 404)
  return new Response(asset.body, {
    headers: { 'Content-Type': asset.contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
  })
})

export default route
