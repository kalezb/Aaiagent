import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_RULES } from "../functions/api/_agent_rule_inventory";
import { buildAgentRuleState } from "../functions/api/_agent_rule_contract";
import { defaultDrawersForPersona, matchActiveDrawers } from "../functions/api/_persona_drawers";
import {
  buildLayeredSystemPrompt,
  buildRelationshipBoundaryPrompt,
  businessFilterFallback,
} from "../functions/api/_reply_policy";
import { buildSutangContactPrompt } from "../functions/api/_sutang_contact_prompt";

// 2026-11-07：苏棠 29 岁、已婚、未育、跟婆婆住、只聊线上。
const CURRENT_SUTANG_PROMPT =
  "你是苏棠，29岁，已婚，没有孩子，和婆婆一起住在重庆两江新区，在家操持家务、照顾婆婆。";

function defaultState() {
  return buildAgentRuleState(
    DEFAULT_AGENT_RULES.map((rule) => ({
      ...rule,
      legacy_rule_id: rule.id,
      deleted_at: 0,
    })),
    "female_sutang",
  );
}

function buildCurrentPrompt(
  agentRuleState = defaultState(),
  currentDatetime = "2026-11-07 21:40:00",
  incoming = "在干嘛",
) {
  return buildLayeredSystemPrompt({
    personaId: "female_sutang",
    personaPrompt: CURRENT_SUTANG_PROMPT,
    personaFacts: null,
    platform: "soul",
    profileContext: "",
    currentDatetime,
    weekday: "星期六",
    homeLocation: { city: "重庆", district: "两江新区" },
    workLocation: { city: "重庆", district: "两江新区" },
    weather: null,
    stageText: "",
    relationStageLevel: 2,
    messageDelay: null,
    messages: [{ role: "user", content: incoming }],
    historyMessages: [],
    xingmuSoulScope: false,
    matchedDrawerTips: [],
    agentRuleState,
  });
}

