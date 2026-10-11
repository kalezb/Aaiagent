import type { ActiveAgentRule } from "./_agent_rule_contract";

export type AgentRuleTranslationMode =
  | "existing_rule"
  | "prompt_rule"
  | "manual_contact_action"
  | "unsupported";

export interface AgentRuleTranslation {
  mode: AgentRuleTranslationMode;
  title: string;
  preview: string;
  note: string;
  rule_id: string;
  legacy_rule_id: string;
  rule_title: string;
  patch: Record<string, unknown>;
  prompt_rule: {
    title: string;
    detail: string;
    gate: "prompt";
    persona_id: string;
    priority: number;
  } | null;
}

function compact(value: unknown) {
  return String(value || "").replace(/\s+/gu, "").trim();
}

// persona-guard: ok — 这里只是把看板大白话翻译成对应人设范围，不是拼给模型的正文。
function personaScope(text: string) {
  const ids: string[] = [];
  if (text.includes("苏棠")) ids.push("female_sutang");
  if (text.includes("星暮")) ids.push("female");
  if (text.includes("阿杰")) ids.push("male");
  if (text.includes("陈屿")) ids.push("male_chenyu");
  return ids.join(",");
}

function priorityValue(text: string) {
  return /最重要|最高优先|最优先|优先处理/u.test(text) ? 90 : 70;
}

function baseResult(
  text: string,
  overrides: Partial<AgentRuleTranslation> = {},
): AgentRuleTranslation {
  const personaId = personaScope(text);
  const priority = priorityValue(text);
  return {
    mode: "unsupported",
    title: "",
    preview: "",
    note: "",
    rule_id: "",
    legacy_rule_id: "",
    rule_title: "",
    patch: {},
    prompt_rule: {
      title: String(text || "大白话规则").trim().slice(0, 36),
      detail: String(text || "").trim().slice(0, 3000),
      gate: "prompt",
      persona_id: personaId,
      priority,
    },
    ...overrides,
  };
}

function findRule(rules: ActiveAgentRule[], ids: string[]) {
  for (const id of ids) {
    const rule = rules.find((item) => String(item.legacy_rule_id || "") === id);
    if (rule) return rule;
  }
  return null;
}

function existingRuleResult(
  text: string,
  rule: ActiveAgentRule,
  preview: string,
) {
  const personaId = personaScope(text);
  const patch: Record<string, unknown> = { enabled: true };
  if (personaId) patch.persona_id = personaId;
  if (/最重要|最高优先|最优先|优先处理/u.test(text)) patch.priority = 90;
  return baseResult(text, {
    mode: "existing_rule",
    title: rule.title,
    rule_id: String(rule.id || ""),
    legacy_rule_id: String(rule.legacy_rule_id || ""),
    rule_title: rule.title,
    preview,
    patch,
    note: "保存后下一条聊天马上按这条系统动作执行，不需要发布或重启。",
    prompt_rule: null,
  });
}

function promptRuleResult(text: string, reason: string) {
  const promptRule = baseResult(text).prompt_rule;
  return baseResult(text, {
    mode: "prompt_rule",
    title: promptRule?.title || "大白话规则",
    preview: "我理解成：这是一条说话要求，会交给大模型，但不会自动变成系统硬动作。",
    note: reason,
    prompt_rule: promptRule,
  });
}

