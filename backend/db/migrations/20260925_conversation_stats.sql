-- Keep dashboard polling cheap by maintaining one summary row per conversation.
CREATE TABLE IF NOT EXISTS conversation_stats (
    token               TEXT NOT NULL,
    platform            TEXT NOT NULL,
    contact_id          TEXT NOT NULL,
    contact_name        TEXT NOT NULL DEFAULT '',
    message_count       INTEGER NOT NULL DEFAULT 0,
    latest_message_id   INTEGER NOT NULL DEFAULT 0,
    latest_role         TEXT NOT NULL DEFAULT '',
    latest_content      TEXT NOT NULL DEFAULT '',
    latest_source       TEXT NOT NULL DEFAULT '',
    latest_at           INTEGER NOT NULL DEFAULT 0,
    updated_at          INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (token, platform, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_stats_recent
  ON conversation_stats(token, latest_at DESC);

-- Backfill existing history once so the dashboard is correct immediately after deployment.
INSERT OR REPLACE INTO conversation_stats (
    token,
    platform,
    contact_id,
    contact_name,
    message_count,
    latest_message_id,
    latest_role,
    latest_content,
    latest_source,
    latest_at,
    updated_at
)
SELECT
    latest.token,
    latest.platform,
    latest.contact_id,
    latest.contact_name,
    totals.message_count,
    latest.id,
    latest.role,
    latest.content,
    COALESCE(latest.source, 'sync'),
    latest.created_at,
    CAST(strftime('%s', 'now') AS INTEGER)
FROM (
    SELECT token, platform, contact_id, MAX(id) AS latest_id, COUNT(*) AS message_count
    FROM chat_history
    GROUP BY token, platform, contact_id
) AS totals
JOIN chat_history AS latest ON latest.id = totals.latest_id;
