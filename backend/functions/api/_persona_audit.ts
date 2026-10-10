import {
  effectivePersonaDrawers,
  loadEffectivePersonaFacts,
} from "./_persona_runtime";

export function detectAgentConfigConflicts(persona, facts, cards) {
  // persona-guard: ok — this audit must compare identity names across personas.
  const prompt = String(persona?.system_prompt || "");
  const cardText = (cards || []).map((item) => String(item.content || "")).join("\n");
  const combined = prompt + "\n" + cardText;
  const conflicts = [];

  const promptAge = prompt.match(/(\d{2})\s*岁/u)?.[1];
  const fixedAge = Number(facts?.fixed_age || 0);
  if (fixedAge && promptAge && Number(promptAge) !== fixedAge) {
    conflicts.push({
      level: "error",
      title: "年龄说法不一致",
      detail: `身份事实是 ${fixedAge} 岁，人设正文写的是 ${promptAge} 岁。系统会以身份事实为准。`,
    });
  }

  const childAge = Number(facts?.children_age || 0);
  const childAgeMatch = combined.match(/(?:孩子|娃|女儿|儿子).{0,8}?(\d{1,2})\s*岁/u)?.[1];
  if (facts?.has_children === true && childAge && childAgeMatch && Number(childAgeMatch) !== childAge) {
    conflicts.push({
      level: "error",
      title: "孩子年龄说法不一致",
      detail: `身份事实是 ${childAge} 岁，正文或卡片写的是 ${childAgeMatch} 岁。系统会以身份事实为准。`,
    });
  }
  if (facts?.has_children === false && childAgeMatch) {
    conflicts.push({
      level: "error",
      title: "孩子信息冲突",
      detail: `身份事实写着没有孩子，正文或卡片却提到孩子 ${childAgeMatch} 岁。`,
    });
  }

  // persona-guard: ok — cross-persona contradiction detector.
  if (String(persona?.id || "") === "female_sutang" && /王雅慧|星暮/u.test(prompt)) {
    conflicts.push({
      level: "error",
      title: "人设身份串了",
      detail: "当前是苏棠，但正文里出现了星暮或王雅慧。换模型也不会解决，需要清掉这条旧描述。",
    });
  }
  if (String(persona?.id || "") === "female" && /苏棠/u.test(prompt)) {
    conflicts.push({
      level: "error",
      title: "人设身份串了",
      detail: "当前是星暮，但正文里出现了苏棠。",
    });
  }

  const alwaysPolicy = (cards || []).filter((item) => item.activation === "always" && item.kind === "policy");
  if (alwaysPolicy.length > 12) {
    conflicts.push({
      level: "warn",
      title: "禁止类卡片较多",
      detail: `一直生效的禁止卡片有 ${alwaysPolicy.length} 张，模型可能出现注意力分散。建议合并同类规则。`,
    });
  }

  return conflicts;
}

const PERSONA_CROSS_WARNING_TERMS = {
  // persona-guard: ok — these are audit deny-lists, not prompts sent to models.
  female: ["苏棠", "电商运营", "带娃", "3岁", "三岁", "我老公", "按摩"],
  female_sutang: ["星暮", "王雅慧", "宝马X3", "离过婚", "独居"],
  male: ["苏棠", "星暮", "王雅慧", "电商运营", "带娃", "3岁", "三岁", "我老公", "撒娇", "借腿", "排解寂寞"],
  male_chenyu: ["苏棠", "星暮", "王雅慧", "电商运营", "带娃", "3岁", "三岁", "我老公", "撒娇", "借腿", "排解寂寞"],
};

function hitTerms(text, terms) {
  const source = String(text || "");
  return terms.filter((term) => source.includes(term));
}

export function auditPersonaBundle(persona, facts, cards) {
  const personaId = String(persona?.id || "");
  const crossTerms = PERSONA_CROSS_WARNING_TERMS[personaId] || [];
  const issues = [];
  const promptHits = hitTerms(persona?.system_prompt || "", crossTerms);
  if (promptHits.length) {
    issues.push({
      level: "warn",
      source: "正文",
      detail: `正文出现疑似其他身份的用词：${promptHits.join("、")}。请结合上下文人工确认是不是故意写的。`,
    });
  }
  for (const card of cards || []) {
    const cardText = `${card.name || ""}\n${card.content || ""}\n${(card.keywords || []).join(" ")}`;
    const hits = hitTerms(cardText, crossTerms);
    if (hits.length) {
      issues.push({
        level: "warn",
        source: `卡片：${card.name || card.id}`,
        detail: `卡片出现疑似其他身份的用词：${hits.join("、")}。请结合上下文人工确认是不是故意写的。`,
      });
    }
  }
  for (const issue of detectAgentConfigConflicts(persona, facts, cards)) {
    issues.push({
      level: issue.level,
      source: "事实冲突",
      detail: issue.detail,
    });
  }
  return {
    persona_id: personaId,
    name: persona?.name || personaId,
    ok: issues.length === 0,
    issues,
    card_count: (cards || []).length,
    shared_version: facts?.version || 1,
  };
}

export async function auditAllPersonas(db, kv) {
  const { results } = await db.prepare(
    "SELECT id, name, system_prompt, is_active FROM personas ORDER BY created_at, id"
  ).all();
  const audits = [];
  for (const persona of results || []) {
    const factsResult = await loadEffectivePersonaFacts(db, "", String(persona.id));
    const drawers = effectivePersonaDrawers(
      String(persona.id),
      await kv.get(`persona:drawers:${persona.id}`, "json"),
    );
    const cards = [...drawers.topics, ...drawers.counters, ...drawers.custom];
    audits.push(auditPersonaBundle(
      persona,
      { ...factsResult.facts, version: factsResult.version },
      cards,
    ));
  }
  return {
    ok: audits.every((item) => item.ok),
    checked_at: Math.floor(Date.now() / 1000),
    personas: audits,
    warning_count: audits.reduce((sum, item) => sum + item.issues.length, 0),
  };
}
