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

export async function putAsset(r2: R2Bucket, hash: string, ext: string, body: ArrayBuffer, contentType: string): Promise<void> {
  await r2.put(`assets/${hash}.${ext}`, body, {
    httpMetadata: { contentType },
  })
}

export async function getAsset(r2: R2Bucket, hash: string, ext: string): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  const obj = await r2.get(`assets/${hash}.${ext}`)
  if (!obj) return null
  return {
    body: await obj.arrayBuffer(),
    contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
  }
}
