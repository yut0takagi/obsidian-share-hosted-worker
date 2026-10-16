// src/render/sharePage.ts
// Shared pages are HTML written by the plugin, so the Worker serves them as untrusted
// documents: sandboxed, no script, no forms, no framing.

export const SHARE_PAGE_CSP = [
  "default-src 'none'",
  "img-src 'self' https: data:",
  "style-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  // No allow-scripts / allow-same-origin: the page runs nothing and gets an opaque origin.
  'sandbox allow-popups allow-popups-to-escape-sandbox',
].join('; ')

const SHARE_PAGE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': SHARE_PAGE_CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // The URL is what grants access to public notes; keep it out of Referer headers.
  'Referrer-Policy': 'no-referrer',
  // Stopping or re-sharing should take effect on the next load.
  'Cache-Control': 'no-store',
}

export function sharePageResponse(html: string): Response {
  return new Response(upgradeLegacyHtml(html), { headers: SHARE_PAGE_HEADERS })
}

const TAILWIND_CDN_RE = /<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>\s*/

// Plugin 0.1.0 styled its page with the Tailwind Play CDN script, which the CSP now blocks.
// These rules reproduce the reset and the utility classes that template used.
const LEGACY_CSS = [
  '*,::before,::after{box-sizing:border-box;border-width:0;border-style:solid;border-color:#e5e7eb}',
  'html{line-height:1.5;-webkit-text-size-adjust:100%;tab-size:4;font-family:ui-sans-serif,system-ui,sans-serif}',
  'body{margin:0;line-height:inherit}',
  'hr{height:0;color:inherit;border-top-width:1px}',
  'h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}',
  'a{color:inherit;text-decoration:inherit}',
  'b,strong{font-weight:bolder}',
  'code,kbd,samp,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:1em}',
  'sub,sup{font-size:75%;line-height:0;position:relative;vertical-align:baseline}sub{bottom:-.25em}sup{top:-.5em}',
  'table{text-indent:0;border-color:inherit;border-collapse:collapse}',
  'blockquote,dl,dd,h1,h2,h3,h4,h5,h6,hr,figure,p,pre{margin:0}',
  'ol,ul,menu{list-style:none;margin:0;padding:0}',
  'img,svg,video{display:block;vertical-align:middle}img,video{max-width:100%;height:auto}',
  'input{font-family:inherit;font-size:100%;margin:0;padding:0;color:inherit}',
  '.bg-white{background-color:#fff}.text-neutral-900{color:#171717}',
  '.mx-auto{margin-left:auto;margin-right:auto}.max-w-2xl{max-width:42rem}',
  '.px-6{padding-left:1.5rem;padding-right:1.5rem}.py-12{padding-top:3rem;padding-bottom:3rem}',
  '.mb-10{margin-bottom:2.5rem}.pb-6{padding-bottom:1.5rem}.mt-16{margin-top:4rem}.pt-6{padding-top:1.5rem}',
  '.border-b{border-bottom-width:1px}.border-t{border-top-width:1px}.border-neutral-200{border-color:#e5e5e5}',
  '.text-sm{font-size:.875rem;line-height:1.25rem}.text-xs{font-size:.75rem;line-height:1rem}',
  '.text-neutral-500{color:#737373}.text-neutral-400{color:#a3a3a3}',
  '.flex{display:flex}.flex-wrap{flex-wrap:wrap}.gap-x-2{column-gap:.5rem}.gap-y-1{row-gap:.25rem}',
  '@media (prefers-color-scheme:dark){.dark\\:bg-neutral-900{background-color:#171717}.dark\\:text-neutral-100{color:#f5f5f5}.dark\\:border-neutral-800{border-color:#262626}.dark\\:text-neutral-400{color:#a3a3a3}}',
].join('\n')

export function upgradeLegacyHtml(html: string): string {
  if (!TAILWIND_CDN_RE.test(html)) return html
  // The CDN script appended its styles to the end of <head>, so the replacement goes there too.
  const style = `<style data-share-hosted="legacy">\n${LEGACY_CSS}\n</style>\n`
  const stripped = html.replace(TAILWIND_CDN_RE, '')
  return stripped.includes('</head>') ? stripped.replace('</head>', `${style}</head>`) : style + stripped
}
