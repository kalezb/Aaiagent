import { describe, expect, it } from "vitest";
import { buildAgentRuleState } from "../functions/api/_agent_rule_contract";
import { DEFAULT_AGENT_RULES } from "../functions/api/_agent_rule_inventory";
import { buildLeanConversationPrompt } from "../functions/api/_lean_conversation_prompt";
import { buildSutangContactPrompt } from "../functions/api/_sutang_contact_prompt";

describe("Sutang QQ contact guidance", () => {
  it("uses the QQ from app facts and never falls back to an old account", () => {
    const state = buildAgentRuleState(DEFAULT_AGENT_RULES, "female_sutang");
    const prompt = buildLeanConversationPrompt({
      personaId: "female_sutang",
      activePersonaScope: "sutang",
      personaPrompt: "你是苏棠。",
      platform: "soul",
      personaFacts: { contact_qq: "12345678" },
      messages: [{ role: "user", content: "想私下聊，方便加个联系方式吗" }],
      historyMessages: [],
      agentRuleState: state,
    });

    expect(prompt).toContain("QQ号：12345678");
    expect(prompt).toContain("当前资料里填写的QQ");
    expect(prompt).not.toContain("sutang2026");
    expect(prompt).not.toContain("去豆瓣");
  });

  it("uses the latest dashboard edit on the next turn and respects disabling it", () => {
    const edited = DEFAULT_AGENT_RULES.map((rule) =>
      rule.id === "sutang_contact_policy"
        ? {
          ...rule,
          legacy_rule_id: rule.id,
          detail: "只在对方尊重且聊得自然时给QQ，绝不主动提其他账号。",
        }
        : { ...rule, legacy_rule_id: rule.id }
    );
    const editedState = buildAgentRuleState(edited, "female_sutang");
    expect(buildSutangContactPrompt(editedState)).toContain("只在对方尊重且聊得自然时给QQ");

    const disabled = edited.map((rule) =>
      rule.id === "sutang_contact_policy" ? { ...rule, enabled: false } : rule
    );
    const disabledState = buildAgentRuleState(disabled, "female_sutang");
    expect(buildSutangContactPrompt(disabledState)).not.toContain("只在对方尊重且聊得自然时给QQ");
    expect(buildSutangContactPrompt(disabledState)).not.toContain("不看固定聊天轮数");
  });
});
