-- 2026-10-12 用户要求：删除“要联系方式或给联系方式时人工接管并发邮件”这套行为。
-- 微信、QQ、电话由聊天里的人设自己回绝，聊天继续；不再停自动回复，也不再发提醒邮件。

UPDATE agent_rules
SET enabled = 0,
    deleted_at = CAST(strftime('%s','now') AS INTEGER),
    updated_at = CAST(strftime('%s','now') AS INTEGER)
WHERE legacy_rule_id = 'contact_takeover';
