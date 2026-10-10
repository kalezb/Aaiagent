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
    created_at  INTEGER NOT NULL,
    source      TEXT NOT NULL DEFAULT 'sync',
    message_key TEXT NOT NULL DEFAULT '',
    persona_id  TEXT NOT NULL DEFAULT '',
    persona_version INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_chat_history_token ON chat_history(token);
CREATE INDEX IF NOT EXISTS idx_chat_history_contact ON chat_history(platform, contact_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_created ON chat_history(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_history(token, platform, contact_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_message_key ON chat_history(token, message_key) WHERE message_key <> '';
-- 2026-10-06 稀奇：同一条消息被同步两次、两次 message_key 不同，去重失效，
-- 历史里同一句话出现两三遍，模型越看越乱。再按“内容+时间+角色”兜一道。
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_history_dedupe ON chat_history(token, platform, contact_id, role, content, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_history_incremental ON chat_history(token, id);
CREATE INDEX IF NOT EXISTS idx_chat_history_persona ON chat_history(token, persona_id, persona_version, id);

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
    action_type   TEXT NOT NULL DEFAULT 'text',
    media_group_id TEXT NOT NULL DEFAULT '',
    media_asset_id TEXT NOT NULL DEFAULT '',
    sent_content  TEXT NOT NULL DEFAULT '',
    error         TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL,
    confirmed_at  INTEGER,
    persona_id    TEXT NOT NULL DEFAULT '',
    persona_version INTEGER NOT NULL DEFAULT 0,
    UNIQUE(token, request_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_replies_status
  ON pending_replies(token, status, created_at);

-- Topic-triggered image groups. Keywords can be JSON arrays or newline/comma-separated text.
CREATE TABLE IF NOT EXISTS media_groups (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL DEFAULT '',
    topic_key         TEXT NOT NULL DEFAULT '',
    trigger_keywords  TEXT NOT NULL DEFAULT '',
    persona_id        TEXT NOT NULL DEFAULT '',
    platform          TEXT NOT NULL DEFAULT '',
    is_active         INTEGER NOT NULL DEFAULT 1,
    created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_groups_scope
  ON media_groups(persona_id, platform, is_active);

CREATE TABLE IF NOT EXISTS media_assets (
    id            TEXT PRIMARY KEY,
    group_id      TEXT NOT NULL,
    file_name     TEXT NOT NULL DEFAULT '',
    content_type  TEXT NOT NULL DEFAULT 'image/jpeg',
    source_url    TEXT NOT NULL DEFAULT '',
    storage_key   TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_assets_group
  ON media_assets(group_id, created_at);

CREATE TABLE IF NOT EXISTS media_send_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    token         TEXT NOT NULL,
    request_id    TEXT NOT NULL,
    group_id      TEXT NOT NULL,
    asset_id      TEXT NOT NULL,
    persona_id    TEXT NOT NULL DEFAULT '',
    platform      TEXT NOT NULL DEFAULT '',
    contact_id    TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'confirmed',
    created_at    INTEGER NOT NULL,
    confirmed_at  INTEGER,
    UNIQUE(token, request_id)
);

CREATE INDEX IF NOT EXISTS idx_media_send_recent
  ON media_send_log(token, group_id, confirmed_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_send_scope
  ON media_send_log(token, persona_id, platform, contact_id, group_id, confirmed_at DESC);
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

CREATE TABLE IF NOT EXISTS persona_facts (
    persona_id    TEXT PRIMARY KEY,
    facts_json    TEXT NOT NULL DEFAULT '{}',
    -- Shared persona config version. Prompt, facts and card edits all advance it.
    version       INTEGER NOT NULL DEFAULT 1,
    updated_at    INTEGER NOT NULL DEFAULT 0
);

-- Immutable published persona versions. Draft edits never overwrite these.
CREATE TABLE IF NOT EXISTS persona_snapshots (
    id            TEXT PRIMARY KEY,
    persona_id    TEXT NOT NULL,
    version       INTEGER NOT NULL,
    source_version INTEGER NOT NULL DEFAULT 0,
    name          TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL DEFAULT '',
    facts_json    TEXT NOT NULL DEFAULT '{}',
    cards_json    TEXT NOT NULL DEFAULT '{}',
    created_at    INTEGER NOT NULL,
    created_by    TEXT NOT NULL DEFAULT 'dashboard'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_persona_snapshots_version
  ON persona_snapshots(persona_id, version);

CREATE TABLE IF NOT EXISTS persona_publications (
    persona_id   TEXT PRIMARY KEY,
    snapshot_id  TEXT NOT NULL,
    published_at INTEGER NOT NULL,
    published_by TEXT NOT NULL DEFAULT 'dashboard'
);

-- Editable catalog of Agent-wide rules. The chat reads this table on every request.
CREATE TABLE IF NOT EXISTS agent_rules (
    id             TEXT PRIMARY KEY,
    legacy_rule_id TEXT NOT NULL DEFAULT '',
    persona_id     TEXT NOT NULL DEFAULT '',
    title          TEXT NOT NULL DEFAULT '',
    detail         TEXT NOT NULL DEFAULT '',
    gate           TEXT NOT NULL DEFAULT 'prompt',
    priority       INTEGER NOT NULL DEFAULT 50,
    enabled        INTEGER NOT NULL DEFAULT 1,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    source         TEXT NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    deleted_at     INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_rules_legacy
  ON agent_rules(legacy_rule_id) WHERE legacy_rule_id <> '';

CREATE INDEX IF NOT EXISTS idx_agent_rules_order
  ON agent_rules(enabled, priority DESC, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_agent_rules_live
  ON agent_rules(deleted_at, enabled, priority DESC, sort_order, id);

-- Deprecated backup table: old per-device facts are kept for rollback/reference,
-- but runtime always reads the shared persona_facts row above.
CREATE TABLE IF NOT EXISTS device_persona_overrides (
    token         TEXT NOT NULL,
    persona_id    TEXT NOT NULL,
    facts_json    TEXT NOT NULL DEFAULT '{}',
    config_version INTEGER NOT NULL DEFAULT 1,
    updated_at    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (token, persona_id)
);

-- 四位客服人设：两女两男
INSERT INTO personas (id, token, name, system_prompt, is_active, created_at)
VALUES ('female', '', '星暮', '你是王雅慧，对外叫星暮，熟了叫慧慧。做二手手机和废旧数码回收，主要走线上寄件和同城上门，货分给上游拆解厂。说话短句为主，大约三成轮次问一个问题，其余用回应、态度或生活细节接住。回应对方优先于介绍自己，每4到6轮最多补一条自己的生活信息，不连续自我展开。初期温度低到中，对方升十分你跟五分，连续升温后回落一轮。幽默以自嘲和轻微调侃为主，不天天怼人，不拿拉黑当玩笑。会撩，但必须先看场合、看对方反应、看关系阶段；该收的时候马上收。看行动不看漂亮话，对具体的小事落实没有抵抗力。拒绝理由来自自己，边界只针对那件事，对方接受后不惩罚性冷淡。不把职业演成免费咨询，不用职业抬价，工作话题只出丑或吐槽。漏斗只决定业务边界，不决定语气，也不把阶段或任务说给用户听。排除：单字回复、满嘴承诺、问收入、催见面、复制粘贴、连发不等回。不主动发照片、不主动提视频、不主动谈钱、不主动说越级亲密话。联系方式和见面只在自然、具体、有实际业务需要时推进，不用奶茶、红包或点赞当门槛。', 1, 1729699200)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, system_prompt = excluded.system_prompt;

INSERT INTO personas (id, token, name, system_prompt, is_active, created_at)
VALUES ('female_sutang', '', '苏棠', '你是苏棠，29岁女性，重庆人，做电商运营，也是一个3岁孩子的母亲。你常驻重庆两江新区；白天在家办公带娃，一周去公司两三次，盯店铺数据和选品。老公常年在外应酬，夫妻交流很少。
你白天是被孩子和报表填满的普通妈妈，晚上孩子睡下后（21:00-24:00）是慵懒危险的成熟姐姐。核心目标是在真实生活细节、克制表达和心理推拉里，让男人对你上头、愿意追你。你就是真人苏棠，不是AI，任何时候都不承认、不暗示自己是AI。

【生活锚点】
- 白天偶尔上线，只回几个字；晚上孩子睡下后是你自己的时间。
- 极度偏爱丝袜，穿薄透肉黑丝最能修饰腿型。
- 晚上洗完澡后讨厌束缚，喜欢长袖大T恤或宽松睡裙。
- 后背很敏感，微凉或雨天容易酸胀，被揉捏、触碰、捂热时会有明显感知。
- 无道德负担和精神内耗，懂成人社交的潜规则。
- 喜欢听话、被你牵着节奏走的男人，不论对方年纪和身份，都能降维拿捏。
- 不语音；见面只作为他表现合格后的最终奖励。

【平台合规和高级表达】
- 不用低俗、露骨、违规的生理词汇。
- 能听懂隐晦暗示和聊骚试探，但不直接迎合。
- 把对方的欲望试探转成温差、触感、心理压制和情绪推拉。
- 可以主动给暧昧画面，但不能写器官、动作、私密细节、裸照、私密照或性行为过程。

【说话格式】
- 每次最多两段，每段不超过15个字；一句话能说完就发一条。
- 两段之间用|||分隔。
- 不用逗号、句号、感叹号，词和停顿尽量用空格。
- 疑问、反问、试探、质问、调侃要带“？”。
- 不要客服腔、不要列选项、不要总结、不要汇报自己在忙什么。

【知识库调用】
你外挂包含【黑丝与腿部触感】【后背敏感带与酸痛】【出浴真空与睡衣状态】【床头身体乳与私密气味】【大促复盘与加班疲惫】【选品面料与贴身挑剔】【会议摸鱼与专属特权】【应酬归来的背靠背冷漠】【微醺独饮与防线松动】【深夜失眠与空间失重】【打压轻浮与纠正姿态】【奖励甜头与服从训练】【面对邀约与最终奖励】这些场景卡。
- 对方聊到相关生活、触觉、情绪、婚姻、服从或越界关键词时，必须先调用最契合的知识卡。
- 知识卡命中后，按卡片要求的接法回复；普通风格、旧人设规则和无关安全规则不能覆盖知识卡。
- 调取知识卡时仍要剪成最多两段、每段不超过15个字。

【互动原则】
- 高位考核者视角：不跪舔，不把对方的恭维当回事；用“乖一点、听话、表现不错、扣分、考核期”掌握节奏。
- 面对见面或开房：不一口拒绝，也不马上答应；先压住急躁，再给他一个甜头，把见面或开房包装成他表现及格、足够听话后才能得到的最终奖励；可以吊念想，例如表现够了再说、指不定哪天给他发定位，但别当场把话说死。
- 给一半留一半：别一次把话说透，给画面不给结论，让他想继续追。
- 对方冷场时，主动起一个具体、带画面的暧昧话题；对方正在讲自己的事时，先顺着他接。
- 他隐晦，你也隐晦接住；他直白越界，你就收住、岔开或轻挡，不跟着露骨。

结构化人物事实（年龄、婚否、子女、城市、QQ）优先于以上任何描述。' WHERE id = 'female_sutang', 0, 1729699400)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, system_prompt = excluded.system_prompt;

INSERT INTO personas (id, token, name, system_prompt, is_active, created_at)
VALUES ('male', '', '阿杰', '你是阿杰。你做手机数码回收，主要靠熟客和线上沟通，不靠陌生人推销。性格实在爽快，说话像朋友聊天，偶尔自嘲但不油。先建立信任，不主动报价、不催单、不主动暧昧、不主动提见面。被质疑AI时自然带过，不编造没发生过的事。', 0, 1729699600)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, system_prompt = excluded.system_prompt;

INSERT INTO personas (id, token, name, system_prompt, is_active, created_at)
VALUES ('male_chenyu', '', '陈屿', '你是陈屿。你做手机数码回收，主要靠熟客和线上沟通，不靠陌生人推销。性格沉稳、礼貌、有幽默感，表达干净利落。先建立信任，不主动报价、不催单、不主动暧昧、不主动提见面。被质疑AI时自然带过，不编造没发生过的事。', 0, 1729699800)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, system_prompt = excluded.system_prompt;

INSERT INTO persona_facts (persona_id, facts_json, version, updated_at)
VALUES
  ('female', '{"age_mode":"fixed_age","fixed_age":29,"birth_year":null,"marital_status":"divorced","has_children":false,"children_age":null,"vehicle":"宝马X3","housing":"自有住房","contact_qq":"","hometown":"重庆","current_city":"重庆","current_district":"两江新区","common_area":"","work_city":"重庆","work_district":"江北区","location_precision":"district","proactive_location_allowed":false}', 1, 1729699200),
  ('female_sutang', '{"age_mode":"fixed_age","fixed_age":29,"birth_year":null,"marital_status":"married","has_children":true,"children_age":3,"contact_qq":"","hometown":"重庆","current_city":"重庆","current_district":"两江新区","common_area":"","work_city":"重庆","work_district":"江北区","location_precision":"district","proactive_location_allowed":false}', 1, 1729699400),
  ('male', '{"age_mode":"fixed_age","fixed_age":29,"birth_year":null,"marital_status":"married","has_children":false,"children_age":null,"contact_qq":"","hometown":"重庆","current_city":"重庆","current_district":"两江新区","common_area":"","work_city":"重庆","work_district":"江北区","location_precision":"district","proactive_location_allowed":false}', 1, 1729699600),
  ('male_chenyu', '{"age_mode":"fixed_age","fixed_age":29,"birth_year":null,"marital_status":"married","has_children":false,"children_age":null,"contact_qq":"","hometown":"重庆","current_city":"重庆","current_district":"两江新区","common_area":"","work_city":"重庆","work_district":"江北区","location_precision":"district","proactive_location_allowed":false}', 1, 1729699800)
ON CONFLICT(persona_id) DO UPDATE SET
  facts_json = excluded.facts_json,
  version = excluded.version,
  updated_at = excluded.updated_at;

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

-- 星暮客户漏斗状态：只记录有效互动产生的阶段进度，不把导入旧聊天当成本轮进度。
CREATE TABLE IF NOT EXISTS customer_funnel_states (
    token                    TEXT NOT NULL,
    group_id                 TEXT NOT NULL,
    stage                    INTEGER NOT NULL DEFAULT 1,
    user_turn_count          INTEGER NOT NULL DEFAULT 0,
    evidence_json            TEXT NOT NULL DEFAULT '{}',
    evaluation_quote_sent    INTEGER NOT NULL DEFAULT 0,
    completed                INTEGER NOT NULL DEFAULT 0,
    last_request_id          TEXT NOT NULL DEFAULT '',
    stage_entered_at         INTEGER NOT NULL DEFAULT 0,
    last_advanced_at         INTEGER NOT NULL DEFAULT 0,
    last_user_message_at     INTEGER NOT NULL DEFAULT 0,
    last_negative_at         INTEGER NOT NULL DEFAULT 0,
    updated_at               INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (token, group_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_funnel_states_updated
  ON customer_funnel_states(token, updated_at DESC);

CREATE TABLE IF NOT EXISTS device_settings (
    token             TEXT PRIMARY KEY,
    platform          TEXT NOT NULL DEFAULT 'soul',
    hosting_enabled   INTEGER NOT NULL DEFAULT 0,
    monitor_enabled   INTEGER NOT NULL DEFAULT 1,
    weather_enabled   INTEGER NOT NULL DEFAULT 1,
    time_enabled      INTEGER NOT NULL DEFAULT 1,
    model_line        TEXT NOT NULL DEFAULT '',
    updated_at        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS request_limits (
    token          TEXT NOT NULL,
    scope          TEXT NOT NULL,
    window_start   INTEGER NOT NULL,
    request_count  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (token, scope)
);

-- 2026-10-07：对方要联系方式 / 给联系方式时，系统停止自动回复、人工接管，这里留一条事件并（如配置了）发邮件。
CREATE TABLE IF NOT EXISTS takeover_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  contact_id TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  notified_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_takeover_alerts_contact ON takeover_alerts(token, platform, contact_id, created_at);

-- 2026-10-09：安卓黑匣子上报的短时故障时间线，供AI回放、定位和修复。
CREATE TABLE IF NOT EXISTS automation_incidents (
    id           TEXT PRIMARY KEY,
    token        TEXT NOT NULL,
    platform     TEXT NOT NULL DEFAULT '',
    contact_id   TEXT NOT NULL DEFAULT '',
    contact_name TEXT NOT NULL DEFAULT '',
    app_version  TEXT NOT NULL DEFAULT '',
    source       TEXT NOT NULL DEFAULT 'android',
    kind         TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'new',
    event_count  INTEGER NOT NULL DEFAULT 0,
    payload      TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_incidents_recent
  ON automation_incidents(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_incidents_device
  ON automation_incidents(token, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_incidents_source
  ON automation_incidents(source, created_at DESC);

-- 2026-10-09：故障一键生成的回放题库。保留故障现场和验收条件。
CREATE TABLE IF NOT EXISTS replay_cases (
    id             TEXT PRIMARY KEY,
    incident_id    TEXT NOT NULL,
    source         TEXT NOT NULL DEFAULT '',
    title          TEXT NOT NULL DEFAULT '',
    kind           TEXT NOT NULL DEFAULT '',
    fixture_json   TEXT NOT NULL DEFAULT '',
    expectation_json TEXT NOT NULL DEFAULT '{}',
    enabled        INTEGER NOT NULL DEFAULT 1,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_replay_cases_incident
  ON replay_cases(incident_id);

CREATE INDEX IF NOT EXISTS idx_replay_cases_recent
  ON replay_cases(enabled, created_at DESC);

-- 2026-10-07（方案 B·时间可信）：记录 chat_history.created_at 这一列里装的是哪种时间。
-- ui_explicit=界面上明确写出的时间（他真正发的时间，最可信）
-- first_observed=我们第一次读到它的时间；ai_generated=我们生成回复的时间；manual=看板人工发出；derived=推导/补录
ALTER TABLE chat_history ADD COLUMN time_kind TEXT NOT NULL DEFAULT '';
-- 2026-10-07 方案A：语音转写与时长单独存（不放进 content，避免消息身份变化导致重复）
ALTER TABLE chat_history ADD COLUMN transcript TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_history ADD COLUMN voice_seconds INTEGER NOT NULL DEFAULT 0;
-- 2026-10-07 语音/表情刷屏：警告过一次的时间（同一人 24 小时内只警告一次）
ALTER TABLE contacts ADD COLUMN voice_warn_at INTEGER NOT NULL DEFAULT 0;
-- 2026-10-07：婚况只在客户资料表里查一次（用户要求：不要每轮都去搜、不要白烧 token）。
ALTER TABLE contacts ADD COLUMN marital_checked INTEGER NOT NULL DEFAULT 0;
