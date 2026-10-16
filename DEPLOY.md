# Deploying the Worker

Operator notes for running `obsidian-share-hosted-worker`. Commands that change Cloudflare
(`wrangler secret put`, `wrangler d1 migrations apply --remote`, `wrangler deploy`) are run
by the operator; nothing in this repository runs them automatically.

## Sign-in email

The plugin signs people in with a one-time link sent by email. The Worker sends it through
the [Resend](https://resend.com) API. MailChannels' free sending for Workers ended on
2024-08-31, so the Worker no longer uses it.

What you need:

1. **A domain you control.** Resend only sends from domains whose DNS records you add.
   A `*.workers.dev` address cannot be verified, so the sender has to live on your own
   domain (a subdomain such as `mail.example.com` is fine).
2. **A Resend account** with that domain added and verified (SPF and DKIM records).
3. **An API key** with "Sending access" for that domain.

Settings read by the Worker:

| Name | Kind | Example | Notes |
|---|---|---|---|
| `RESEND_API_KEY` | secret | – | Set with `wrangler secret put`. Never commit it. |
| `MAIL_FROM` | var or secret | `noreply@mail.example.com` | Address on the verified domain. |
| `MAIL_FROM_NAME` | var | `Share Hosted` | Optional. Defaults to `Share Hosted`. |

```bash
npx wrangler secret put RESEND_API_KEY      # paste the key when prompted
# then either add MAIL_FROM under [vars] in wrangler.toml, or:
npx wrangler secret put MAIL_FROM
```

If either `RESEND_API_KEY` or `MAIL_FROM` is missing, `POST /auth/request-magic-link`
answers `503` with `{"error":"email_not_configured","missing":[...]}` naming what is
missing, and logs the same list. No sign-in token is created in that case.

If Resend refuses a send, the Worker answers `502`, logs Resend's status, and deletes the
token it just made.

### Sign-in email limits

Each request for a sign-in link passes three fixed-window counters kept in D1 (as hashes,
not raw addresses or IPs). The first one that is full answers `429` with `Retry-After`.

| Limit | Default | Setting |
|---|---|---|
| Same address from the same IP (`CF-Connecting-IP`) | 3 per 15 minutes | fixed |
| One IP, any address | 10 per hour | `SIGN_IN_PER_IP_PER_HOUR` (var) |
| Whole service | 100 per UTC day | `MAIL_DAILY_LIMIT` (var) |

The address limit counts per IP so that requests from somewhere else cannot use up the
allowance of the person signing in. The daily default matches Resend's free tier; raise it
if your plan allows more.

## Database migrations

`src/db/schema.sql` is the 0.1.0 baseline. Every later change is a file in `migrations/`,
applied in order by Wrangler, which records what it has applied in a `d1_migrations` table.

| File | What it does |
|---|---|
| `0001_session_expiry.sql` | Adds `sessions.expires_at`. Existing sessions get 30 days from when the migration runs. Adds an index for the sign-in email rate limit. |
| `0002_asset_refs.sql` | Adds `assets` and `note_assets`, used to delete images when a share stops. |
| `0003_rate_limits.sql` | Adds `rate_limits`, the sign-in email counters. |
| `0004_auth_codes.sql` | Adds `auth_codes`, one-time codes that plugin 0.2.0 trades for its session token. |

They only add columns, tables and indexes, so the 0.1.0 Worker keeps working against a
migrated database. Apply them **before** deploying the new Worker code, which reads the new
columns:

```bash
# existing deployment
npx wrangler d1 migrations apply share-hosted --remote

# new deployment: baseline first, then the migrations
npm run db:init:prod
npx wrangler d1 migrations apply share-hosted --remote
```

Try them locally first with `--local` instead of `--remote`.

## Image clean-up

When a share stops, or an update no longer shows an image, the Worker deletes images that
no other note uses. Images are kept when:

- another note still references them (images are shared by content hash),
- they were already in R2 before reference tracking began (0.1.0 uploads), or
- someone uploaded the same bytes within the last hour.

Images uploaded before the upgrade are never deleted automatically, even after re-sharing,
because notes stored by 0.1.0 may still point at them without a recorded reference.

### Expired notes (optional cron)

Expired links already answer `410`. To also remove their files, the Worker exports a
`scheduled` handler that deletes notes whose expiry passed more than 7 days ago (up to 100
per run), together with images nothing else uses. It runs only if you add a cron trigger:

```toml
# wrangler.toml
[triggers]
crons = ["17 3 * * *"]   # daily at 03:17 UTC
```

Then deploy. Without the trigger, expired notes stay in R2 and keep answering `410`. The
same run also deletes rate-limit counters older than two days, and sign-in tokens and
one-time codes that expired more than a day ago; without it those rows stay in D1.

## Org-wide shares that stop opening

0.1.0 stored whatever org domain the plugin sent. 0.2.0 opens an org-wide share only when
its stored domain is the owner's own sign-in domain and not a free-mail domain (built-in
list plus `EXTRA_FREE_MAIL_DOMAINS`). Other org shares answer `403` with a page asking the
reader to have the owner share again. To find them before deploying:

1. Export the users table (a read-only query):

   ```bash
   npx wrangler d1 execute share-hosted --remote --json \
     --command "SELECT id, email FROM users" > users.json
   ```

2. Download the note metadata (`notes/*.json`) from R2 with any S3-compatible client and an
   R2 API token, for example:

   ```bash
   aws s3 sync s3://share-hosted/notes ./notes --exclude "*" --include "*.json" \
     --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   ```

3. List the affected shares (reads the local files only):

   ```bash
   node scripts/legacy-org-shares.mjs --notes ./notes --users users.json \
     [--extra "<value of EXTRA_FREE_MAIL_DOMAINS>"]
   ```

   Output is tab-separated: `uuid`, owner email, stored domain, and the reason
   (`free-mail domain`, `not the owner's sign-in domain`, `owner not found`).

4. Let those owners know; re-sharing from plugin 0.2.0 fixes the share.

Delete `users.json` and `./notes` afterwards: they contain account emails and note titles.
