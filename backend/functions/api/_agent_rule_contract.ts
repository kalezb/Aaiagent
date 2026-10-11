export interface ActiveAgentRule {
  id: string;
  legacy_rule_id: string;
  persona_id: string;
  title: string;
  detail: string;
  gate: string;
  priority: number;
  enabled: boolean;
  sort_order: number;
  source: string;
}

export interface AgentRuleState {
  loaded: boolean;
  rules: ActiveAgentRule[];
  isEnabled: (legacyRuleId: string, fallback?: boolean) => boolean;
  textFor: (legacyRuleId: string, fallback?: string) => string;
  priorityFor: (legacyRuleId: string, fallback?: number) => number;
}

export const EMPTY_AGENT_RULE_STATE: AgentRuleState = {
  loaded: false,
  rules: [],
  isEnabled: (_legacyRuleId, fallback = true) => fallback,
  textFor: (_legacyRuleId, fallback = "") => fallback,
  priorityFor: (_legacyRuleId, fallback = 50) => fallback,
};

const EXPLICIT_AGENT_RULE_IDS = new Set([
  "late_reply_current_only",
  "proactive_topic_rule",
  "human_feel_rule",
  "advancement_rule",
  "proactive_style_xingmu",
  "proactive_style_sutang",
  "proactive_style_generic",
  "sutang_action_ladder",
  "knowledge_match_priority",
  "output_shape_hard",
  "question_pacing",
  "sutang_meeting_reward_rule",
  "intimate_label_consistency",
  "exit_marker",
  "no_sleep_topic",
  "quote_reply",
  "third_party_ownership",
  "platform_not_user",
  "no_repeat",
  "spouse_perspective",
  "no_fake_quote",
  "no_customer_service",
  "casual_punctuation",
  "self_leave_marker",
  "communication_style",
  "no_ai_debate",
  "xingmu_dialogue_advancement",
  "funnel_tone_separation",
  "xingmu_fact_boundary",
  "generic_fact_boundary",
  "sutang_fact_boundary",
  "cross_platform_memory",
  "topic_boundary",
  "answer_old_message",
  "relationship_premise",
  "new_contact_pacing",
  "new_contact_pacing_xingmu",
  "history_consistency",
  "facts_override_persona",
  "location_scope",
  "xingmu_identity",
  "fixed_age",
  "his_photo_memory",
  "her_photo_memory",
]);

const SYSTEM_ACTION_RULE_IDS = new Set([
  "married_excluded",
  "no_contact_leak",
  "business_contact_boundary",
  "media_group_selection",
  "voice_call_boundary",
  "his_photo_memory",
  "her_photo_memory",
  "photo_only_explicit",
  "no_video",
  "drawer_budget",
  "fixed_age",
  "children_facts",
  "platform_not_user",
  "sticker_not_real",
  "time_source",
  "voice_transcript_memory",
  "duplicate_history",
  "summary_budget",
  "old_persona_filter",
]);

export function describeAgentRuleEdit(rule: ActiveAgentRule) {
  const legacyRuleId = String(rule?.legacy_rule_id || "").trim();
  if (SYSTEM_ACTION_RULE_IDS.has(legacyRuleId)) {
    return {
      edit_mode: "system_action",
      edit_mode_label: "系统硬动作",
      edit_mode_help: "这条决定跳不跳过、发不发、转不转人工。文字会同时提醒模型，硬动作由系统执行。",
    };
  }
  if (rule?.gate === "prompt") {
    return {
      edit_mode: "text",
      edit_mode_label: "可直接改文字",
      edit_mode_help: "你写什么，下一条聊天就按新文字交给大模型。",
    };
  }
  return {
    edit_mode: "mixed",
    edit_mode_label: "文字和系统一起管",
    edit_mode_help: "文字会进入对应阶段，范围、排序和开关也会生效；原来的硬动作继续由系统执行。",
  };
}

function normalizedRuleList(rules: ActiveAgentRule[]) {
  return (Array.isArray(rules) ? rules : []).filter((rule) => Boolean(rule && rule.id));
}

function sortedRules(rules: ActiveAgentRule[]) {
  return [...rules].sort((left, right) =>
    Number(right.priority || 0) - Number(left.priority || 0) ||
    Number(left.sort_order || 0) - Number(right.sort_order || 0)
  );
}

function formatRule(rule: ActiveAgentRule) {
  return `【优先级${Number(rule.priority || 50)}】【${rule.title || "未命名规则"}】${rule.detail || ""}`;
}

export function buildAgentRuleState(
  rules: ActiveAgentRule[],
  personaId = "",
): AgentRuleState {
  const allRules = normalizedRuleList(rules);
  const knownLegacyIds = new Set(
    allRules
      .map((rule) => String(rule.legacy_rule_id || "").trim())
      .filter(Boolean),
  );
  const applicable = allRules.filter((rule) => ruleMatchesPersona(rule, personaId));
  const applicableByLegacyId = new Map(
    applicable
      .filter((rule) => String(rule.legacy_rule_id || "").trim())
      .map((rule) => [String(rule.legacy_rule_id), rule] as const),
  );

  return {
    loaded: true,
    rules: applicable,
    isEnabled: (legacyRuleId, fallback = true) => {
      const id = String(legacyRuleId || "").trim();
      const rule = applicableByLegacyId.get(id);
      if (rule) return rule.enabled !== false;
      return knownLegacyIds.has(id) ? false : fallback;
    },
    textFor: (legacyRuleId, fallback = "") => {
      const id = String(legacyRuleId || "").trim();
      const rule = applicableByLegacyId.get(id);
      if (rule) {
        if (rule.enabled === false) return "";
        return String(rule.detail || "").trim() || fallback;
      }
      return knownLegacyIds.has(id) ? "" : fallback;
    },
    priorityFor: (legacyRuleId, fallback = 50) => {
      const id = String(legacyRuleId || "").trim();
      return applicableByLegacyId.get(id)?.priority ?? fallback;
    },
  };
}

export function ruleMatchesPersona(rule: ActiveAgentRule, personaId = "") {
  const scopedPersonas = String(rule.persona_id || "")
    .split(/[,\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return scopedPersonas.length === 0 || scopedPersonas.includes(String(personaId || ""));
}

export function buildCustomAgentRulesPrompt(state: AgentRuleState, personaId = "") {
  if (!state?.loaded) return "";
  const rules = sortedRules((state.rules || [])
    .filter((rule) =>
      rule.enabled &&
      rule.gate === "prompt" &&
      (
        rule.source === "dashboard" ||
        !EXPLICIT_AGENT_RULE_IDS.has(String(rule.legacy_rule_id || ""))
      ) &&
      ruleMatchesPersona(rule, personaId)
    ));
  return rules.length
    ? "【可编辑规则｜数字越大越优先】\n" +
      rules.map(formatRule).join("\n")
    : "";
}

export function buildAgentRuleStagePrompt(
  state: AgentRuleState,
  personaId = "",
  gate = "",
  heading = "",
) {
  if (!state?.loaded || !gate) return "";
  const rules = sortedRules((state.rules || []).filter((rule) =>
    rule.enabled &&
    rule.gate === gate &&
    !EXPLICIT_AGENT_RULE_IDS.has(String(rule.legacy_rule_id || "")) &&
    ruleMatchesPersona(rule, personaId)
  ));
  if (!rules.length) return "";
  return `${heading || "【规则】"}\n${rules.map(formatRule).join("\n")}`;
}
