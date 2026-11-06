import { RETIRED_AGENT_RULE_IDS } from "./_agent_rule_inventory";

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
  deleted_at?: number;
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
  "active_flirting",
  "proactive_style_generic",
  "sutang_action_ladder",
  "sutang_drawer_maturity_gate",
  "sutang_contact_policy",
  "sutang_no_preachy",
  "sutang_short_bubble",
  "knowledge_match_priority",
  "output_shape_hard",
  "question_pacing",
  "emoji_pragmatic_booster",
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
  "douban_relationship_premise",
  "sutang_contact_refusal_wechat",
  "sutang_explicit_boundary",
  "sutang_night_meeting_boundary",
  "sutang_family_and_voice_boundary",
  "sutang_contrast_mature_hook",
  "sutang_massage_pleasure_hook",
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

function ruleContextText(context: any = {}) {
  const current = Array.isArray(context.currentMessages) ? context.currentMessages : [];
  const history = Array.isArray(context.historyMessages) ? context.historyMessages : [];
  return [
    String(context.incomingText || ""),
    ...current.slice(-8).map((message) => String(message?.content || "")),
    ...history.slice(-4).map((message) => String(message?.content || "")),
  ].join("\n").trim();
}

const DEFAULT_RULE_TRIGGERS: Record<string, RegExp> = {
  facts_override_persona: /(?:你是谁|你叫什么|你多大|你几岁|你哪年|你结婚|你离|你孩子|你在哪|你住哪|你做什么工作)/u,
  facts_no_guess: /(?:你是谁|你叫什么|你多大|你几岁|你哪年|你结婚|你离|你孩子|你在哪|你住哪|你做什么工作)/u,
  fixed_age: /(?:多大|几岁|哪年|年龄)/u,
  children_facts: /(?:孩子|娃|儿子|女儿)/u,
  location_scope: /(?:住哪|哪里人|哪个区|在哪|地址|远不远)/u,
  xingmu_identity: /(?:你是谁|你叫什么|星暮|王雅慧|你多大|你结婚|你离)/u, // persona-guard: ok
  exit_marker: /(?:去睡|睡觉|晚安|去忙|先忙|出门|吃饭|改天|下次聊|不聊了)/u,
  self_leave_marker: /(?:去睡|睡觉|晚安|去忙|先忙|出门|吃饭|改天|下次聊|不聊了)/u,
  emoji_pragmatic_booster: /(?:\[[^\]]+\]|表情|贴纸|互动)/u,
  no_ai_debate: /(?:AI|人工智能|机器人|自动回复)/iu,
  explicit_boundary: /(?:裸照|裸体|做爱|上床|性|开房|情趣|身体|腿照|私密照)/u,
  no_contact_leak: /(?:微信|QQ|Q|电话|手机号|联系方式|加你|加个)/iu,
  business_contact_boundary: /(?:微信|QQ|Q|电话|手机号|联系方式|加你|加个)/iu,
  married_excluded: /(?:结婚|已婚|老婆|媳妇|单身|未婚|离婚|离异)/u,
  photo_only_explicit: /(?:照片|自拍|看看你|长什么样|闪照|图片)/u,
  no_video: /(?:视频|打视频|视频通话)/u,
  photo_authenticity: /(?:网图|盗图|不是你|生成的|AI图)/iu,
  his_photo_memory: /(?:照片|自拍|看看你|长什么样|闪照)/u,
  her_photo_memory: /(?:照片|自拍|看看你|发张|闪照)/u,
  media_group_selection: /(?:照片|自拍|看看你|身材|腿|腰|闪照)/u,
  voice_call_boundary: /(?:语音|打电话|电话聊|通话)/u,
  voice_transcript_memory: /(?:语音|转文字)/u,
  sticker_not_real: /(?:\[[^\]]+\]|表情|贴纸|互动)/u,
  platform_not_user: /(?:平台提示|系统通知|官方消息|已读|正在输入)/u,
  third_party_ownership: /(?:我妈|我爸|我朋友|我弟弟|我同事|我家人|你家|你朋友)/u,
  quote_reply: /(?:你说|你说过|引用|刚才那句)/u,
  business_scope: /(?:旧手机|旧数码|回收|二手|报价|评估|寄件|上门)/u, // persona-guard: ok
  no_sales_pressure: /(?:旧手机|旧数码|回收|二手|报价|评估|寄件|上门)/u, // persona-guard: ok
  sutang_contact_refusal_wechat: /(?:微信|加个|联系方式)/u,
  sutang_explicit_boundary: /(?:裸照|裸体|做爱|上床|性|开房|情趣|身体|腿照|私密照)/u,
  sutang_family_and_voice_boundary: /(?:老公|家庭|语音|打电话)/u,
  sutang_contrast_mature_hook: /(?:另一面|反差|成熟|姐姐)/u,
  new_contact_pacing: /(?:你好|在吗|认识|第一次|刚加)/u,
  new_contact_pacing_xingmu: /(?:你好|在吗|认识|第一次|刚加)/u,
};

