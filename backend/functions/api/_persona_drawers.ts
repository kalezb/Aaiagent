import {
  DEFAULT_SCENE_DRAWERS,
  type PersonaDrawerItem,
  type PersonaDrawers,
} from "./_persona_drawers_data";

export {
  DEFAULT_SCENE_DRAWERS,
  type PersonaDrawerItem,
  type PersonaDrawers,
} from "./_persona_drawers_data";

export function defaultDrawersForPersona(personaId: string): PersonaDrawers {
  if (String(personaId || "").trim() === "female_sutang") {
    return {
      topics: DEFAULT_SCENE_DRAWERS,
      counters: [],
      custom: [],
    };
  }
  return { topics: [], counters: [], custom: [] };
}

export function parsePersonaDrawers(value: unknown): PersonaDrawers {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as PersonaDrawers;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as PersonaDrawers) : {};
  } catch {
    return {};
  }
}

export interface MatchActiveDrawersOptions {
  maxKeywordCards?: number;
  maxChars?: number;
  currentHour?: number;
  weatherCondition?: string;
  weatherTemp?: number;
  isFragmented?: boolean;
}

export function matchActiveDrawers(
  drawers: PersonaDrawers,
  incomingText: string,
  options: MatchActiveDrawersOptions = {},
): string[] {
  const text = String(incomingText || "").toLowerCase();

  const always: Array<{ item: PersonaDrawerItem; text: string; hits: number; longest: number }> = [];
  const matched: Array<{ item: PersonaDrawerItem; text: string; hits: number; longest: number }> = [];
  const allGroups = [
    ...(drawers.topics || []),
    ...(drawers.counters || []),
    ...(drawers.custom || []),
  ];

  for (const item of allGroups) {
    if (item.deleted === true || item.enabled === false) continue;

    // 1. 时段守门员：白天不放深夜卡，夜晚不放开会摸鱼卡
    if (options.currentHour !== undefined && Number.isFinite(options.currentHour)) {
      const hour = options.currentHour;
      const isNight = hour >= 21 || hour < 5;
      const isDay = hour >= 8 && hour < 20;
      if (item.timeSlot === "night" && !isNight) continue;
      if (item.timeSlot === "day" && !isDay) continue;
    }

    // 2. 天气守门员：窗外不下雨绝不出雨天卡，窗外不热不出暴晒卡，窗外不冷不出降温卡
    if (item.weatherType && item.weatherType !== "any") {
      const cond = String(options.weatherCondition || "").trim();
      const temp = Number(options.weatherTemp);
      if (item.weatherType === "rain") {
        const isRainy = cond.includes("雨");
        const userExplicitRain = /(?:下雨|雨天|雨夜|飘雨|下大雨|阴雨|暴雨)/u.test(text);
        if (cond && !isRainy && !userExplicitRain) continue;
        if (!cond && !userExplicitRain) continue;
      } else if (item.weatherType === "hot") {
        const isHot = (Number.isFinite(temp) && temp >= 28) || cond.includes("晴");
        const userExplicitHot = /(?:大热天|好热|暴晒|太阳大|天气热)/u.test(text);
        if (cond && !isHot && !userExplicitHot) continue;
        if (!cond && !userExplicitHot) continue;
      } else if (item.weatherType === "cold") {
        const isCold = (Number.isFinite(temp) && temp <= 12) || cond.includes("雪") || cond.includes("冷");
        const userExplicitCold = /(?:降温|好冷|冷天|大风|冻死)/u.test(text);
        if (cond && !isCold && !userExplicitCold) continue;
        if (!cond && !userExplicitCold) continue;
      }
    }

    // 3. 半截话碎片保护：如果对方只是发了 1-4 个字的半截词（比如单字“腿…”），不硬套大篇场景卡
    if (options.isFragmented && item.kind === "scene" && text.length <= 4) {
      continue;
    }

    const activation = item.activation || "keyword";
    const matchedKeywords = activation === "always"
      ? []
      : (item.keywords || [])
        .map((keyword) => String(keyword || "").trim().toLowerCase())
        .filter((keyword) => keyword && text.includes(keyword));
    const hit = activation === "always" || matchedKeywords.length > 0;
    if (hit && item.content) {
      const prefix = (item.replyMode || "guide") === "exact"
        ? "【知识库命中｜优先按原文】"
        : "【知识库命中｜参考表达】";
      const line = `${prefix}【id:${item.id}】【${item.name}】${item.content}`;
      const entry = {
        item,
        text: line,
        hits: matchedKeywords.length,
        longest: matchedKeywords.reduce((max, keyword) => Math.max(max, keyword.length), 0),
      };
      if (activation === "always") always.push(entry);
      else matched.push(entry);
    }
  }

  const byPriority = (
    left: { item: PersonaDrawerItem },
    right: { item: PersonaDrawerItem },
  ) => Number(right.item.priority || 0) - Number(left.item.priority || 0);
  always.sort(byPriority);
  matched.sort((left, right) =>
    right.hits - left.hits ||
    right.longest - left.longest ||
    byPriority(left, right),
  );

  // 一直生效的卡片是配置本身；关键词卡片仍限制为 2 张，避免每轮无上限膨胀。
  let budget = Number.isFinite(options.maxChars) ? Number(options.maxChars) : 3200;
  const maxKeywordCards = Number.isFinite(options.maxKeywordCards)
    ? Math.max(0, Number(options.maxKeywordCards))
    : 2;
  const result: string[] = [];
  for (const entry of [...always, ...matched.slice(0, maxKeywordCards)]) {
    if (budget - entry.text.length < 0) break;
    result.push(entry.text);
    budget -= entry.text.length;
  }
  return result;
}
