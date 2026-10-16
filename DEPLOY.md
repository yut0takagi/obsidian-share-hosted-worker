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
token it just made so the person can retry without waiting for the 5-minute limit.
