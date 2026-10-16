-- 0.2.0: fixed-window counters for sign-in email: per address and IP, per IP, per day.
-- Buckets hold hashes, not raw addresses or IPs. Old windows are purged by the scheduled job.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start);
