import { describe, it, expect } from 'vitest'
// @ts-expect-error -- node builtins are outside the Workers type set this repo compiles against
import { createRequire } from 'node:module'

const nodeRequire = createRequire(import.meta.url)
const fs = nodeRequire('node:fs') as { mkdtempSync(p: string): string; mkdirSync(p: string): void; writeFileSync(p: string, d: string): void }
const os = nodeRequire('node:os') as { tmpdir(): string }
const cp = nodeRequire('node:child_process') as { execFileSync(cmd: string, args: string[], o: { encoding: 'utf8' }): string }
const SCRIPT = new URL('../scripts/legacy-org-shares.mjs', import.meta.url).pathname

function note(uuid: string, mode: string, org_domain: string, owner_id: string) {
  return JSON.stringify({ uuid, mode, org_domain, owner_id, audience: [], expires_at: null, title: 't', source_path: 't.md', owner_email: '', created_at: '', updated_at: '' })
}

describe('scripts/legacy-org-shares.mjs', () => {
  it('lists org shares that 0.2.0 will refuse, with the reason', () => {
    const dir = fs.mkdtempSync(`${os.tmpdir()}/legacy-org-`)
    fs.mkdirSync(`${dir}/notes`)
    fs.writeFileSync(`${dir}/notes/ok1.json`, note('ok1', 'org', 'example.com', 'u1'))
    fs.writeFileSync(`${dir}/notes/free1.json`, note('free1', 'org', 'gmail.com', 'u2'))
    fs.writeFileSync(`${dir}/notes/other1.json`, note('other1', 'org', 'other.test', 'u1'))
    fs.writeFileSync(`${dir}/notes/gone1.json`, note('gone1', 'org', 'example.com', 'u9'))
    fs.writeFileSync(`${dir}/notes/list1.json`, note('list1', 'list', '', 'u2'))
    fs.writeFileSync(`${dir}/notes/extra1.json`, note('extra1', 'org', 'isp.test', 'u3'))
    // Shape of `wrangler d1 execute --json` output.
    fs.writeFileSync(`${dir}/users.json`, JSON.stringify([{ results: [
      { id: 'u1', email: 'owner@example.com' },
      { id: 'u2', email: 'freemail-test-owner@gmail.com' },
      { id: 'u3', email: 'someone@isp.test' },
    ], success: true }]))

    const out = cp.execFileSync('node', [SCRIPT, '--notes', `${dir}/notes`, '--users', `${dir}/users.json`, '--extra', 'isp.test'], { encoding: 'utf8' })
    const rows = out.trim().split('\n').slice(1).map((l) => l.split('\t')).sort((a, b) => a[0].localeCompare(b[0]))
    expect(rows).toEqual([
      ['extra1', 'someone@isp.test', 'isp.test', 'free-mail domain'],
      ['free1', 'freemail-test-owner@gmail.com', 'gmail.com', 'free-mail domain'],
      ['gone1', '', 'example.com', 'owner not found'],
      ['other1', 'owner@example.com', 'other.test', 'not the owner\'s sign-in domain'],
    ])
  })
})
