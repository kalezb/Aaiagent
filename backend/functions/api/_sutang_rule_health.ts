import { RETIRED_SUTANG_DRAWER_IDS } from "./_persona_drawers_data";

const SUTANG_PERSONA_ID = "female_sutang";

const LEGACY_RULES = [
  { key: "active_flirting", title: "旧版主动发散暧昧规则" },
  { key: "proactive_style_sutang", title: "旧版高位推进方式" },
  { key: "sutang_meeting_reward_rule", title: "旧版见面奖励规则" },
  { key: "sutang_massage_pleasure_hook", title: "旧版身体话题推进规则" },
];

// persona-guard: ok — 这份清单只用于苏棠规则体检，不会进入其他客服的提示词。
const REWRITTEN_RULES = [
  {
    key: "sutang_action_ladder",
    title: "本轮接话原则",
    required: ["先接住", "线上"],
    forbidden: ["高档酒店", "订房", "房型", "代付", "豆瓣", "见面地点"],
  },
  {
    key: "sutang_family_and_voice_boundary",
    title: "家庭与时间处境",
    required: ["没有孩子", "婆婆"],
    forbidden: ["3岁", "女儿", "带娃", "酒店"],
  },
  {
    key: "sutang_contrast_mature_hook",
    title: "昵称与真实自我",
    required: ["想要一点自己的情绪和陪伴"],
    forbidden: ["不主动扯私密"],
  },
  {
    key: "sutang_explicit_boundary",
    title: "暧昧话题分寸",
    required: ["半截话", "软钉子"],
    forbidden: ["只有对方先聊暧昧", "不主动升级", "这个不聊"],
  },
  {
    key: "sutang_fact_boundary",
    title: "事实与边界",
    required: ["不编造", "对方明确问事实先答清"],
    forbidden: ["高档酒店", "订房", "房型", "代付", "豆瓣"],
  },
  {
    key: "sutang_drawer_maturity_gate",
    title: "私密知识卡防早熟锁",
    required: ["10轮前不触发", "21:00以后", "满15轮"],
    forbidden: ["可以提前触发", "刚认识也能触发", "酒店"],
  },
  {
    key: "sutang_contact_policy",
    title: "联系方式边界",
    required: ["微信", "当前资料里的QQ", "时机合适"],
    forbidden: ["按聊天次数决定", "豆瓣", "给其他号"],
  },
  {
    key: "sutang_no_preachy",
    title: "禁止说教",
    required: ["催对方早点睡", "不对男人讲大道理", "作息习惯"],
    forbidden: ["早点睡吧", "明天还要上班"],
  },
  {
    key: "sutang_short_bubble",
    title: "极短气泡",
    required: ["1到3条", "3到10字", "整轮最多25字"],
    forbidden: ["整轮不限字数", "可以写长段"],
  },
  {
    key: "knowledge_match_priority",
    title: "知识库命中优先级",
    required: ["场景提示", "冷硬拒绝"],
    forbidden: ["必须使用命中的知识卡内容"],
  },
];

const OLD_CONFLICT_PATTERNS = [
  "高位审视",
  "高位反问",
  "故意考核",
  "反复考核",
  "同一个诚意最多考一次",
  "第一次只考虑白天",
  "第一次见面只考虑白天",
  "不去私密房间",
  "关系还没到",
  "你这话我可接不住",
  "问两次",
  "要两次联系方式",
  "承担房费",
  "拒绝私密安排",
  "不主动升级",
  "不主动往身体",
];

const CARD_EXPECTATIONS = [
  {
    id: "scene_sutang_probe_spending",
    title: "成熟男士生活与出行了解",
    required: ["还是坐办公室", "周末一般去哪儿"],
    forbidden: ["早点睡吧", "明天还要上班"],
  },
  {
    id: "scene_sutang_night_empty",
    title: "深夜私密与反差空虚",
    required: ["别招我", "屋里太静了"],
    forbidden: ["早点睡吧", "明天还要上班"],
  },
  {
    id: "scene_sutang_intimate_questions",
    title: "借老公常年在外顺嘴打听",
    required: ["你一个人忍得住", "你经常约网友吗"],
    forbidden: ["早点睡吧", "明天还要上班"],
  },
  // persona-guard: ok — 苏棠专属规则体检。
  {
    id: "scene_sutang_invite_refusal",
    title: "被反复邀约的线上婉拒",
    required: ["家里走不开", "婆婆在"],
    forbidden: ["酒店", "开房"],
  },
];

function ruleKey(rule: any) {
  return String(rule?.legacy_rule_id || rule?.id || "").trim();
}

function isDeleted(rule: any) {
  return Number(rule?.deleted_at || 0) > 0;
}

function ruleStatus(rule: any) {
  if (!rule) return "missing";
  if (isDeleted(rule)) return "deleted";
  return rule.enabled === false ? "disabled" : "active";
}

