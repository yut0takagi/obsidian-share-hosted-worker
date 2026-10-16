// src/routes/share.ts
import { Hono } from 'hono'
import { putMeta, putHtml, getMeta } from '../r2'
import { recordNoteAssets, removeNote } from '../assetRefs'
import { sessionMiddleware } from '../auth/sessionMiddleware'
import { noteUuid } from '../db/nanoid'
import * as q from '../db/queries'
import { parseShareRequest, MAX_SHARE_REQUEST_BYTES } from '../share/request'
import { declaredTooLarge } from '../util/bodySize'
import { orgDomainFor } from '../auth/orgDomain'
import type { NoteMeta, ShareResponse } from '../types'

type Bindings = { R2: R2Bucket; DB: D1Database }
type Vars = { session: any; userId: string }

const route = new Hono<{ Bindings: Bindings; Variables: Vars }>()

async function freshUuid(r2: R2Bucket): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const uuid = noteUuid()
    if (!(await getMeta(r2, uuid))) return uuid
  }
  throw new Error('could not allocate a note id')
}

route.post('/api/share', sessionMiddleware, async (c) => {
  if (declaredTooLarge(c.req.header('Content-Length'), MAX_SHARE_REQUEST_BYTES)) return c.json({ error: 'request too large' }, 413)
  let raw: unknown
  try { raw = await c.req.json() } catch { return c.json({ error: 'invalid json' }, 400) }
  const parsed = parseShareRequest(raw)
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status ?? 400)
  const req = parsed.value

  const now = new Date().toISOString()
  const userIdVar = c.get('userId')
  const user = await q.findUserById(c.env.DB, userIdVar)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  // Org mode always means the owner's own sign-in domain. A client value is only accepted
  // when it says the same thing (0.1.0 sent whatever was typed into settings).
  let orgDomain = ''
  if (req.mode === 'org') {
    const org = orgDomainFor(user.email)
    if (!org.available) {
      return c.json({ error: 'org_mode_unavailable', message: `Org-wide sharing is not available for @${org.domain} addresses. Share with specific people instead.` }, 400)
    }
    if (req.org_domain && req.org_domain.trim().toLowerCase() !== org.domain) {
      return c.json({ error: 'org_domain_mismatch', message: `Org-wide sharing goes to @${org.domain}, the domain you signed in with.` }, 400)
    }
    orgDomain = org.domain
  }

  // The server issues ids. A client-supplied uuid can only point at a share the caller already owns,
  // so stopped or never-issued URLs cannot be claimed.
  let uuid: string
  let created_at = now
  if (req.uuid) {
    const existing = await getMeta(c.env.R2, req.uuid)
    if (!existing) return c.json({ error: 'share not found' }, 404)
    if (existing.owner_id !== userIdVar) return c.json({ error: 'forbidden' }, 403)
    uuid = req.uuid
    created_at = existing.created_at
  } else {
    uuid = await freshUuid(c.env.R2)
  }

  const meta: NoteMeta = {
    uuid,
    owner_id: userIdVar,
    mode: req.mode,
    audience: req.audience,
    org_domain: orgDomain,
    expires_at: req.expires_at,
    created_at,
    updated_at: now,
    title: req.title,
    source_path: req.source_path,
    owner_email: user.email,
  }

  await putMeta(c.env.R2, uuid, meta)
  await putHtml(c.env.R2, uuid, req.html)
  await recordNoteAssets(c.env, uuid, req.html, new Date())

  const host = new URL(c.req.url).origin
  const path = req.mode === 'public' ? `/p/${uuid}` : `/n/${uuid}`
  return c.json({ uuid, url: `${host}${path}` } satisfies ShareResponse)
})

// Lets the plugin pre-fill the share dialog when re-sharing. Recipients never go into the
// note's frontmatter, so this is where they come from.
route.get('/api/share/:uuid', sessionMiddleware, async (c) => {
  const uuid = c.req.param('uuid')
  const meta = await getMeta(c.env.R2, uuid)
  if (!meta) return c.json({ error: 'share not found' }, 404)
  if (meta.owner_id !== c.get('userId')) return c.json({ error: 'forbidden' }, 403)
  const host = new URL(c.req.url).origin
  const path = meta.mode === 'public' ? `/p/${uuid}` : `/n/${uuid}`
  c.header('Cache-Control', 'no-store')
  return c.json({
    uuid,
    url: `${host}${path}`,
    mode: meta.mode,
    audience: meta.audience,
    org_domain: meta.org_domain,
    expires_at: meta.expires_at,
    title: meta.title,
    created_at: meta.created_at,
    updated_at: meta.updated_at,
  })
})

route.delete('/api/share/:uuid', sessionMiddleware, async (c) => {
  const uuid = c.req.param('uuid')
  const userIdVar = c.get('userId')
  const existing = await getMeta(c.env.R2, uuid)
  if (!existing) return c.body(null, 204)
  if (existing.owner_id !== userIdVar) return c.text('Forbidden', 403)
  await removeNote(c.env, uuid, new Date())
  return c.body(null, 204)
})

export default route
