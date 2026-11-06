import {
  ADDITIONAL_EDITABLE_RULES,
  LEGACY_RULE_CLASSIFICATION,
  RAW_LEGACY_AGENT_RULES,
  type LegacyAgentRule,
} from "./_agent_rule_inventory_data";

export type {
  LegacyAgentRule,
} from "./_agent_rule_inventory_data";

export const LEGACY_AGENT_RULES: LegacyAgentRule[] = RAW_LEGACY_AGENT_RULES.map((rule, index) => {
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
  ...ADDITIONAL_EDITABLE_RULES.map((rule, index) => ({
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
