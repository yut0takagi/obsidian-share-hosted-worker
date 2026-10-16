// src/util/email.ts
export const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
