-- Existing D1 databases: add idempotent sync metadata without deleting history.
ALTER TABLE chat_history ADD COLUMN source TEXT NOT NULL DEFAULT 'sync';
ALTER TABLE chat_history ADD COLUMN message_key TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_message_key
  ON chat_history(token, message_key)
  WHERE message_key <> '';

CREATE INDEX IF NOT EXISTS idx_chat_history_incremental
  ON chat_history(token, id);

CREATE TABLE IF NOT EXISTS customer_profiles (
    token       TEXT NOT NULL,
    group_id    TEXT NOT NULL,
    profile_json TEXT NOT NULL DEFAULT '{}',
    last_processed_message_id INTEGER NOT NULL DEFAULT 0,
    extracted_at INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (token, group_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_updated
  ON customer_profiles(token, updated_at);
