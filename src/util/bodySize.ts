// src/util/bodySize.ts
/** True when the declared Content-Length is over the limit, so the body need not be read. */
export function declaredTooLarge(contentLength: string | undefined, limit: number): boolean {
  if (!contentLength) return false
  const n = Number(contentLength)
  return Number.isFinite(n) && n > limit
}
