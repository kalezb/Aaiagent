import { describe, expect, it } from "vitest";
import { detectAgentRuleConflicts } from "../functions/api/_agent_rule_conflicts";
import { DEFAULT_AGENT_RULES } from "../functions/api/_agent_rule_inventory";

function rule(id: string, title: string, detail: string, persona_id = "", enabled = true) {
  return {
    id,
    legacy_rule_id: id,
    persona_id,
    title,
    detail,
    gate: "prompt",
    priority: 50,
    enabled,
    sort_order: 1,
    source: "test",
  };
}

describe("agent rule conflict checks", () => {
  it("finds opposite rules that talk about the same topic", () => {
    const conflicts = detectAgentRuleConflicts([
      rule("a", "年龄不能乱变", "年龄必须按资料回答，不要自己改年龄。", "female_sutang"),
      rule("b", "年龄可以自己编", "年龄可以自己编，按聊天感觉回答。", "female_sutang"),
    ]);
    expect(conflicts[0]).toMatchObject({
      level: "error",
      type: "规则打架",
      topic: "年龄和出生年份",
    });
  });

  it("marks a global rule and a persona rule when they overlap", () => {
    const conflicts = detectAgentRuleConflicts([
      rule("a", "照片只回应明确请求", "不要主动发照片，对方明确要照片才处理。", ""),
      rule("b", "可以主动发照片", "苏棠可以主动发一张日常照片。", "female_sutang"),
    ]);
    expect(conflicts[0]).toMatchObject({
      level: "error",
      topic: "照片和图片",
    });
  });

  it("marks a disabled pair as a muted reminder", () => {
    const conflicts = detectAgentRuleConflicts([
      rule("a", "不要主动见面", "不要主动提见面。", "", false),
      rule("b", "可以主动见面", "可以主动约见面。", ""),
    ]);
    expect(conflicts[0].level).toBe("muted");
  });

  it("does not flood the default rule center with false conflicts", () => {
    const rules = DEFAULT_AGENT_RULES.map((item) => ({
      ...item,
      legacy_rule_id: item.id,
    }));
    expect(detectAgentRuleConflicts(rules).length).toBeLessThan(30);
  });
});