function appliesToSutang(rule: any) {
  const scopes = String(rule?.persona_id || "")
    .split(/[,\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return scopes.length === 0 || scopes.includes(SUTANG_PERSONA_ID);
}

function textOf(item: any) {
  return `${String(item?.title || "")}\n${String(item?.detail || item?.content || "")}`;
}

function matchingTerms(text: string, terms: string[]) {
  return terms.filter((term) => text.includes(term));
}

function findRule(rules: any[], key: string) {
  return rules.find((rule) => ruleKey(rule) === key) || null;
}

export function buildSutangRuleHealth(rules: any[] = [], cards: any[] = []) {
  const allRules = Array.isArray(rules) ? rules : [];
  const applicable = allRules.filter(appliesToSutang);
  const active = applicable.filter((rule) => !isDeleted(rule) && rule.enabled !== false);

  const legacyRules = LEGACY_RULES.map((definition) => {
    const rule = findRule(applicable, definition.key);
    const state = ruleStatus(rule);
    return {
      key: definition.key,
      id: String(rule?.id || ""),
      title: String(rule?.title || definition.title),
      state,
      ok: state === "deleted" || state === "disabled" || state === "missing",
    };
  });

  const rewrittenRules = REWRITTEN_RULES.map((definition) => {
    const rule = findRule(applicable, definition.key);
    const state = ruleStatus(rule);
    const text = textOf(rule);
    const missing = rule ? definition.required.filter((term) => !text.includes(term)) : definition.required;
    const forbiddenHits = rule ? matchingTerms(text, definition.forbidden) : [];
    return {
      key: definition.key,
      id: String(rule?.id || ""),
      title: String(rule?.title || definition.title),
      state,
      ok: state === "active" && missing.length === 0 && forbiddenHits.length === 0,
      missing,
      forbidden_hits: forbiddenHits,
    };
  });

  const cardById = new Map(
    (Array.isArray(cards) ? cards : []).map((card) => [String(card?.id || ""), card]),
  );
  const cardHealth = CARD_EXPECTATIONS.map((definition) => {
    const card = cardById.get(definition.id);
    const state = !card ? "missing" : card.enabled === false || card.deleted === true ? "disabled" : "enabled";
    const text = textOf(card);
    const missing = card ? definition.required.filter((term) => !text.includes(term)) : definition.required;
    const forbiddenHits = card ? matchingTerms(text, definition.forbidden) : [];
    return {
      id: definition.id,
      title: String(card?.name || definition.title),
      state,
      ok: state === "enabled" && missing.length === 0 && forbiddenHits.length === 0,
      missing,
      forbidden_hits: forbiddenHits,
    };
  });
  const presentCardIds = new Set(
    (Array.isArray(cards) ? cards : []).map((card) => String(card?.id || "")),
  );
  const retiredCardsRemoved = RETIRED_SUTANG_DRAWER_IDS.filter((id) => !presentCardIds.has(id)).length;

  const residualConflicts = active
    .map((rule) => {
      const hits = matchingTerms(textOf(rule), OLD_CONFLICT_PATTERNS);
      return hits.length
        ? {
            id: String(rule.id || ""),
            key: ruleKey(rule),
            title: String(rule.title || ruleKey(rule)),
            hits,
          }
        : null;
    })
    .filter(Boolean);

  const legacyActiveCount = legacyRules.filter((item) => item.state === "active").length;
  const rewrittenOkCount = rewrittenRules.filter((item) => item.ok).length;
  const cardsOkCount = cardHealth.filter((item) => item.ok).length;
  const activeRuleForbidden = rewrittenRules.filter((item) =>
    item.state === "active" && item.forbidden_hits.length > 0
  ).length;
  const hardErrors = residualConflicts.length + legacyActiveCount + activeRuleForbidden +
    cardHealth.filter((item) => item.forbidden_hits.length > 0).length +
    (retiredCardsRemoved < RETIRED_SUTANG_DRAWER_IDS.length ? 1 : 0);
  const warnings = rewrittenRules.filter((item) =>
    item.state !== "active" || item.missing.length > 0
  ).length +
    cardHealth.filter((item) => !item.ok).length;

  return {
    persona_id: SUTANG_PERSONA_ID,
    status: hardErrors ? "error" : warnings ? "warn" : "ok",
    summary: {
      applicable_rules: applicable.length,
      active_rules: active.length,
      legacy_total: legacyRules.length,
      legacy_handled: legacyRules.filter((item) => item.ok).length,
      legacy_active: legacyActiveCount,
      rewritten_total: rewrittenRules.length,
      rewritten_ok: rewrittenOkCount,
      cards_total: cardHealth.length,
      cards_ok: cardsOkCount,
      retired_cards_total: RETIRED_SUTANG_DRAWER_IDS.length,
      retired_cards_removed: retiredCardsRemoved,
      residual_conflicts: residualConflicts.length,
    },
    legacy_rules: legacyRules,
    rewritten_rules: rewrittenRules,
    cards: cardHealth,
    residual_conflicts: residualConflicts,
  };
}
