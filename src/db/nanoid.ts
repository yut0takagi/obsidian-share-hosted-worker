const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'

export function nanoid(length: number): string {
  const arr = new Uint8Array(length)
  crypto.getRandomValues(arr)
  return Array.from(arr).map((b) => ALPHABET[b % ALPHABET.length]).join('')
}

export const userId = () => `u_${nanoid(16)}`
export const sessionToken = () => `s_${nanoid(32)}`
export const magicToken = () => `m_${nanoid(24)}`
export const noteUuid = () => nanoid(12)
