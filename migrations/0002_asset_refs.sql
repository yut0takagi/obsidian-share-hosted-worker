-- 0.2.0: track which notes use which images, so stopping a share can delete
-- images that no other note uses.
CREATE TABLE IF NOT EXISTS assets (
  key TEXT PRIMARY KEY,               -- "<hash>.<ext>", stored in R2 as assets/<key>
  created_at TEXT NOT NULL,
  claimed_at TEXT NOT NULL,           -- last upload of these bytes; recent ones are never deleted
  legacy INTEGER NOT NULL DEFAULT 0   -- 1 = already in R2 before tracking began; never deleted
);

CREATE TABLE IF NOT EXISTS note_assets (
  note_uuid TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  PRIMARY KEY (note_uuid, asset_key)
);
CREATE INDEX IF NOT EXISTS idx_note_assets_asset_key ON note_assets(asset_key);
