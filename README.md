# obsidian-share-hosted-worker

Cloudflare Worker backend for the [Share Hosted](https://github.com/yut0takagi/obsidian-share-hosted) Obsidian plugin. Multi-tenant: serves all users from a single Worker + D1 + R2.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/request-magic-link` | none | Send a sign-in link. Rate-limited per address+IP, per IP and per day. Optional `state` is returned on the callback |
| GET | `/auth/verify` | magic token | Show a confirmation page (does not use the token) |
| POST | `/auth/verify` | magic token | Use the token and redirect to obsidian://: with a one-time code if the plugin sent a state, else with a 30-day session token (0.1.0 plugins) |
| POST | `/auth/exchange` | code + state | Trade the one-time code (5 minutes) for a 30-day session token |
| GET | `/auth/me` | session | Current user, plus `org: { domain, available }` |
| PATCH | `/auth/me` | session | Update profile (default_owner_name) |
| POST | `/auth/logout` | session | Revoke this session |
| POST | `/auth/logout-all` | session | Revoke every session of the account |
| POST | `/api/share` | session | Create a share (server picks the id) or update one you own |
| GET | `/api/share/:uuid` | session | Mode, recipients and expiry of a share you own |
| DELETE | `/api/share/:uuid` | session | Un-publish a share you own and delete images nothing else uses |
| POST | `/api/asset` | session | Upload an image (png, jpg, gif, webp, svg); the hash must match the bytes |
| GET | `/n/:uuid` | CF Access | Reader endpoint (Org/List modes) |
| GET | `/p/:uuid` | none | Public reader |
| GET | `/a/:filename` | none | Image serving |

Shared pages are served with a sandboxing Content-Security-Policy (no scripts, no forms,
no framing). Org mode is limited to the owner's own sign-in domain and is unavailable for
consumer mail domains such as gmail.com (operators can add more with `EXTRA_FREE_MAIL_DOMAINS`).

Images are stored once per content and served from `/a/<hash>.<ext>`, where the hash is
derived from the image bytes. That URL is not tied to a share's audience: anyone who has it
can fetch the image, whatever the note's mode. This has been the design since 0.1.0; keep it
in mind for sensitive images.

## Self-host setup

```bash
git clone https://github.com/yut0takagi/obsidian-share-hosted-worker
cd obsidian-share-hosted-worker
npm install
npx wrangler login
npx wrangler r2 bucket create share-hosted
npx wrangler d1 create share-hosted   # paste binding into wrangler.toml
npm run db:init:prod
npm run db:migrate:prod

# Configure CF Access app on /n/* path (see docs)

echo "<team>.cloudflareaccess.com" | npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
echo "<aud>" | npx wrangler secret put CF_ACCESS_AUD

# Sign-in email (needs a domain verified in Resend; see DEPLOY.md)
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put MAIL_FROM

npx wrangler deploy
```

[DEPLOY.md](DEPLOY.md) covers email setup, migrations, image clean-up and the optional cron
trigger for expired notes.

## Tests

```bash
npx vitest run
```

Route tests run the real schema and migrations on `node:sqlite` (Node 22.5 or later) with an
in-memory R2, covering sign-in, sessions, sharing, org-domain rules, image upload and clean-up,
and the headers shared pages are served with. No email is sent and nothing reaches Cloudflare.

## License

MIT