export function ruleMatchesTurnContext(rule: ActiveAgentRule, context: any = {}) {
  if (String(rule?.source || "") === "dashboard") return true;
  const text = ruleContextText(context);
  if (!text) return true;
  const pattern = DEFAULT_RULE_TRIGGERS[String(rule?.legacy_rule_id || "")];
  return pattern ? pattern.test(text) : false;
}

export function buildAgentRuleState(
  rules: ActiveAgentRule[],
  personaId = "",
): AgentRuleState {
  const allRules = normalizedRuleList(rules);
  const deletedLegacyIds = new Set(
    allRules
      .filter((rule) => Number(rule.deleted_at || 0) > 0)
      .map((rule) => String(rule.legacy_rule_id || "").trim())
      .filter(Boolean),
  );
  const activeRules = allRules.filter((rule) => Number(rule.deleted_at || 0) === 0);
  const knownLegacyIds = new Set(
    activeRules
      .map((rule) => String(rule.legacy_rule_id || "").trim())
      .filter(Boolean),
  );
  const applicable = activeRules.filter((rule) => ruleMatchesPersona(rule, personaId));
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
      if (RETIRED_AGENT_RULE_IDS.has(id)) return false;
      if (deletedLegacyIds.has(id)) return false;
      const rule = applicableByLegacyId.get(id);
      if (rule) return rule.enabled !== false;
      return knownLegacyIds.has(id) ? false : fallback;
    },
    textFor: (legacyRuleId, fallback = "") => {
      const id = String(legacyRuleId || "").trim();
      if (RETIRED_AGENT_RULE_IDS.has(id)) return "";
      if (deletedLegacyIds.has(id)) return "";
      const rule = applicableByLegacyId.get(id);
      if (rule) {
        if (rule.enabled === false) return "";
        return String(rule.detail || "").trim() || fallback;
      }
      return knownLegacyIds.has(id) ? "" : fallback;
    },
    priorityFor: (legacyRuleId, fallback = 50) => {
      const id = String(legacyRuleId || "").trim();
      if (deletedLegacyIds.has(id)) return fallback;
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

export function buildCustomAgentRulesPrompt(
  state: AgentRuleState,
  personaId = "",
  context: any = {},
) {
  if (!state?.loaded) return "";
  const rules = sortedRules((state.rules || [])
    .filter((rule) =>
      rule.enabled &&
      rule.gate === "prompt" &&
      (
        rule.source === "dashboard" ||
        !EXPLICIT_AGENT_RULE_IDS.has(String(rule.legacy_rule_id || ""))
      ) &&
      ruleMatchesTurnContext(rule, context) &&
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
  context: any = {},
) {
  if (!state?.loaded || !gate) return "";
  const rules = sortedRules((state.rules || []).filter((rule) =>
    rule.enabled &&
    rule.gate === gate &&
    !EXPLICIT_AGENT_RULE_IDS.has(String(rule.legacy_rule_id || "")) &&
    ruleMatchesTurnContext(rule, context) &&
    ruleMatchesPersona(rule, personaId)
  ));
  if (!rules.length) return "";
  return `${heading || "【规则】"}\n${rules.map(formatRule).join("\n")}`;
}
