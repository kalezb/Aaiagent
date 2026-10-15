CREATE TABLE IF NOT EXISTS conversation_memory (
    token       TEXT NOT NULL,
    platform    TEXT NOT NULL,
    contact_id  TEXT NOT NULL,
    memory_json TEXT NOT NULL DEFAULT '{}',
    updated_at  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (token, platform, contact_id)
);
