# obsidian-share-hosted-worker

Cloudflare Worker backend for the [Share Hosted](https://github.com/yut0takagi/obsidian-share-hosted) Obsidian plugin. Multi-tenant: serves all users from a single Worker + D1 + R2.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/request-magic-link` | none | Send magic link to email |
| GET | `/auth/verify` | magic token | Consume token + redirect to obsidian:// with session token |
| GET | `/auth/me` | session | Get current user profile |
| PATCH | `/auth/me` | session | Update profile (default_org_domain, default_owner_name) |
| POST | `/auth/logout` | session | Revoke session |
| POST | `/api/share` | session | Create or update a shared note |
| DELETE | `/api/share/:uuid` | session | Un-publish a note (owner check) |
| POST | `/api/asset` | session | Upload an image binary |
| GET | `/n/:uuid` | CF Access | Reader endpoint (Org/List modes) |
| GET | `/p/:uuid` | none | Public reader |
| GET | `/a/:filename` | none | Asset serving |

## Self-host setup

```bash
git clone https://github.com/yut0takagi/obsidian-share-hosted-worker
cd obsidian-share-hosted-worker
npm install
npx wrangler login
npx wrangler r2 bucket create share-hosted
npx wrangler d1 create share-hosted   # paste binding into wrangler.toml
npm run db:init:prod

# Configure CF Access app on /n/* path (see docs)

echo "<team>.cloudflareaccess.com" | npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
echo "<aud>" | npx wrangler secret put CF_ACCESS_AUD
npx wrangler deploy
```

## Tests

```bash
npx vitest run
```

17 tests covering: D1 queries, magic-link auth (request + verify), audience check, JWT verification.

## License

MIT
