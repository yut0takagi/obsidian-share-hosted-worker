import { describe, it, expect } from 'vitest'
import { SHARE_PAGE_CSP, upgradeLegacyHtml, sharePageResponse } from '../src/render/sharePage'

const LEGACY = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>x</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>.prose-content { color: red; }</style>
</head>
<body class="bg-white dark:bg-neutral-900"><p>hi</p></body>
</html>`

describe('SHARE_PAGE_CSP', () => {
  it('sandboxes the page without allowing scripts', () => {
    expect(SHARE_PAGE_CSP).toMatch(/(^|;\s*)sandbox\b/)
    expect(SHARE_PAGE_CSP).not.toContain('allow-scripts')
    expect(SHARE_PAGE_CSP).not.toContain('allow-same-origin')
    expect(SHARE_PAGE_CSP).toContain("default-src 'none'")
    expect(SHARE_PAGE_CSP).not.toMatch(/script-src/)
  })

  it('keeps inline styles and images working', () => {
    expect(SHARE_PAGE_CSP).toContain("style-src 'unsafe-inline'")
    expect(SHARE_PAGE_CSP).toMatch(/img-src 'self'/)
  })

  it('blocks forms, framing and base rewriting', () => {
    expect(SHARE_PAGE_CSP).toContain("form-action 'none'")
    expect(SHARE_PAGE_CSP).toContain("frame-ancestors 'none'")
    expect(SHARE_PAGE_CSP).toContain("base-uri 'none'")
  })
})

describe('upgradeLegacyHtml', () => {
  it('drops the Tailwind CDN script from pages made by plugin 0.1.0', () => {
    expect(upgradeLegacyHtml(LEGACY)).not.toContain('cdn.tailwindcss.com')
  })

  it('adds inline CSS for the utility classes the old template used', () => {
    const out = upgradeLegacyHtml(LEGACY)
    expect(out).toMatch(/<style data-share-hosted="legacy">[\s\S]*\.max-w-2xl\{max-width:42rem\}[\s\S]*<\/style>\s*<\/head>/)
    expect(out).toContain('.prose-content { color: red; }')
  })

  it('leaves pages without the CDN script untouched', () => {
    const html = '<!DOCTYPE html><html><head><title>x</title></head><body></body></html>'
    expect(upgradeLegacyHtml(html)).toBe(html)
  })
})

describe('sharePageResponse', () => {
  it('sends the page with CSP, nosniff, no referrer and no caching', async () => {
    const res = sharePageResponse('<!DOCTYPE html><html><head></head><body>ok</body></html>')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('Content-Security-Policy')).toBe(SHARE_PAGE_CSP)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.text()).toContain('ok')
  })
})
