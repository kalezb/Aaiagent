-- 当前苏棠在家带娃、操持家务，不再保留旧工作地“江北区”。
-- 只改苏棠本人，且只有旧值仍在时才更新，避免重复执行反复加版本号。
UPDATE persona_facts
SET facts_json = REPLACE(facts_json, '"work_district":"江北区"', '"work_district":"两江新区"'),
    version = version + 1,
    updated_at = unixepoch()
WHERE persona_id = 'female_sutang'
  AND facts_json LIKE '%"work_district":"江北区"%';
