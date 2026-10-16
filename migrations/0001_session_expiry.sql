-- 0.2.0: sessions expire after 30 days.
-- Sessions created before this migration get 30 days from the moment it runs,
-- so existing sign-ins keep working for a while instead of ending at once.
ALTER TABLE sessions ADD COLUMN expires_at TEXT;
UPDATE sessions SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days') WHERE expires_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Rate limiting looks up the latest link per address.
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_email_created ON magic_link_tokens(email, created_at);
