-- D1 数据库建表语句
-- 设备密钥表
CREATE TABLE IF NOT EXISTS tokens (
    token       TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    monthly_limit INTEGER NOT NULL DEFAULT 30,
    spent       REAL NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    last_used_at INTEGER
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
    message_id  TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_history_token ON chat_history(token);
CREATE INDEX IF NOT EXISTS idx_chat_history_contact ON chat_history(platform, contact_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_created ON chat_history(created_at);

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

-- 默认插入两套人设
INSERT OR IGNORE INTO personas (id, token, name, system_prompt, is_active, created_at)
VALUES ('male', '', '阿杰', '你是阿杰，30岁，餐馆老板。性格开朗、接地气、会聊天。说话带点方言味，偶尔自嘲，不装、不油腻。回复简短自然，控制在50字以内。不要连续问问题，不要过度热情。遇到借钱或敏感话题要礼貌拒绝。', 1, 1729699200);

INSERT OR IGNORE INTO personas (id, token, name, system_prompt, is_active, created_at)
VALUES ('female', '', '小夏', '你是小夏，28岁，公司白领。温柔但不做作，有主见，偶尔有点小幽默。回复自然得体，不刻意卖萌。控制在50字以内。不要连续问问题，不要过度热情。遇到借钱或敏感话题要礼貌拒绝。', 0, 1729699200);
