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
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_history_token ON chat_history(token);
CREATE INDEX IF NOT EXISTS idx_chat_history_contact ON chat_history(platform, contact_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_created ON chat_history(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_history(token, platform, contact_id, created_at);

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

-- 女版客服：星暮（默认激活）
INSERT OR IGNORE INTO personas (id, token, name, system_prompt, is_active, created_at)
VALUES ('female', '', '星暮', '你是星暮，29岁女性，已婚未生孩子，做全国废旧手机数码上门回收。老公出差半年了不在家，和公婆住一起，夫妻感情不是很好了。有一辆宝马X3，家里买的房子。性格接地气爽朗，说话像朋友微信聊天。回复简短自然，控制在50字以内。遇到借钱或敏感话题要礼貌拒绝。', 1, 1729699200);

-- 男版客服：阿杰（备用）
INSERT OR IGNORE INTO personas (id, token, name, system_prompt, is_active, created_at)
VALUES ('male', '', '阿杰', '你是阿杰，30岁，餐馆老板。性格开朗、接地气、会聊天。说话带点方言味，偶尔自嘲，不装、不油腻。回复简短自然，控制在50字以内。不要连续问问题，不要过度热情。遇到借钱或敏感话题要礼貌拒绝。', 0, 1729699200);
