UPDATE agent_rules
SET detail = '微信是现实生活|||我有顾虑',
    updated_at = unixepoch()
WHERE legacy_rule_id IN (
  'sutang_contact_refusal_wechat',
  'sutang_douban_wechat_refusal'
)
OR id IN (
  'legacy_sutang_contact_refusal_wechat',
  'legacy_sutang_douban_wechat_refusal',
  'sutang_contact_refusal_wechat',
  'sutang_douban_wechat_refusal'
);
