// src/assetRefs.ts
// Images are shared by content hash, so several notes (even of different owners) can point
// at one object. D1 keeps note -> image references; an image is deleted only when no note
// references it, it was not already in R2 before tracking began, and nobody uploaded it
// within the grace period (an upload may be about to be shared).
//
// Writes are ordered so that a failure part-way leaves images in place rather than removing
// one that is still shown: references are added before the HTML that uses them is written,
// and removed only after it.
import { getMeta, deleteNote } from './r2'

export const ASSET_GRACE_MS = 60 * 60 * 1000
export const EXPIRED_NOTE_GRACE_MS = 7 * 24 * 60 * 60 * 1000
const SWEEP_MAX_DELETES = 100

/** ASSET_CLEANUP=off stops image deletion (references are still recorded), e.g. during a rollback. */
type Env = { DB: D1Database; R2: R2Bucket; ASSET_CLEANUP?: string }

const ASSET_REF_RE = /(?<![\w./:-])\/a\/([a-f0-9]{16,64}\.(?:png|jpe?g|gif|webp|svg))\b/g

export function extractAssetKeys(html: string): string[] {
  return [...new Set([...html.matchAll(ASSET_REF_RE)].map((m) => m[1]))]
}

/**
 * Records an upload before the caller looks at R2. Returns true when this created the row.
 * Claiming first means a clean-up running at the same time either sees the claim and keeps
 * the image, or sees it after deleting and puts the bytes back (see releaseAssets).
 */
export async function claimAsset(db: D1Database, key: string, now: Date): Promise<boolean> {
  const at = now.toISOString()
  const inserted = await db.prepare(
    'INSERT OR IGNORE INTO assets (key, created_at, claimed_at, legacy) VALUES (?, ?, ?, 0)'
  ).bind(key, at, at).run()
  if ((inserted.meta?.changes ?? 0) === 1) return true
  await db.prepare('UPDATE assets SET claimed_at = ? WHERE key = ?').bind(at, key).run()
  return false
}

/** An object that was in R2 before its row existed predates tracking; it is never deleted. */
export async function markLegacyAsset(db: D1Database, key: string): Promise<void> {
  await db.prepare('UPDATE assets SET legacy = 1 WHERE key = ?').bind(key).run()
}

async function noteAssetKeys(db: D1Database, uuid: string): Promise<string[]> {
  const r = await db.prepare('SELECT asset_key FROM note_assets WHERE note_uuid = ?').bind(uuid).all<{ asset_key: string }>()
  return r.results.map((x) => x.asset_key)
}

/** Step 1 of a share: reference every image the new HTML uses, before that HTML is written. */
export async function addNoteAssets(env: Env, uuid: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return
  await env.DB.batch(keys.map((k) => env.DB.prepare('INSERT OR IGNORE INTO note_assets (note_uuid, asset_key) VALUES (?, ?)').bind(uuid, k)))
}

/** Step 3 of a share, after the HTML is written: drop references it no longer has and release them. */
export async function pruneNoteAssets(env: Env, uuid: string, keep: string[], now: Date): Promise<void> {
  const dropped = (await noteAssetKeys(env.DB, uuid)).filter((k) => !keep.includes(k))
  if (dropped.length === 0) return
  await env.DB.batch(dropped.map((k) => env.DB.prepare('DELETE FROM note_assets WHERE note_uuid = ? AND asset_key = ?').bind(uuid, k)))
  await releaseAssets(env, dropped, now)
}

export async function releaseAssets(env: Env, keys: string[], now: Date): Promise<void> {
  if ((env.ASSET_CLEANUP ?? '').trim().toLowerCase() === 'off') return
  const cutoff = new Date(now.getTime() - ASSET_GRACE_MS).toISOString()
  for (const key of keys) {
    // One conditional statement decides, so a reference or claim that is already there keeps the image.
    const r = await env.DB.prepare(
      'DELETE FROM assets WHERE key = ? AND legacy = 0 AND claimed_at <= ? AND NOT EXISTS (SELECT 1 FROM note_assets WHERE asset_key = ?)'
    ).bind(key, cutoff, key).run()
    if ((r.meta?.changes ?? 0) !== 1) continue

    // An upload may claim the key between that decision and the delete below and skip writing
    // because the object still exists. Keep the bytes and put them back if that happened.
    const obj = await env.R2.get(`assets/${key}`)
    const bytes = obj ? await obj.arrayBuffer() : null
    await env.R2.delete(`assets/${key}`)
    const reclaimed = await env.DB.prepare(
      'SELECT 1 AS hit FROM assets WHERE key = ? UNION ALL SELECT 1 FROM note_assets WHERE asset_key = ? LIMIT 1'
    ).bind(key, key).first<number>('hit')
    if (reclaimed && obj && bytes) {
      await env.R2.put(`assets/${key}`, bytes, { httpMetadata: obj.httpMetadata, customMetadata: obj.customMetadata })
    }
  }
}

/** Deletes a note's objects and references, then releases its images. */
export async function removeNote(env: Env, uuid: string, now: Date): Promise<void> {
  const keys = await noteAssetKeys(env.DB, uuid)
  await deleteNote(env.R2, uuid)
  await env.DB.prepare('DELETE FROM note_assets WHERE note_uuid = ?').bind(uuid).run()
  await releaseAssets(env, keys, now)
}

/** Removes notes whose expiry passed more than 7 days ago. Meant for a cron trigger. */
export async function sweepExpiredNotes(env: Env, now: Date): Promise<number> {
  const cutoff = now.getTime() - EXPIRED_NOTE_GRACE_MS
  let removed = 0
  let cursor: string | undefined
  do {
    // `include` is honored at this compatibility_date but missing from the undated workers-types.
    const page = await env.R2.list({ prefix: 'notes/', cursor, include: ['customMetadata'] } as R2ListOptions)
    for (const obj of page.objects) {
      if (!obj.key.endsWith('.json')) continue
      const uuid = obj.key.slice('notes/'.length, -'.json'.length)
      // Notes written by 0.2.0 carry expires_at as object metadata; older ones need a read.
      let expiresAt: string | null | undefined = obj.customMetadata?.expires_at
      if (expiresAt === undefined) expiresAt = (await getMeta(env.R2, uuid))?.expires_at ?? null
      if (!expiresAt) continue
      const t = Date.parse(expiresAt)
      if (Number.isNaN(t) || t > cutoff) continue
      await removeNote(env, uuid, now)
      if (++removed >= SWEEP_MAX_DELETES) return removed
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return removed
}
