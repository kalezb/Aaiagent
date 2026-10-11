import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_RULES,
} from "../functions/api/_agent_rule_inventory";
import { buildAgentRuleState } from "../functions/api/_agent_rule_contract";
import { defaultDrawersForPersona } from "../functions/api/_persona_drawers";
import {
  buildLayeredSystemPrompt,
  isContactRequest,
  OUTPUT_HARD_RULE,
  resolveContactRequestPolicy,
  sanitizeContactDisclosure,
} from "../functions/api/_reply_policy";
import { normalizePersonaFacts } from "../functions/api/_persona_facts";

function buildSutangPrompt() {
  return buildLayeredSystemPrompt({
    personaId: "female_sutang",
    personaPrompt: "你是苏棠，29岁，重庆两江新区，居家电商运营，有一名3岁孩子。",
    personaFacts: null,
    platform: "soul",
    profileContext: "",
    currentDatetime: "2026-10-11 22:20:00",
    weekday: "星期日",
    homeLocation: { city: "重庆", district: "两江新区" },
    workLocation: { city: "重庆", district: "江北区" },
    weather: null,
    stageText: "",
    relationStageLevel: 2,
    messageDelay: null,
    messages: [{ role: "user", content: "在干嘛" }],
    historyMessages: [],
    xingmuSoulScope: false,
    matchedDrawerTips: [],
  });
}

describe("Su Tang v12 persona", () => {
  it("keeps the three human-feel safeguards: not passive, not customer service, and push when needed", () => {
    const prompt = buildSutangPrompt();
    expect(prompt).toContain("你不是被动问答机器人");
    expect(prompt).toContain("不要客服腔");
    expect(prompt).toContain("男方要主动把安全、舒适、体面的环境安排好");
    expect(prompt).toContain("冷淡止损");
  });

  it("uses the new 3-to-20 character reply rule and removes the old reward wording", () => {
    const prompt = buildSutangPrompt();
    expect(prompt).toContain(OUTPUT_HARD_RULE);
    expect(prompt).toContain("每段3到20个字，最多两条");
    expect(prompt).not.toContain("半真半假的专属感");
    expect(prompt).not.toContain("最终奖励");
  });

  it("pauses the old cards and enables the new ones", () => {
    const drawers = defaultDrawersForPersona("female_sutang");
    const oldStockings = drawers.topics?.find((item) => item.id === "scene_01_black_stockings");
    const newDouban = drawers.topics?.find((item) => item.id === "scene_16_douban_tree_hole");
    const newMeeting = drawers.topics?.find((item) => item.id === "scene_18_meeting_arrangement");
    expect(oldStockings?.enabled).toBe(false);
    expect(newDouban?.enabled).toBe(true);
    expect(newMeeting?.enabled).toBe(true);
  });

  it("turns off the conflicting old rules but keeps the new proactive boundary", () => {
    const state = buildAgentRuleState(
      DEFAULT_AGENT_RULES.map((rule) => ({
        ...rule,
        legacy_rule_id: rule.id,
        deleted_at: 0,
      })),
      "female_sutang",
    );
    expect(state.isEnabled("active_flirting", true)).toBe(false);
    expect(state.isEnabled("sutang_meeting_reward_rule", true)).toBe(false);
    expect(state.isEnabled("proactive_style_sutang", true)).toBe(true);
    expect(state.textFor("proactive_style_sutang", "")).toContain("主动挑一个具体话题");
    expect(state.textFor("sutang_fact_boundary", "")).toContain("豆瓣自留地");
  });

  it("treats Douban as the only private tree-hole channel and keeps WeChat or QQ out", () => {
    expect(isContactRequest("加个豆瓣吧")).toBe(true);
    expect(isContactRequest("加个微信吧")).toBe(true);
    expect(isContactRequest("我在豆瓣看电影")).toBe(false);

    const allowed = resolveContactRequestPolicy({
      requestCount: 3,
      stage: 2,
      activity: { totalExchanges: 30, activeDays: 2 },
      incomingText: "加个豆瓣吧",
      messages: [{ role: "user", content: "加个豆瓣吧" }],
      contactChannel: "douban",
      contactQq: "sutang2026",
      xingmuScope: false,
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.reply).toContain("我豆瓣是");

    expect(sanitizeContactDisclosure("可以 我豆瓣是sutang2026", {
      allowed: true,
      contactChannel: "douban",
      contactAccount: "sutang2026",
    })).toBe("可以 我豆瓣是sutang2026");
    expect(sanitizeContactDisclosure("可以 我微信是private_xh", {
      allowed: true,
      contactChannel: "douban",
      contactAccount: "sutang2026",
    })).toBe("联系方式先不发了 在这儿聊就行");
    expect(normalizePersonaFacts({ contact_qq: " sutang2026 " }).contact_qq).toBe("sutang2026");
  });
});
