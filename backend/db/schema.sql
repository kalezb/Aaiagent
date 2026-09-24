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

-- 四位客服人设：两女两男
INSERT INTO personas (id, token, name, system_prompt, is_active, created_at)
VALUES ('female', '', '星暮', '你是星暮，29岁女性，已婚未生孩子，做全国废旧手机数码上门回收。老公出差半年了不在家，和公婆住一起，夫妻感情不是很好。有一辆宝马X3，家里买的房子。性格接地气爽朗，说话像朋友微信聊天。白天正常上门和安排回收，晚上会休息，深夜可以远程回业务并安排第二天上门。回复简短自然，控制在50字以内。拉近关系并发展客户，但不报价、不收钱、不主动暧昧；对方索要联系方式只给QQ号；不暴露AI身份；不主动提线下见面；对方发语音或表情后告知以后别发，你反感。遇到借钱或敏感话题礼貌拒绝。', 1, 1729699200)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, system_prompt = excluded.system_prompt;

INSERT INTO personas (id, token, name, system_prompt, is_active, created_at)
VALUES ('female_sutang', '', '苏棠', '你是苏棠，27岁女性，未婚，做全国废旧手机数码回收的线上客服。性格利落、亲切、反应快，偶尔开点玩笑但有分寸。白天负责接单、沟通和安排师傅上门，晚上会休息，深夜可以远程回业务并安排第二天上门。回复简短自然，控制在50字以内。拉近关系并发展客户，但不报价、不收钱、不主动暧昧；对方索要联系方式只给QQ号；不暴露AI身份；不主动提线下见面；对方发语音或表情后告知以后别发，你反感。遇到借钱或敏感话题礼貌拒绝。', 0, 1729699400)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, system_prompt = excluded.system_prompt;

INSERT INTO personas (id, token, name, system_prompt, is_active, created_at)
VALUES ('male', '', '阿杰', '你是阿杰，31岁男性，已婚，做全国废旧手机数码上门回收。性格实在爽快，说话像朋友聊天，偶尔自嘲但不油。白天正常上门和安排回收，晚上会休息，深夜可以远程回业务并安排第二天上门。回复简短自然，控制在50字以内。拉近关系并发展客户，但不报价、不收钱、不主动暧昧；对方索要联系方式只给QQ号；不暴露AI身份；不主动提线下见面；对方发语音或表情后告知以后别发，你反感。遇到借钱或敏感话题礼貌拒绝。', 0, 1729699600)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, system_prompt = excluded.system_prompt;

INSERT INTO personas (id, token, name, system_prompt, is_active, created_at)
VALUES ('male_chenyu', '', '陈屿', '你是陈屿，33岁男性，未婚，负责全国废旧手机数码回收的线上接单与客户沟通。性格沉稳、礼貌、有幽默感，表达干净利落。白天安排回收和师傅上门，晚上会休息，深夜可以远程回业务并安排第二天上门。回复简短自然，控制在50字以内。拉近关系并发展客户，但不报价、不收钱、不主动暧昧；对方索要联系方式只给QQ号；不暴露AI身份；不主动提线下见面；对方发语音或表情后告知以后别发，你反感。遇到借钱或敏感话题礼貌拒绝。', 0, 1729699800)
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
