import { describe, it, expect } from 'vitest'
import { emailDomain, isFreeMailDomain, orgDomainFor, effectiveOrgDomain } from '../src/auth/orgDomain'

describe('emailDomain', () => {
  it('returns the lower-cased part after @', () => {
    expect(emailDomain('Alice@Example.COM')).toBe('example.com')
  })
  it('returns an empty string for malformed input', () => {
    expect(emailDomain('no-at-sign')).toBe('')
  })
})

describe('isFreeMailDomain', () => {
  it.each(['gmail.com', 'GMAIL.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.co.jp', 'icloud.com', 'proton.me', 'docomo.ne.jp'])('treats %s as free mail', (d) => {
    expect(isFreeMailDomain(d)).toBe(true)
  })
  it.each(['example.com', 'mail.example.com', 'gmail.com.example.net'])('treats %s as an organization', (d) => {
    expect(isFreeMailDomain(d)).toBe(false)
  })
})

describe('orgDomainFor', () => {
  it('uses the sign-in domain for organizations', () => {
    expect(orgDomainFor('alice@example.com')).toEqual({ domain: 'example.com', available: true })
  })
  it('marks free mail as unavailable', () => {
    expect(orgDomainFor('alice@gmail.com')).toEqual({ domain: 'gmail.com', available: false })
  })
})

describe('effectiveOrgDomain (read time, for notes stored before 0.2.0)', () => {
  it('allows the stored domain when it is the owner domain', () => {
    expect(effectiveOrgDomain('example.com', 'alice@example.com')).toBe('example.com')
  })
  it('fails closed when the stored domain differs from the owner domain', () => {
    expect(effectiveOrgDomain('other.com', 'alice@example.com')).toBeNull()
  })
  it('fails closed for free-mail owners', () => {
    expect(effectiveOrgDomain('gmail.com', 'alice@gmail.com')).toBeNull()
  })
  it('fails closed without an owner', () => {
    expect(effectiveOrgDomain('example.com', null)).toBeNull()
  })
})
