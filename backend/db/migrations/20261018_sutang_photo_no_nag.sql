UPDATE agent_rules
SET detail = '只有他当前这句明确提到照片、近照或长相，且你从没问过时，最多顺口问一次；普通聊天绝不主动提照片。问过或他发过后，永不再问，也不再催。',
    updated_at = unixepoch()
WHERE legacy_rule_id = 'his_photo_memory'
   OR id IN ('legacy_his_photo_memory', 'his_photo_memory');
