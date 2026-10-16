#!/usr/bin/env node
// Lists org-wide shares made before 0.2.0 that 0.2.0 refuses to open: their stored domain is
// a free-mail domain or is not the owner's sign-in domain. Run it on copies of the data, before
// deploying, to tell those owners to share again. It reads local files only.
//
//   node scripts/legacy-org-shares.mjs --notes ./notes --users ./users.json [--extra "isp.example"]
//
// --notes  directory with the notes/*.json objects downloaded from R2
// --users  output of: wrangler d1 execute share-hosted --remote --json --command "SELECT id, email FROM users"
// --extra  the EXTRA_FREE_MAIL_DOMAINS value, if you set one
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BUILT_IN = JSON.parse(readFileSync(new URL('../src/auth/freeMailDomains.json', import.meta.url), 'utf8'))

function arg(name) {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}

const notesDir = arg('--notes')
const usersFile = arg('--users')
if (!notesDir || !usersFile) {
  console.error('usage: node scripts/legacy-org-shares.mjs --notes <dir> --users <users.json> [--extra "<domains>"]')
  process.exit(2)
}

const freeMail = new Set([...BUILT_IN, ...(arg('--extra') ?? '').split(/[\s,]+/)].map((d) => d.trim().toLowerCase()).filter(Boolean))
const usersJson = JSON.parse(readFileSync(usersFile, 'utf8'))
// Accepts wrangler's [{ results: [...] }] shape or a plain array of { id, email }.
const users = Array.isArray(usersJson) && usersJson[0]?.results ? usersJson.flatMap((r) => r.results) : usersJson
const emailById = new Map(users.map((u) => [u.id, String(u.email).toLowerCase()]))

console.log(['uuid', 'owner_email', 'stored_domain', 'reason'].join('\t'))
for (const file of readdirSync(notesDir).filter((f) => f.endsWith('.json')).sort()) {
  const meta = JSON.parse(readFileSync(join(notesDir, file), 'utf8'))
  if (meta.mode !== 'org') continue
  const stored = String(meta.org_domain ?? '').trim().toLowerCase()
  const owner = emailById.get(meta.owner_id) ?? ''
  const ownerDomain = owner.includes('@') ? owner.slice(owner.lastIndexOf('@') + 1) : ''
  let reason = null
  if (!owner) reason = 'owner not found'
  else if (freeMail.has(ownerDomain)) reason = 'free-mail domain'
  else if (stored !== ownerDomain) reason = "not the owner's sign-in domain"
  if (reason) console.log([meta.uuid, owner, stored, reason].join('\t'))
}
