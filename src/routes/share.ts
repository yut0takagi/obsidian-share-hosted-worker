// src/routes/share.ts
import { Hono } from 'hono'
import { putMeta, putHtml, getMeta, deleteNote } from '../r2'
import { sessionMiddleware } from '../auth/sessionMiddleware'
import { noteUuid } from '../db/nanoid'
import * as q from '../db/queries'
import type { NoteMeta, ShareRequest, ShareResponse } from '../types'

type Bindings = { R2: R2Bucket; DB: D1Database }
type Vars = { session: any; userId: string }

const route = new Hono<{ Bindings: Bindings; Variables: Vars }>()

route.post('/api/share', sessionMiddleware, async (c) => {
  const body = (await c.req.json()) as ShareRequest
  const now = new Date().toISOString()
  const userIdVar = c.get('userId')

  let uuid = body.uuid
  let created_at = now

  if (uuid) {
    const existing = await getMeta(c.env.R2, uuid)
    if (existing) {
      if (existing.owner_id !== userIdVar) return c.text('Forbidden', 403)
      created_at = existing.created_at
    }
  } else {
    uuid = noteUuid()
  }

  const user = await q.findUserById(c.env.DB, userIdVar)
  const orgDomain = body.org_domain ?? user?.default_org_domain ?? ''

  const meta: NoteMeta = {
    uuid,
    owner_id: userIdVar,
    mode: body.mode,
    audience: body.audience || [],
    org_domain: orgDomain,
    expires_at: body.expires_at || null,
    created_at,
    updated_at: now,
    title: body.title,
    source_path: body.source_path,
    owner_email: body.owner_email,
  }

  await putMeta(c.env.R2, uuid, meta)
  await putHtml(c.env.R2, uuid, body.html)

  const host = new URL(c.req.url).origin
  const path = body.mode === 'public' ? `/p/${uuid}` : `/n/${uuid}`
  return c.json({ uuid, url: `${host}${path}` } satisfies ShareResponse)
})

route.delete('/api/share/:uuid', sessionMiddleware, async (c) => {
  const uuid = c.req.param('uuid')
  const userIdVar = c.get('userId')
  const existing = await getMeta(c.env.R2, uuid)
  if (!existing) return c.body(null, 204)
  if (existing.owner_id !== userIdVar) return c.text('Forbidden', 403)
  await deleteNote(c.env.R2, uuid)
  return c.body(null, 204)
})

export default route
