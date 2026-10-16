// src/assets.ts
// Image assets are content-addressed: the key is (a prefix of) the SHA-256 of the bytes.

/** Types accepted for new uploads. SVG is excluded because it can carry script. */
export const UPLOAD_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** Types served from /a/. SVG stays readable for files uploaded before 0.2.0. */
export const SERVE_TYPES: Record<string, string> = { ...UPLOAD_TYPES, svg: 'image/svg+xml' }

export const MAX_ASSET_BYTES = 20 * 1024 * 1024

// 32 hex = 128 bits, which is what the plugin has always sent.
const HASH_RE = /^[a-f0-9]{32,64}$/

/** Asset responses render nothing active even when opened directly. */
export const ASSET_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox"

export async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', body)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type AssetCheck =
  | { ok: true; key: string; contentType: string; sha256: string }
  | { ok: false; status: 400 | 413; error: string }

export async function checkAssetUpload(hash: string | undefined, ext: string | undefined, body: ArrayBuffer): Promise<AssetCheck> {
  if (!hash || !ext) return { ok: false, status: 400, error: 'hash and ext required' }
  if (!HASH_RE.test(hash)) return { ok: false, status: 400, error: 'invalid hash' }
  const contentType = UPLOAD_TYPES[ext]
  if (!contentType) return { ok: false, status: 400, error: 'unsupported ext (png, jpg, jpeg, gif, webp)' }
  if (body.byteLength === 0) return { ok: false, status: 400, error: 'empty body' }
  if (body.byteLength > MAX_ASSET_BYTES) return { ok: false, status: 413, error: 'asset too large' }
  const sha256 = await sha256Hex(body)
  if (!sha256.startsWith(hash)) return { ok: false, status: 400, error: 'hash does not match body' }
  return { ok: true, key: `${hash}.${ext}`, contentType, sha256 }
}

/** Parses an /a/ filename into its storage key and served type. */
export function parseAssetFilename(filename: string): { key: string; ext: string; contentType: string } | null {
  const m = filename.match(/^([a-f0-9]{16,64})\.([a-z]+)$/)
  if (!m) return null
  const contentType = SERVE_TYPES[m[2]]
  if (!contentType) return null
  return { key: `${m[1]}.${m[2]}`, ext: m[2], contentType }
}
