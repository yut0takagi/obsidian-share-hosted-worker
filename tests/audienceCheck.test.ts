import { describe, it, expect } from 'vitest'
import { isAllowed } from '../src/auth/audienceCheck'

describe('isAllowed (multi-tenant: org_domain on note)', () => {
  it('org mode: passes when email matches note org_domain', () => {
    expect(isAllowed({ mode: 'org', audience: [], org_domain: 'example.com' }, 'alice@example.com')).toBe(true)
  })

  it('org mode: rejects when email differs', () => {
    expect(isAllowed({ mode: 'org', audience: [], org_domain: 'example.com' }, 'alice@other.com')).toBe(false)
  })

  it('org mode: rejects when org_domain empty', () => {
    expect(isAllowed({ mode: 'org', audience: [], org_domain: '' }, 'a@e.com')).toBe(false)
  })

  it('list mode: matches case-insensitively', () => {
    expect(isAllowed({ mode: 'list', audience: ['BOB@y.com'], org_domain: '' }, 'bob@y.com')).toBe(true)
  })

  it('list mode: rejects unknown emails', () => {
    expect(isAllowed({ mode: 'list', audience: ['alice@x.com'], org_domain: '' }, 'eve@x.com')).toBe(false)
  })

  it('public mode: always passes', () => {
    expect(isAllowed({ mode: 'public', audience: [], org_domain: '' }, '')).toBe(true)
  })
})
