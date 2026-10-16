import type { NoteMeta } from './types'

export async function putMeta(r2: R2Bucket, uuid: string, meta: NoteMeta): Promise<void> {
  await r2.put(`notes/${uuid}.json`, JSON.stringify(meta), {
    httpMetadata: { contentType: 'application/json' },
  })
}

export async function getMeta(r2: R2Bucket, uuid: string): Promise<NoteMeta | null> {
  const obj = await r2.get(`notes/${uuid}.json`)
  if (!obj) return null
  return JSON.parse(await obj.text()) as NoteMeta
}

export async function putHtml(r2: R2Bucket, uuid: string, html: string): Promise<void> {
  await r2.put(`notes/${uuid}.html`, html, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  })
}

export async function getHtml(r2: R2Bucket, uuid: string): Promise<string | null> {
  const obj = await r2.get(`notes/${uuid}.html`)
  if (!obj) return null
  return await obj.text()
}

export async function deleteNote(r2: R2Bucket, uuid: string): Promise<void> {
  await r2.delete([`notes/${uuid}.json`, `notes/${uuid}.html`])
}

export async function putAsset(r2: R2Bucket, key: string, body: ArrayBuffer, contentType: string, sha256: string): Promise<void> {
  await r2.put(`assets/${key}`, body, {
    httpMetadata: { contentType },
    // Marks the bytes as checked against the key. Objects from 0.1.0 lack it.
    customMetadata: { sha256 },
  })
}

export async function headAsset(r2: R2Bucket, key: string): Promise<{ sha256: string | null } | null> {
  const obj = await r2.head(`assets/${key}`)
  if (!obj) return null
  return { sha256: obj.customMetadata?.sha256 ?? null }
}

export async function getAsset(r2: R2Bucket, key: string): Promise<ArrayBuffer | null> {
  const obj = await r2.get(`assets/${key}`)
  if (!obj) return null
  return await obj.arrayBuffer()
}
