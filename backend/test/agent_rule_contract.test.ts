import { describe, expect, it } from "vitest";
import {
  buildAgentRuleState,
  buildAgentRuleStagePrompt,
  buildCustomAgentRulesPrompt,
  describeAgentRuleEdit,
  type ActiveAgentRule,
} from "../functions/api/_agent_rule_contract";
import { buildLayeredSystemPrompt } from "../functions/api/_reply_policy";

function rule(
  legacyRuleId: string,
  overrides: Partial<ActiveAgentRule> = {},
): ActiveAgentRule {
  return {
    id: `db-${legacyRuleId}`,
    legacy_rule_id: legacyRuleId,
    persona_id: "",
    title: legacyRuleId,
    detail: `${legacyRuleId} 内容`,
    gate: "prompt",
    priority: 50,
    enabled: true,
    sort_order: 0,
    source: "test",
    ...overrides,
  };
}

describe("agent rule and model contract", () => {
  it("turns a known rule off when its persona scope no longer matches", () => {
    const state = buildAgentRuleState([
      rule("married_excluded", {
        persona_id: "female_sutang",
        detail: "只有苏棠适用",
      }),
    ], "female");

    expect(state.isEnabled("married_excluded", true)).toBe(false);
    expect(state.textFor("married_excluded", "默认内容")).toBe("");
  });

  it("keeps fallback only for a rule that is truly unknown", () => {
    const state = buildAgentRuleState([], "female");

    expect(state.isEnabled("not_seeded_yet", true)).toBe(true);
    expect(state.textFor("not_seeded_yet", "默认内容")).toBe("默认内容");
  });

  it("sorts editable prompt rules by priority and exposes the priority to the model", () => {
    const state = buildAgentRuleState([
      rule("custom_low", {
        source: "dashboard",
        priority: 10,
        detail: "低优先级内容",
      }),
      rule("custom_high", {
        source: "dashboard",
        priority: 90,
        detail: "高优先级内容",
      }),
    ], "female");

    const prompt = buildCustomAgentRulesPrompt(state, "female");
    expect(prompt.indexOf("【优先级90】【custom_high】高优先级内容"))
      .toBeLessThan(prompt.indexOf("【优先级10】【custom_low】低优先级内容"));
  });

  it("passes custom input, output and execution rules to their matching stage", () => {
    const state = buildAgentRuleState([
      rule("custom_input", { source: "dashboard", gate: "input", detail: "先处理内容" }),
      rule("custom_output", { source: "dashboard", gate: "output", detail: "发前检查内容" }),
      rule("custom_execution", { source: "dashboard", gate: "execution", detail: "直接执行内容" }),
    ], "female");

    expect(buildAgentRuleStagePrompt(state, "female", "input", "【先处理】"))
      .toContain("先处理内容");
    expect(buildAgentRuleStagePrompt(state, "female", "output", "【发前检查】"))
      .toContain("发前检查内容");
    expect(buildAgentRuleStagePrompt(state, "female", "execution", "【系统执行】"))
      .toContain("直接执行内容");
  });

  it("places stage rules into the actual prompt sent for the next chat", () => {
    const state = buildAgentRuleState([
      rule("custom_input", { source: "dashboard", gate: "input", detail: "先处理内容" }),
      rule("custom_execution", {
        source: "dashboard",
        gate: "execution",
        detail: "直接执行内容",
      }),
    ], "female");
    const prompt = buildLayeredSystemPrompt({
      personaId: "female",
      personaPrompt: "你是星暮。",
      personaFacts: null,
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-11 01:00:00",
      weekday: "星期六",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      weather: null,
      stageText: "普通聊天",
      relationStageLevel: 1,
      messages: [{ role: "user", content: "你好" }],
      historyMessages: [],
      agentRuleState: state,
    });

    expect(prompt).toContain("先处理内容");
    expect(prompt).toContain("直接执行内容");
  });

  it("removes a previously hard-coded rule when the dashboard disables it", () => {
    const state = buildAgentRuleState([
      rule("xingmu_identity", {
        persona_id: "female",
        enabled: false,
      }),
    ], "female");
    const prompt = buildLayeredSystemPrompt({
      personaId: "female",
      personaPrompt: "你是星暮。",
      personaFacts: null,
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-11 01:00:00",
      weekday: "星期六",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      weather: null,
      stageText: "普通聊天",
      relationStageLevel: 1,
      messages: [{ role: "user", content: "你好" }],
      historyMessages: [],
      xingmuSoulScope: true,
      agentRuleState: state,
    });

    expect(prompt).not.toContain("你是王雅慧");
  });

  it("labels which rules can be edited as text and which are system actions", () => {
    expect(describeAgentRuleEdit(rule("late_reply_current_only")))
      .toMatchObject({ edit_mode: "text", edit_mode_label: "可直接改文字" });
    expect(describeAgentRuleEdit(rule("married_excluded", { gate: "input" })))
      .toMatchObject({ edit_mode: "system_action", edit_mode_label: "系统硬动作" });
    expect(describeAgentRuleEdit(rule("custom_output", { gate: "output" })))
      .toMatchObject({ edit_mode: "mixed", edit_mode_label: "文字和系统一起管" });
  });
});
