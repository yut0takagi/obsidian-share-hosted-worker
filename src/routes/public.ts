// src/routes/public.ts
import { Hono } from 'hono'
import { getMeta, getHtml } from '../r2'
import { sharePageResponse } from '../render/sharePage'

type Bindings = { R2: R2Bucket }

const route = new Hono<{ Bindings: Bindings }>()

route.get('/p/:uuid', async (c) => {
  const uuid = c.req.param('uuid')
  const meta = await getMeta(c.env.R2, uuid)
  if (!meta) return c.text('Not Found', 404)
  if (meta.mode !== 'public') return c.text('Forbidden: not public', 403)
  if (meta.expires_at && new Date(meta.expires_at) < new Date()) return c.text('Link Expired', 410)
  const html = await getHtml(c.env.R2, uuid)
  if (!html) return c.text('Not Found', 404)
  return sharePageResponse(html)
})

export default route
