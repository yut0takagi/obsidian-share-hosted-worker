// src/auth/audienceCheck.ts
import type { ShareMode } from '../types'

export function isAllowed(
  note: { mode: ShareMode; audience: string[]; org_domain: string },
  email: string,
): boolean {
  if (note.mode === 'public') return true
  const e = email.toLowerCase()
  if (note.mode === 'org') {
    const d = (note.org_domain || '').toLowerCase()
    if (!d) return false
    return e.endsWith(`@${d}`)
  }
  if (note.mode === 'list') {
    return note.audience.map((a) => a.toLowerCase()).includes(e)
  }
  return false
}
