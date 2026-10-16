-- 0.2.0: one-time codes put on the obsidian:// callback instead of the session token, for
-- plugins that send a state. The plugin trades code + state for the token at /auth/exchange,
-- so the 30-day token never appears in a URL or browser history.
CREATE TABLE IF NOT EXISTS auth_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
