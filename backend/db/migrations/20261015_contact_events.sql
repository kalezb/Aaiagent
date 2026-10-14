CREATE TABLE IF NOT EXISTS contact_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token         TEXT NOT NULL,
  platform      TEXT NOT NULL,
  contact_id    TEXT NOT NULL,
  event_type    TEXT NOT NULL DEFAULT '',
  content       TEXT NOT NULL DEFAULT '',
  happened_at   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_contact_events_recent
  ON contact_events(token, platform, contact_id, happened_at DESC);
