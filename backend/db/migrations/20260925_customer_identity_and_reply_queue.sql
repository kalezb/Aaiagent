-- 跨平台客户身份组
CREATE TABLE IF NOT EXISTS customer_groups (
    id          TEXT PRIMARY KEY,
    token       TEXT NOT NULL,
    display_name TEXT NOT NULL,
    notes       TEXT NOT NULL DEFAULT '',
    priority_reply INTEGER NOT NULL DEFAULT 0,
    priority_last_used_at INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_groups_token ON customer_groups(token);
CREATE INDEX IF NOT EXISTS idx_customer_groups_priority ON customer_groups(token, priority_reply, priority_last_used_at);

-- 一个身份组可以绑定同一客户在 Soul、QQ、陌陌、连信上的多个账号
CREATE TABLE IF NOT EXISTS contact_links (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id    TEXT NOT NULL,
    token       TEXT NOT NULL,
    platform    TEXT NOT NULL,
    contact_id  TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    UNIQUE(token, platform, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_links_group ON contact_links(token, group_id);
CREATE INDEX IF NOT EXISTS idx_contact_links_contact ON contact_links(token, platform, contact_id);

-- 网页人工插入消息和优先回复任务的统一队列
CREATE TABLE IF NOT EXISTS manual_replies (
    id          TEXT PRIMARY KEY,
    token       TEXT NOT NULL,
    platform    TEXT NOT NULL,
    contact_id  TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    group_id    TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    priority    INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    claimed_at  INTEGER,
    sent_at     INTEGER,
    error       TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_manual_replies_pending ON manual_replies(token, platform, status, priority, created_at);

-- 同一跨平台客户共享的长期记忆，避免在 Soul/QQ/陌陌/连信之间切换后失忆
CREATE TABLE IF NOT EXISTS customer_summaries (
    token       TEXT NOT NULL,
    group_id    TEXT NOT NULL,
    summary     TEXT NOT NULL DEFAULT '',
    summarized_up_to_id INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (token, group_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_summaries_updated ON customer_summaries(token, updated_at);
