// src/share/request.ts
import type { ShareMode } from '../types'
import { EMAIL_RE, normalizeEmail } from '../util/email'

export interface ParsedShareRequest {
  uuid: string | null
  mode: ShareMode
  audience: string[]
  org_domain: string | null
  expires_at: string | null
  title: string
  source_path: string
  html: string
}

export const MAX_HTML_BYTES = 5 * 1024 * 1024
// JSON escaping can grow the HTML, so the request as a whole may be somewhat larger.
export const MAX_SHARE_REQUEST_BYTES = 2 * MAX_HTML_BYTES + 64 * 1024
const MAX_AUDIENCE = 200
const UUID_RE = /^[A-Za-z0-9_-]{8,64}$/
const MODES: ShareMode[] = ['org', 'list', 'public']

type Result = { ok: true; value: ParsedShareRequest } | { ok: false; error: string; status?: 413 }

function str(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string' || v.length > max) return null
  return v
}

export function parseShareRequest(raw: unknown): Result {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid body' }
  const b = raw as Record<string, unknown>

  let uuid: string | null = null
  if (b.uuid !== undefined && b.uuid !== null && b.uuid !== '') {
    if (typeof b.uuid !== 'string' || !UUID_RE.test(b.uuid)) return { ok: false, error: 'invalid uuid' }
    uuid = b.uuid
  }

  if (!MODES.includes(b.mode as ShareMode)) return { ok: false, error: 'mode must be org, list or public' }
  const mode = b.mode as ShareMode

  let audience: string[] = []
  if (mode === 'list') {
    if (!Array.isArray(b.audience)) return { ok: false, error: 'audience required for list mode' }
    const set = new Set<string>()
    for (const a of b.audience) {
      if (typeof a !== 'string' || !EMAIL_RE.test(a.trim())) return { ok: false, error: 'audience must be email addresses' }
      set.add(normalizeEmail(a))
    }
    if (set.size === 0) return { ok: false, error: 'audience required for list mode' }
    if (set.size > MAX_AUDIENCE) return { ok: false, error: `at most ${MAX_AUDIENCE} recipients` }
    audience = [...set]
  }

  let expires_at: string | null = null
  if (b.expires_at !== undefined && b.expires_at !== null && b.expires_at !== '') {
    const t = typeof b.expires_at === 'string' ? Date.parse(b.expires_at) : NaN
    if (Number.isNaN(t)) return { ok: false, error: 'expires_at must be an ISO date or null' }
    expires_at = new Date(t).toISOString()
  }

  if (typeof b.html !== 'string' || b.html.length === 0) return { ok: false, error: 'html required' }
  if (new TextEncoder().encode(b.html).byteLength > MAX_HTML_BYTES) return { ok: false, error: 'html too large', status: 413 }

  const org_domain = b.org_domain === undefined || b.org_domain === null ? null : str(b.org_domain, 253)
  if (org_domain === null && b.org_domain != null) return { ok: false, error: 'invalid org_domain' }

  const title = str(b.title, 500)
  const source_path = str(b.source_path, 1024)
  if (title === null || source_path === null) return { ok: false, error: 'invalid title or source_path' }

  return { ok: true, value: { uuid, mode, audience, org_domain, expires_at, title, source_path, html: b.html } }
}