export function translateAgentRuleText(
  rawText: unknown,
  rules: ActiveAgentRule[] = [],
): AgentRuleTranslation {
  const text = compact(rawText);
  if (!text) {
    return baseResult("", {
      mode: "unsupported",
      preview: "先写一句你想要的规则。",
      note: "例如：已婚的人不要回。",
      prompt_rule: null,
    });
  }

  if (/拉黑|黑名单/u.test(text) || /这个人/u.test(text) && /不回|不回复|不要回/u.test(text)) {
    return baseResult(text, {
      mode: "manual_contact_action",
      title: "指定联系人不回复",
      preview: "这件事需要先选中具体客户，再在客户资料里设置“人工接管”或加入黑名单。不能只凭一句话判断你说的是谁。",
      note: "请先打开对应客户，再设置；这样不会误伤同名联系人。",
      prompt_rule: null,
    });
  }

  if (/已婚|结婚|有老婆|有媳妇/u.test(text) && /不回|不回复|不要回|不能回|别回|跳过/u.test(text)) {
    const rule = findRule(rules, ["married_excluded"]);
    if (rule) {
      return existingRuleResult(
        text,
        rule,
        "我理解成：已经确认已婚的客户，系统直接跳过，不回复。",
      );
    }
  }

  if (
    /联系方式|微信|电话|手机号|qq|号码/iu.test(text) &&
    /不给|不能.*给|不要.*给|禁止|不许|泄露|泄漏/u.test(text)
  ) {
    const rule = findRule(rules, ["no_contact_leak", "business_contact_boundary"]);
    if (rule) {
      return existingRuleResult(
        text,
        rule,
        "我理解成：回复里不能出现微信、QQ、电话、手机号或其他联系方式，发出去前系统会拦住。",
      );
    }
  }

  if (
    /照片|图片|写真|身材照/u.test(text) &&
    /不发|不要发|不能发|禁止|不主动/u.test(text)
  ) {
    const rule = findRule(rules, ["photo_only_explicit"]);
    if (rule) {
      return existingRuleResult(
        text,
        rule,
        "我理解成：不主动发照片；只有对方明确提出，并且现有照片规则允许时才能发。",
      );
    }
  }

  if (/视频/u.test(text) && /不发|不要发|不能发|禁止|不主动/u.test(text)) {
    const rule = findRule(rules, ["no_video"]);
    if (rule) {
      return existingRuleResult(text, rule, "我理解成：不主动发视频，也不接受视频请求。");
    }
  }

  if (/视频通话|打电话|语音通话/u.test(text) && /不|禁止|不要/u.test(text)) {
    const rule = findRule(rules, ["voice_call_boundary"]);
    if (rule) {
      return existingRuleResult(text, rule, "我理解成：不主动发起或接受语音、视频通话。");
    }
  }

  if (/平台提示|系统通知|正在输入|已读回执|礼物通知/u.test(text)) {
    const rule = findRule(rules, ["platform_not_user"]);
    if (rule) {
      return existingRuleResult(text, rule, "我理解成：平台提示和系统通知不当作客户消息，不回复。");
    }
  }

  if (/不要重复|别复读|不重复/u.test(text)) {
    const rule = findRule(rules, ["no_repeat"]);
    if (rule) {
      return existingRuleResult(text, rule, "我理解成：不要把自己刚说过的话原样再发一遍。");
    }
  }

  if (/只接最新|只回最新|不要翻旧|别翻旧/u.test(text)) {
    const rule = findRule(rules, ["late_reply_current_only"]);
    if (rule) {
      return existingRuleResult(text, rule, "我理解成：只接对方最新一句，不翻旧话题，不解释自己为什么晚回。");
    }
  }

  if (/客服腔|像客服|列选项/u.test(text) && /不要|不能|别/u.test(text)) {
    const rule = findRule(rules, ["no_customer_service"]);
    if (rule) {
      return existingRuleResult(text, rule, "我理解成：不要像客服一样列选项、请示或反复问对方想聊什么。");
    }
  }

  if (/年龄|几岁|多大/u.test(text) && /不能改|不要乱说|按资料/u.test(text)) {
    const rule = findRule(rules, ["fixed_age", "facts_no_guess"]);
    if (rule) {
      return existingRuleResult(text, rule, "我理解成：年龄只能按人物资料回答，不能自己改、猜或编出生年份。");
    }
  }

  if (/位置|住哪|城市|区县/u.test(text) && /不能|不要|只/u.test(text)) {
    const rule = findRule(rules, ["location_scope"]);
    if (rule) {
      return existingRuleResult(text, rule, "我理解成：位置只能按你设定的精度回答。");
    }
  }

  return promptRuleResult(
    text,
    "这句话没有匹配到现成的系统硬动作，不会自动变成系统硬动作。可以保存成说话规则，但不要指望它像“已婚跳过”那样由系统强制执行。",
  );
}
