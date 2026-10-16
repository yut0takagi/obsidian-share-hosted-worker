// src/auth/orgDomain.ts
// Org-wide sharing means "anyone whose email is at my domain". That only makes sense for
// domains an organization controls, so it is tied to the owner's sign-in domain and
// refused for consumer mail providers, where the "org" would be everyone.

import BUILT_IN from './freeMailDomains.json'

/** Consumer mail providers. Operators can add more with EXTRA_FREE_MAIL_DOMAINS. */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set(BUILT_IN as string[])

/** Parses EXTRA_FREE_MAIL_DOMAINS: domains separated by commas or whitespace. */
export function parseExtraFreeMailDomains(value: string | undefined): ReadonlySet<string> {
  return new Set((value ?? '').split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean))
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at === -1 ? '' : email.slice(at + 1).trim().toLowerCase()
}

export function isFreeMailDomain(domain: string, extra: ReadonlySet<string> = new Set()): boolean {
  const d = domain.trim().toLowerCase()
  return FREE_MAIL_DOMAINS.has(d) || extra.has(d)
}

export function orgDomainFor(email: string, extra?: ReadonlySet<string>): { domain: string; available: boolean } {
  const domain = emailDomain(email)
  return { domain, available: domain !== '' && !isFreeMailDomain(domain, extra) }
}

/**
 * The domain an org-mode note may be read by. Notes stored before 0.2.0 carry whatever
 * domain the client sent, so anything other than the owner's own (non free-mail) domain
 * is treated as "nobody".
 */
export function effectiveOrgDomain(storedDomain: string, ownerEmail: string | null, extra?: ReadonlySet<string>): string | null {
  if (!ownerEmail) return null
  const owner = orgDomainFor(ownerEmail, extra)
  if (!owner.available) return null
  return (storedDomain || '').trim().toLowerCase() === owner.domain ? owner.domain : null
}
