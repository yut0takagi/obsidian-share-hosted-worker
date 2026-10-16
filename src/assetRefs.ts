// src/assetRefs.ts
// Images are shared by content hash, so several notes (even of different owners) can point
// at one object. D1 keeps note -> image references; an image is deleted only when no note
// references it, it was not already in R2 before tracking began, and nobody uploaded it
// within the grace period (an upload may be about to be shared).
import { getMeta, deleteNote } from './r2'

export const ASSET_GRACE_MS = 60 * 60 * 1000
export const EXPIRED_NOTE_GRACE_MS = 7 * 24 * 60 * 60 * 1000
const SWEEP_MAX_DELETES = 100

type Env = { DB: D1Database; R2: R2Bucket }

const ASSET_REF_RE = /(?<![\w./:-])\/a\/([a-f0-9]{16,64}\.(?:png|jpe?g|gif|webp|svg))\b/g

export function extractAssetKeys(html: string): string[] {
  return [...new Set([...html.matchAll(ASSET_REF_RE)].map((m) => m[1]))]
}

export async function claimAsset(db: D1Database, key: string, now: Date, alreadyStored: boolean): Promise<void> {
  const at = now.toISOString()
  await db.prepare(
    'INSERT INTO assets (key, created_at, claimed_at, legacy) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET claimed_at = excluded.claimed_at'
  ).bind(key, at, at, alreadyStored ? 1 : 0).run()
}

async function noteAssetKeys(db: D1Database, uuid: string): Promise<string[]> {
  const r = await db.prepare('SELECT asset_key FROM note_assets WHERE note_uuid = ?').bind(uuid).all<{ asset_key: string }>()
  return r.results.map((x) => x.asset_key)
}

/** Replaces the note's references with the images in its HTML and releases the ones it dropped. */
export async function recordNoteAssets(env: Env, uuid: string, html: string, now: Date): Promise<void> {
  const before = await noteAssetKeys(env.DB, uuid)
  const after = extractAssetKeys(html)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM note_assets WHERE note_uuid = ?').bind(uuid),
    ...after.map((k) => env.DB.prepare('INSERT OR IGNORE INTO note_assets (note_uuid, asset_key) VALUES (?, ?)').bind(uuid, k)),
  ])
  await releaseAssets(env, before.filter((k) => !after.includes(k)), now)
}

export async function releaseAssets(env: Env, keys: string[], now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - ASSET_GRACE_MS).toISOString()
  for (const key of keys) {
    // One conditional statement decides, so a reference or upload landing meanwhile keeps the image.
    const r = await env.DB.prepare(
      'DELETE FROM assets WHERE key = ? AND legacy = 0 AND claimed_at <= ? AND NOT EXISTS (SELECT 1 FROM note_assets WHERE asset_key = ?)'
    ).bind(key, cutoff, key).run()
    if ((r.meta?.changes ?? 0) === 1) await env.R2.delete(`assets/${key}`)
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
