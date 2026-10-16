// src/auth/orgDomain.ts
// Org-wide sharing means "anyone whose email is at my domain". That only makes sense for
// domains an organization controls, so it is tied to the owner's sign-in domain and
// refused for consumer mail providers, where the "org" would be everyone.

export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Global
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.jp', 'hotmail.com', 'hotmail.co.jp', 'hotmail.co.uk',
  'hotmail.fr', 'live.com', 'live.jp', 'msn.com', 'yahoo.com', 'yahoo.co.jp', 'yahoo.co.uk', 'yahoo.fr', 'ymail.com',
  'rocketmail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me',
  'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'mail.ru',
  'fastmail.com', 'hey.com', 'tutanota.com', 'tuta.io', 'qq.com', '163.com', '126.com', 'naver.com',
  // Japan: carriers and ISPs whose addresses are handed to consumers
  'docomo.ne.jp', 'ezweb.ne.jp', 'au.com', 'softbank.ne.jp', 'i.softbank.jp', 'ymobile.ne.jp',
  'nifty.com', 'biglobe.ne.jp', 'ocn.ne.jp', 'so-net.ne.jp',
])

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at === -1 ? '' : email.slice(at + 1).trim().toLowerCase()
}

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain.trim().toLowerCase())
}

export function orgDomainFor(email: string): { domain: string; available: boolean } {
  const domain = emailDomain(email)
  return { domain, available: domain !== '' && !isFreeMailDomain(domain) }
}

/**
 * The domain an org-mode note may be read by. Notes stored before 0.2.0 carry whatever
 * domain the client sent, so anything other than the owner's own (non free-mail) domain
 * is treated as "nobody".
 */
export function effectiveOrgDomain(storedDomain: string, ownerEmail: string | null): string | null {
  if (!ownerEmail) return null
  const owner = orgDomainFor(ownerEmail)
  if (!owner.available) return null
  return (storedDomain || '').trim().toLowerCase() === owner.domain ? owner.domain : null
}
