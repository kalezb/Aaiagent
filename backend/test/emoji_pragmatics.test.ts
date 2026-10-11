import { describe, expect, it } from "vitest";
import {
  DOUBAN_EMOJI_REGISTRY,
  detectEmojisInText,
  buildEmojiPragmaticPrompt,
} from "../functions/api/_emoji_pragmatics";
import { buildLayeredSystemPrompt } from "../functions/api/_reply_policy";
import { buildAgentRuleState, EMPTY_AGENT_RULE_STATE } from "../functions/api/_agent_rule_contract";

describe("emoji pragmatics and Douban 164 emojis registry", () => {
  it("contains Douban emojis with clear pragmatic roles", () => {
    expect(DOUBAN_EMOJI_REGISTRY["[白眼]"]).toBeDefined();
    expect(DOUBAN_EMOJI_REGISTRY["[白眼]"].category).toBe("teasing_or_pouting");
    expect(DOUBAN_EMOJI_REGISTRY["[哈哈]"].category).toBe("positive_icebreaking");
    expect(DOUBAN_EMOJI_REGISTRY["[害羞笑]"].category).toBe("flirting_or_affection");
    expect(DOUBAN_EMOJI_REGISTRY["[尴尬]"].category).toBe("softening_or_helpless");
  });

  it("detects bracketed and unicode emojis from incoming message", () => {
    const text = "哈哈你这人真逗[白眼] 别闹啦😂";
    const detected = detectEmojisInText(text);
    expect(detected.length).toBeGreaterThanOrEqual(2);
    const tags = detected.map((e) => e.tag);
    expect(tags).toContain("[白眼]");
    expect(tags).toContain("😂");
  });

  it("builds focused pragmatic prompt when emojis are present in incoming turn", () => {
    const prompt = buildEmojiPragmaticPrompt({
      incomingText: "才不要理你呢[白眼][发怒]",
      ruleEnabled: true,
    });
    expect(prompt).toContain("【本轮表情语用解析】");
    expect(prompt).toContain("[白眼]");
    expect(prompt).toContain("[发怒]");
    expect(prompt).toContain("语气助推剂");
    expect(prompt).toContain("严禁机械道歉或严肃对立");
  });

  it("returns empty string when rule is disabled from dashboard", () => {
    const prompt = buildEmojiPragmaticPrompt({
      incomingText: "才不要理你呢[白眼]",
      ruleEnabled: false,
    });
    expect(prompt).toBe("");
  });

  it("allows dashboard custom instruction to take highest priority", () => {
    const custom = "用户自定义最高准则：遇到任何表情都必须先回复一个可爱的拟声词";
    const prompt = buildEmojiPragmaticPrompt({
      incomingText: "你好呀",
      ruleEnabled: true,
      customInstruction: custom,
    });
    expect(prompt).toContain(custom);
  });

  it("integrates into buildLayeredSystemPrompt and respects dashboard state", () => {
    // 1. 默认启用状态：消息带有[白眼]，提示词包含语用解析
    const promptWithEmoji = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: "苏棠",
      platform: "douban",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      messages: [{ role: "user", content: "你真笨[白眼]" }],
      agentRuleState: EMPTY_AGENT_RULE_STATE,
    });
    expect(promptWithEmoji).toContain("【本轮表情语用解析】");
    expect(promptWithEmoji).toContain("[白眼]");

    // 2. 看板停用该规则后，下一条聊天立即生效（不包含该提示词）
    const disabledState = buildAgentRuleState([
      {
        id: "r1",
        legacy_rule_id: "emoji_pragmatic_booster",
        persona_id: "",
        title: "表情语用助推与防误判",
        detail: "",
        gate: "prompt",
        priority: 80,
        enabled: false,
        sort_order: 1,
        source: "dashboard",
      },
    ]);
    const promptDisabled = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: "苏棠",
      platform: "douban",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      messages: [{ role: "user", content: "你真笨[白眼]" }],
      agentRuleState: disabledState,
    });
    expect(promptDisabled).not.toContain("【本轮表情语用解析】");
    expect(promptDisabled).not.toContain("【表情理解原则】");
  });
});
