// src/routes/note.ts
import { Hono } from 'hono'
import { getMeta, getHtml } from '../r2'
import { verifyAccessJwt } from '../auth/cfAccessJwt'
import { isAllowed } from '../auth/audienceCheck'
import { sharePageResponse } from '../render/sharePage'
import { effectiveOrgDomain } from '../auth/orgDomain'
import * as q from '../db/queries'

type Bindings = {
  R2: R2Bucket
  DB: D1Database
  CF_ACCESS_TEAM_DOMAIN: string
  CF_ACCESS_AUD: string
}

const route = new Hono<{ Bindings: Bindings }>()

route.get('/n/:uuid', async (c) => {
  const uuid = c.req.param('uuid')
  const meta = await getMeta(c.env.R2, uuid)
  if (!meta) return c.text('Not Found', 404)
  if (meta.mode === 'public') return c.text('Use /p/:uuid for public notes', 400)
  if (meta.expires_at && new Date(meta.expires_at) < new Date()) return c.text('Link Expired', 410)

  const jwt = c.req.header('Cf-Access-Jwt-Assertion')
  if (!jwt) return c.text('Unauthorized: no Access JWT', 401)

  const teamDomain = (c.env.CF_ACCESS_TEAM_DOMAIN || '').trim()
  const aud = (c.env.CF_ACCESS_AUD || '').trim()
  const claims = await verifyAccessJwt(jwt, teamDomain, aud)
  if (!claims) return c.text('Unauthorized: invalid JWT', 401)

  let orgDomain = ''
  if (meta.mode === 'org') {
    const owner = await q.findUserById(c.env.DB, meta.owner_id)
    orgDomain = effectiveOrgDomain(meta.org_domain, owner?.email ?? null) ?? ''
  }

  if (!isAllowed({ mode: meta.mode, audience: meta.audience, org_domain: orgDomain }, claims.email)) {
    return c.text(`Forbidden: ${claims.email} not authorized for this note`, 403)
  }

  const html = await getHtml(c.env.R2, uuid)
  if (!html) return c.text('Not Found', 404)
  return sharePageResponse(html)
})

export default route