describe("苏棠当前人设（2026-11-07 版）", () => {
  it("人设正文是 29 岁、已婚、未育、跟婆婆住、只聊线上", () => {
    const prompt = buildCurrentPrompt();
    expect(prompt).toContain("29岁");
    expect(prompt).toContain("已婚");
    expect(prompt).toContain("没有孩子");
    expect(prompt).toContain("婆婆");
    expect(prompt).toContain("只谈线上");
  });

  it("聊天格式和真人感正常", () => {
    const prompt = buildCurrentPrompt();
    expect(prompt).toContain("不客服腔");
    expect(prompt).toContain("json");
    expect(prompt).toContain("{\"messages\":");
    expect(prompt).toContain("一次1到3条");
    expect(prompt).toContain("整轮最多25字");
    expect(prompt).toContain("【真人表达｜最后检查】");
    expect(prompt).not.toContain("江北区");
  });

  it("白天聊作息，不会被她当成现在要睡", () => {
    const prompt = buildCurrentPrompt(
      defaultState(),
      "2026-11-07 11:35:00",
      "我一直都睡的挺晚的",
    );
    expect(prompt).toContain("只是聊作息习惯，不是现在要睡");
  });

  it("默认规则里只有这一版在用的规则", () => {
    const state = defaultState();
    expect(state.isEnabled("sutang_action_ladder", true)).toBe(true);
    expect(state.isEnabled("sutang_family_and_voice_boundary", true)).toBe(true);
    expect(state.isEnabled("sutang_drawer_maturity_gate", true)).toBe(true);
    expect(state.isEnabled("sutang_contact_policy", true)).toBe(true);
    expect(state.isEnabled("sutang_no_preachy", true)).toBe(true);
    expect(state.isEnabled("sutang_short_bubble", true)).toBe(true);
    expect(state.textFor("sutang_action_ladder", "")).toContain("只谈线上");
    expect(state.textFor("sutang_family_and_voice_boundary", "")).toContain("没有孩子");
  });

  it("后台改了规则，下一条提示词立即使用新文字；停用后立即消失", () => {
    const enabledRules = DEFAULT_AGENT_RULES.map((rule) => {
      if (rule.id === "sutang_action_ladder") {
        return {
          ...rule,
          legacy_rule_id: rule.id,
          deleted_at: 0,
          detail: "这一轮只回答对方刚问的事实，不主动推进任何话题。",
        };
      }
      return { ...rule, legacy_rule_id: rule.id, deleted_at: 0 };
    });
    const changed = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: CURRENT_SUTANG_PROMPT,
      platform: "soul",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "两江新区" },
      messages: [{ role: "user", content: "你多大了" }],
      agentRuleState: buildAgentRuleState(enabledRules, "female_sutang"),
    });
    expect(changed).toContain("这一轮只回答对方刚问的事实");

    const disabledRules = enabledRules.map((rule) =>
      rule.id === "sutang_action_ladder"
        ? { ...rule, enabled: false }
        : rule
    );
    const disabled = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: CURRENT_SUTANG_PROMPT,
      platform: "soul",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "两江新区" },
      messages: [{ role: "user", content: "你多大了" }],
      agentRuleState: buildAgentRuleState(disabledRules, "female_sutang"),
    });
    expect(disabled).not.toContain("这一轮只回答对方刚问的事实");
  });

  it("默认只有 4 张知识卡", () => {
    const drawers = defaultDrawersForPersona("female_sutang");
    const cards = [...(drawers.topics || []), ...(drawers.counters || [])];
    const ids = cards.map((card) => card.id);
    expect(ids).toEqual(expect.arrayContaining([
      "scene_sutang_probe_spending",
      "scene_sutang_night_empty",
      "scene_sutang_intimate_questions",
      "scene_sutang_invite_refusal",
    ]));
  });

  it("对方约线下时，只温柔婉拒，不给地址、不落实时间", () => {
    const meeting = buildRelationshipBoundaryPrompt(2, "周末出来见一面吧", [], "sutang", defaultState(), 16);
    expect(meeting).toContain("见面边界｜苏棠");
    expect(meeting).toContain("不答应");
    expect(meeting).toContain("不给地址");
  });

  it("暧昧话题可以接住和反逗，不写露骨内容", () => {
    const suggestive = buildRelationshipBoundaryPrompt(
      2,
      "里里外外都给你放松，必须一起睡大床",
      [],
      "sutang",
      defaultState(),
      16,
    );
    expect(suggestive).toContain("【苏棠的暧昧分寸】");
    expect(suggestive).toContain("短促半截话");
    expect(suggestive).toContain("隔着衣服");
  });

  it("问工作只按当前生活回答", () => {
    expect(businessFilterFallback("你做什么工作的", false)).toBe("在家操持家务 没上班");
  });

  it("联系方式的时机按语境判断", () => {
    const state = buildAgentRuleState(DEFAULT_AGENT_RULES, "female_sutang");
    const prompt = buildSutangContactPrompt(state);
    expect(prompt).toContain("微信顾虑太多");
    expect(prompt).toContain("不想自己的现实生活被打扰");
    expect(prompt).toContain("当前资料里填写的QQ");
    expect(prompt).toContain("不看固定聊天轮数");
  });

  it("知识卡按时间和熟络度命中", () => {
    const drawers = defaultDrawersForPersona("female_sutang");
    const day = matchActiveDrawers(drawers, "今天上班堵车吗", {
      currentHour: 14,
      currentMinute: 14 * 60,
      totalExchanges: 6,
      maturityGateEnabled: true,
    }).join("\n");
    expect(day).toContain("scene_sutang_probe_spending");

    const night = matchActiveDrawers(drawers, "洗完澡 睡不着", {
      currentHour: 21,
      currentMinute: 21 * 60,
      totalExchanges: 10,
      maturityGateEnabled: true,
    }).join("\n");
    expect(night).toContain("scene_sutang_night_empty");

    const invite = matchActiveDrawers(drawers, "周末出来见一面吧", {
      currentHour: 20,
      currentMinute: 20 * 60,
      totalExchanges: 10,
      maturityGateEnabled: true,
    }).join("\n");
    expect(invite).toContain("scene_sutang_invite_refusal");
    expect(invite).toContain("家里走不开");
  });

});
