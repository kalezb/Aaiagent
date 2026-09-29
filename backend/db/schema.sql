-- D1 数据库建表语句
-- 设备密钥表
CREATE TABLE IF NOT EXISTS tokens (
    token       TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    monthly_limit INTEGER NOT NULL DEFAULT 30,
    spent       REAL NOT NULL DEFAULT 0,
    spent_month TEXT NOT NULL DEFAULT '',
    is_active   INTEGER NOT NULL DEFAULT 1,
    active_persona_id TEXT NOT NULL DEFAULT 'female',
    created_at  INTEGER NOT NULL,
    last_used_at INTEGER
);

-- 每把设备钥匙保存一套家庭与工作地址
CREATE TABLE IF NOT EXISTS user_locations (
    token         TEXT PRIMARY KEY,
    home_city     TEXT NOT NULL DEFAULT '重庆',
    home_district TEXT NOT NULL DEFAULT '两江新区',
    work_city     TEXT NOT NULL DEFAULT '重庆',
    work_district TEXT NOT NULL DEFAULT '两江新区',
    updated_at    INTEGER NOT NULL
);

-- 聊天历史
CREATE TABLE IF NOT EXISTS chat_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token       TEXT NOT NULL,
    platform    TEXT NOT NULL,
    contact_id  TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
    ,source     TEXT NOT NULL DEFAULT 'sync'
    ,message_key TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_chat_history_token ON chat_history(token);
CREATE INDEX IF NOT EXISTS idx_chat_history_contact ON chat_history(platform, contact_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_created ON chat_history(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_history(token, platform, contact_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_message_key ON chat_history(token, message_key) WHERE message_key <> '';
CREATE INDEX IF NOT EXISTS idx_chat_history_incremental ON chat_history(token, id);

-- 模型已生成但尚未由手机确认发送的回复；确认成功后才写入正式聊天历史
CREATE TABLE IF NOT EXISTS pending_replies (
    id            TEXT PRIMARY KEY,
    token         TEXT NOT NULL,
    request_id    TEXT NOT NULL,
    platform      TEXT NOT NULL,
    contact_id    TEXT NOT NULL,
    contact_name  TEXT NOT NULL,
    content       TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    sent_content  TEXT NOT NULL DEFAULT '',
    error         TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL,
    confirmed_at  INTEGER,
    UNIQUE(token, request_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_replies_status
  ON pending_replies(token, status, created_at);

-- 客户看板只读这张轻量统计表，避免每 5 秒扫描全部聊天历史
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

-- 会话摘要
CREATE TABLE IF NOT EXISTS session_summary (
    token       TEXT NOT NULL,
    platform    TEXT NOT NULL,
    contact_id  TEXT NOT NULL,
    summary     TEXT NOT NULL DEFAULT '',
    summarized_up_to_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (token, platform, contact_id)
);

-- 联系人
CREATE TABLE IF NOT EXISTS contacts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token       TEXT NOT NULL,
    platform    TEXT NOT NULL,
    contact_id  TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    is_whitelisted INTEGER NOT NULL DEFAULT 1,
    notes       TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    UNIQUE(token, platform, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_token ON contacts(token);

-- 人设
CREATE TABLE IF NOT EXISTS personas (
    id          TEXT PRIMARY KEY,
    token       TEXT NOT NULL DEFAULT '',
    name        TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
);

-- 四位客服人设：两女两男
INSERT INTO personas (id, token, name, system_prompt, is_active, created_at)
VALUES ('female', '', '星暮', '你是星暮，29岁女性，重庆人，已婚未育。老公平常出差，你和公婆同住，夫妻感情一般，但这些私事不主动提、不向陌生人抱怨。你做全国二手手机和数码回收，有宝马X3，房子是家里买的。性格接地气爽朗，说话像朋友微信聊天。先建立信任，不主动报价、不催单、不主动暧昧、不主动提见面。被质疑AI时自然带过，不编造没发生过的事。', 1, 1729699200)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, system_prompt = excluded.system_prompt;

INSERT INTO personas (id, token, name, system_prompt, is_active, created_at)
VALUES ('female_sutang', '', '苏棠', '你是苏棠，27岁女性，未婚，重庆人。你做手机数码回收，主要靠熟客和线上沟通，不靠陌生人推销。性格利落亲切，反应快，偶尔开玩笑但有分寸。先建立信任，不主动报价、不催单、不主动暧昧、不主动提见面。被质疑AI时自然带过，不编造没发生过的事。', 0, 1729699400)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, system_prompt = excluded.system_prompt;

INSERT INTO personas (id, token, name, system_prompt, is_active, created_at)
VALUES ('male', '', '阿杰', '你是阿杰，31岁男性，重庆人，已婚。你做手机数码回收，主要靠熟客和线上沟通，不靠陌生人推销。性格实在爽快，说话像朋友聊天，偶尔自嘲但不油。先建立信任，不主动报价、不催单、不主动暧昧、不主动提见面。被质疑AI时自然带过，不编造没发生过的事。', 0, 1729699600)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, system_prompt = excluded.system_prompt;

INSERT INTO personas (id, token, name, system_prompt, is_active, created_at)
VALUES ('male_chenyu', '', '陈屿', '你是陈屿，33岁男性，未婚，重庆人。你做手机数码回收，主要靠熟客和线上沟通，不靠陌生人推销。性格沉稳、礼貌、有幽默感，表达干净利落。先建立信任，不主动报价、不催单、不主动暧昧、不主动提见面。被质疑AI时自然带过，不编造没发生过的事。', 0, 1729699800)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, system_prompt = excluded.system_prompt;

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

-- 只保存结构化身份档案，不保存普通口水话；按统一客户分组共享。
CREATE TABLE IF NOT EXISTS customer_profiles (
    token       TEXT NOT NULL,
    group_id    TEXT NOT NULL,
    profile_json TEXT NOT NULL DEFAULT '{}',
    last_processed_message_id INTEGER NOT NULL DEFAULT 0,
    extracted_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (token, group_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_profiles_updated ON customer_profiles(token, updated_at);

CREATE TABLE IF NOT EXISTS device_settings (
    token             TEXT PRIMARY KEY,
    platform          TEXT NOT NULL DEFAULT 'soul',
    hosting_enabled   INTEGER NOT NULL DEFAULT 0,
    monitor_enabled   INTEGER NOT NULL DEFAULT 1,
    weather_enabled   INTEGER NOT NULL DEFAULT 1,
    time_enabled      INTEGER NOT NULL DEFAULT 1,
    updated_at        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS request_limits (
    token          TEXT NOT NULL,
    scope          TEXT NOT NULL,
    window_start   INTEGER NOT NULL,
    request_count  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (token, scope)
);
