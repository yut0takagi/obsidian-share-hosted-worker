// src/auth/verifyPage.ts
// GET /auth/verify only shows this page. Mail scanners that pre-fetch links therefore
// cannot use up the token; the person signing in confirms with a POST.

export const VERIFY_PAGE_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  // The POST answers with a redirect to obsidian://, which form-action also governs.
  "form-action 'self' obsidian:",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

export const VERIFY_PAGE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': VERIFY_PAGE_CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const STYLE = `
body { margin: 0; font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif; background: #fafafa; color: #171717; }
main { max-width: 28rem; margin: 15vh auto 0; padding: 2rem; background: #fff; border: 1px solid #e5e5e5; border-radius: 0.75rem; }
h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
p { line-height: 1.6; color: #525252; margin: 0 0 1.25rem; }
button { font: inherit; font-weight: 600; padding: 0.625rem 1.25rem; border: 0; border-radius: 0.5rem; background: #2563eb; color: #fff; cursor: pointer; }
@media (prefers-color-scheme: dark) {
  body { background: #171717; color: #f5f5f5; }
  main { background: #262626; border-color: #404040; }
  p { color: #a3a3a3; }
}`

function page(title: string, inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${inner}
</main>
</body>
</html>`
}

export function renderConfirmPage(token: string, email: string): string {
  return page('Sign in to Share Hosted', `<h1>Sign in to Share Hosted</h1>
<p>Continue as <strong>${esc(email)}</strong>? Obsidian will open and finish signing in on the device where you asked for this link.</p>
<form method="post" action="/auth/verify">
<input type="hidden" name="token" value="${esc(token)}">
<button type="submit">Sign in and open Obsidian</button>
</form>`)
}

export function renderMessagePage(title: string, message: string): string {
  return page(title, `<h1>${esc(title)}</h1>\n<p>${esc(message)}</p>`)
}
