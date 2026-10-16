// In-memory R2Bucket stand-in covering the calls the Worker makes.

interface StoredObject {
  body: Uint8Array
  httpMetadata: { contentType?: string }
  customMetadata: Record<string, string>
  uploaded: Date
}

function toBytes(value: unknown): Uint8Array {
  if (value == null) return new Uint8Array()
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof Uint8Array) return new Uint8Array(value)
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
  throw new Error('FakeR2: unsupported body type')
}

function view(key: string, o: StoredObject) {
  return {
    key,
    size: o.body.byteLength,
    uploaded: o.uploaded,
    httpMetadata: { ...o.httpMetadata },
    customMetadata: { ...o.customMetadata },
  }
}

export class FakeR2 {
  objects = new Map<string, StoredObject>()
  putCount = 0

  async put(key: string, value: unknown, opts: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } = {}) {
    const o: StoredObject = {
      body: toBytes(value),
      httpMetadata: { ...(opts.httpMetadata ?? {}) },
      customMetadata: { ...(opts.customMetadata ?? {}) },
      uploaded: new Date(),
    }
    this.objects.set(key, o)
    this.putCount++
    return view(key, o)
  }

  async head(key: string) {
    const o = this.objects.get(key)
    return o ? view(key, o) : null
  }

  async get(key: string) {
    const o = this.objects.get(key)
    if (!o) return null
    const bytes = o.body
    return {
      ...view(key, o),
      async text() { return new TextDecoder().decode(bytes) },
      async arrayBuffer() { return bytes.slice().buffer },
    }
  }

  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k)
  }

  async list(opts: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).sort()
    const start = opts.cursor ? Number(opts.cursor) : 0
    const limit = opts.limit ?? 1000
    const page = keys.slice(start, start + limit)
    const truncated = start + limit < keys.length
    return {
      objects: page.map((k) => view(k, this.objects.get(k)!)),
      truncated,
      cursor: truncated ? String(start + limit) : undefined,
      delimitedPrefixes: [],
    }
  }

  /** Test helper: write an object the way 0.1.0 did (no verification metadata). */
  seed(key: string, body: string | Uint8Array, contentType = 'application/octet-stream') {
    this.objects.set(key, { body: toBytes(body), httpMetadata: { contentType }, customMetadata: {}, uploaded: new Date() })
  }

  text(key: string): string | null {
    const o = this.objects.get(key)
    return o ? new TextDecoder().decode(o.body) : null
  }
}
