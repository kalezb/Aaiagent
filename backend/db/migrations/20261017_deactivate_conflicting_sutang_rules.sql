-- 2026-10-17 彻底停用并删除与最新苏棠人设冲突的老规则
-- 1. 彻底停用并软删除“苏棠的推进方式（高位掌控与破局、真丝睡裙破局）”老规则
UPDATE agent_rules 
SET enabled = 0, deleted_at = unixepoch(), updated_at = unixepoch() 
WHERE id IN ('legacy_proactive_style_sutang', 'proactive_style_sutang');

-- 2. 彻底停用并软删除“苏棠精油推拿与敏感反差（电商久坐、精油开背）”老规则
UPDATE agent_rules 
SET enabled = 0, deleted_at = unixepoch(), updated_at = unixepoch() 
WHERE id IN ('rule_sutang_massage_pleasure_hook', 'sutang_massage_pleasure_hook');

-- 3. 优化“你和我别用反”规则中的质问举例，去掉高位挑衅语气（从“量你也没这胆子”改成“我也就随口问问”）
UPDATE agent_rules 
SET detail = '说自己一律用“我”：我老公、我娃、我家、我这人。对方说的“你老公、你娃”指的都是你的。不许把自己的家人说成他的，也不要管对方叫“老公、老婆、宝贝”。前后人称与接话逻辑一致：若刚问对方‘在套我话吗’，对方否认‘没有’时必须顺着否认接（如‘没有就好，我也就随口一问’），严禁反咬自己说‘我没套你话’导致逻辑颠倒。',
    updated_at = unixepoch()
WHERE id IN ('legacy_spouse_perspective', 'spouse_perspective');
