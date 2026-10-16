// src/routes/note.ts
import { Hono } from 'hono'
import { getMeta, getHtml } from '../r2'
import { verifyAccessJwt } from '../auth/cfAccessJwt'
import { isAllowed } from '../auth/audienceCheck'
import { sharePageResponse } from '../render/sharePage'
import { effectiveOrgDomain, parseExtraFreeMailDomains } from '../auth/orgDomain'
import * as q from '../db/queries'
import { renderMessagePage, VERIFY_PAGE_HEADERS } from '../auth/verifyPage'

type Bindings = {
  R2: R2Bucket
  DB: D1Database
  EXTRA_FREE_MAIL_DOMAINS?: string
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
    const effective = effectiveOrgDomain(meta.org_domain, owner?.email ?? null, parseExtraFreeMailDomains(c.env.EXTRA_FREE_MAIL_DOMAINS))
    if (!effective) {
      // Shared by 0.1.0 for a domain the 0.2.0 rules no longer allow; say so instead of a bare 403.
      return new Response(renderMessagePage(
        'This share is no longer available',
        'A security update turned off this org-wide share: org-wide shares now reach only the owner\'s own sign-in domain, and never public mail domains such as gmail.com. Ask the owner to share it again.',
      ), { status: 403, headers: VERIFY_PAGE_HEADERS })
    }
    orgDomain = effective
  }

  if (!isAllowed({ mode: meta.mode, audience: meta.audience, org_domain: orgDomain }, claims.email)) {
    return c.text(`Forbidden: ${claims.email} not authorized for this note`, 403)
  }

  const html = await getHtml(c.env.R2, uuid)
  if (!html) return c.text('Not Found', 404)
  return sharePageResponse(html)
})

export default route
