const SUTANG_PERSONA_ID = "female_sutang";

// 2026-11-07：这里只体检当前这一版苏棠在用的规则，不再记旧人设的规则名和旧词。
const REWRITTEN_RULES = [
  {
    key: "sutang_action_ladder",
    title: "本轮接话原则",
    required: ["先接住", "只谈线上"],
  },
  {
    key: "sutang_family_and_voice_boundary",
    title: "家庭与时间处境",
    required: ["没有孩子", "婆婆"],
  },
  {
    key: "sutang_contrast_mature_hook",
    title: "昵称与真实自我",
    required: ["想要一点自己的情绪和陪伴"],
  },
  {
    key: "sutang_explicit_boundary",
    title: "暧昧话题分寸",
    required: ["半截话", "软钉子"],
  },
  {
    key: "sutang_fact_boundary",
    title: "事实与边界",
    required: ["不编造", "对方明确问事实先答清"],
  },
  {
    key: "sutang_drawer_maturity_gate",
    title: "私密知识卡防早熟锁",
    required: ["10轮前不触发", "21:00以后", "满15轮"],
  },
  {
    key: "sutang_contact_policy",
    title: "联系方式边界",
    required: ["微信", "当前资料里的QQ", "时机合适"],
  },
  {
    key: "sutang_no_preachy",
    title: "禁止说教",
    required: ["催对方早点睡", "不对男人讲大道理"],
  },
  {
    key: "sutang_short_bubble",
    title: "极短气泡",
    required: ["1到3条", "3到10字", "整轮最多25字"],
  },
  {
    key: "knowledge_match_priority",
    title: "知识库命中优先级",
    required: ["场景提示"],
  },
];

const CARD_EXPECTATIONS = [
  {
    id: "scene_sutang_probe_spending",
    title: "成熟男士生活与出行了解",
    required: ["还是坐办公室", "周末一般去哪儿"],
  },
  {
    id: "scene_sutang_night_empty",
    title: "深夜私密与反差空虚",
    required: ["别招我", "屋里太静了"],
  },
  {
    id: "scene_sutang_intimate_questions",
    title: "借老公常年在外顺嘴打听",
    required: ["你一个人忍得住", "你经常约网友吗"],
  },
  {
    id: "scene_sutang_invite_refusal",
    title: "被反复邀约的线上婉拒",
    required: ["家里走不开", "婆婆在"],
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

function missingTerms(text: string, terms: string[]) {
  return terms.filter((term) => !text.includes(term));
}

function findRule(rules: any[], key: string) {
  return rules.find((rule) => ruleKey(rule) === key) || null;
}

export function buildSutangRuleHealth(rules: any[] = [], cards: any[] = []) {
  const allRules = Array.isArray(rules) ? rules : [];
  const applicable = allRules.filter(appliesToSutang);
  const active = applicable.filter((rule) => !isDeleted(rule) && rule.enabled !== false);

  const rewrittenRules = REWRITTEN_RULES.map((definition) => {
    const rule = findRule(applicable, definition.key);
    const state = ruleStatus(rule);
    const missing = rule ? missingTerms(textOf(rule), definition.required) : definition.required;
    return {
      key: definition.key,
      id: String(rule?.id || ""),
      title: String(rule?.title || definition.title),
      state,
      ok: state === "active" && missing.length === 0,
      missing,
      forbidden_hits: [],
    };
  });

  const cardById = new Map(
    (Array.isArray(cards) ? cards : []).map((card) => [String(card?.id || ""), card]),
  );
  const cardHealth = CARD_EXPECTATIONS.map((definition) => {
    const card = cardById.get(definition.id);
    const state = !card ? "missing" : card.enabled === false || card.deleted === true ? "disabled" : "enabled";
    const missing = card ? missingTerms(textOf(card), definition.required) : definition.required;
    return {
      id: definition.id,
      title: String(card?.name || definition.title),
      state,
      ok: state === "enabled" && missing.length === 0,
      missing,
      forbidden_hits: [],
    };
  });
  const rewrittenOkCount = rewrittenRules.filter((item) => item.ok).length;
  const cardsOkCount = cardHealth.filter((item) => item.ok).length;
  const hardErrors = 0;
  const warnings = rewrittenRules.filter((item) =>
    item.state !== "active" || item.missing.length > 0
  ).length + cardHealth.filter((item) => !item.ok).length;

  return {
    persona_id: SUTANG_PERSONA_ID,
    status: hardErrors ? "error" : warnings ? "warn" : "ok",
    summary: {
      applicable_rules: applicable.length,
      active_rules: active.length,
      legacy_total: 0,
      legacy_handled: 0,
      legacy_active: 0,
      rewritten_total: rewrittenRules.length,
      rewritten_ok: rewrittenOkCount,
      cards_total: cardHealth.length,
      cards_ok: cardsOkCount,
      retired_cards_total: 0,
      retired_cards_removed: 0,
      residual_conflicts: 0,
    },
    legacy_rules: [],
    rewritten_rules: rewrittenRules,
    cards: cardHealth,
    residual_conflicts: [],
  };
}
