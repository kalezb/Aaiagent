import {
  ADDITIONAL_EDITABLE_RULES,
  LEGACY_RULE_CLASSIFICATION,
  RAW_LEGACY_AGENT_RULES,
  type LegacyAgentRule,
} from "./_agent_rule_inventory_data";

export type {
  LegacyAgentRule,
} from "./_agent_rule_inventory_data";

// 2026-11-07：苏棠改为“已婚未育、跟婆婆住、只聊线上”。
// 下面这些旧规则不再写进新库，也会从看板清单里隐藏：
// 孩子/酒店/见面/豆瓣/代付相关、重复的真人感规则、其他人设的规则、旧版停用规则。
export const RETIRED_AGENT_RULE_IDS = new Set([
  "no_sales_pressure",
  "sutang_night_meeting_boundary",
  "douban_relationship_premise",
  "sutang_douban_wechat_refusal",
  "sutang_contact_refusal_wechat",
  "active_flirting",
  "proactive_style_sutang",
  "sutang_meeting_reward_rule",
  "sutang_massage_pleasure_hook",
  "contact_takeover",
  "human_feel_rule",
  "advancement_rule",
  "human_rhythm",
  "proactive_topic_rule",
  "communication_style",
  "no_sleep_topic",
  "business_contact_boundary",
  "xingmu_identity",
  "business_scope",
  "xingmu_fact_boundary",
  "relationship_premise",
  "funnel_tone_separation",
  "generic_fact_boundary",
  "xingmu_dialogue_advancement",
  "proactive_style_xingmu",
  "proactive_style_generic",
  "topic_boundary",
  "new_contact_pacing_xingmu",
]);

export const LEGACY_AGENT_RULES: LegacyAgentRule[] = RAW_LEGACY_AGENT_RULES
  .filter((rule) => !RETIRED_AGENT_RULE_IDS.has(rule.id))
  .map((rule, index) => {
    const classification = LEGACY_RULE_CLASSIFICATION[rule.id];
    if (!classification) throw new Error(`Missing rule classification: ${rule.id}`);
    return {
      ...rule,
      ...classification,
      enabled: classification.enabled ?? true,
      sort_order: index + 1,
    };
  });

export const DEFAULT_AGENT_RULES: LegacyAgentRule[] = [
  ...LEGACY_AGENT_RULES,
  ...ADDITIONAL_EDITABLE_RULES.filter((rule) => !RETIRED_AGENT_RULE_IDS.has(rule.id)).map((rule, index) => ({
    id: rule.id,
    category: "可编辑规则",
    title: rule.title,
    scope: "按作用范围",
    detail: rule.detail,
    source: rule.source || "buildLayeredSystemPrompt",
    recommendation: "keep_default" as const,
    gate: rule.gate || "prompt",
    priority: rule.priority || 60,
    enabled: rule.enabled ?? true,
    persona_id: rule.persona_id || "",
    sort_order: LEGACY_AGENT_RULES.length + index + 1,
  })),
];
