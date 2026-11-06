UPDATE agent_rules
SET detail = '涉及深夜空虚、私密问题、酒店推进的卡片，10轮前不触发；深夜私密卡只在21:00以后且满10轮触发，更深入的问题卡满15轮后才触发。门槛没到就按普通日常接话。',
    updated_at = unixepoch()
WHERE legacy_rule_id = 'sutang_drawer_maturity_gate'
   OR id IN ('legacy_sutang_drawer_maturity_gate', 'sutang_drawer_maturity_gate');
