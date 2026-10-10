import { describe, expect, it } from "vitest";
import {
  normalizeChatRequest,
  normalizeHostingMode,
  normalizePlatform,
  prepareChatInput,
} from "../functions/api/_chat_input";
import { DEFAULT_PROGRAM_RULES, normalizeProgramRules } from "../functions/api/_program_rules";

describe("chat input layer", () => {
  it("normalizes platform and request fields without touching business rules", () => {
    const request = normalizeChatRequest({
      platform: "SOUL",
      contact_id: " contact-1 ",
      contact_name: " 客户 ",
      request_id: "req-1",
      conversation_stage: "FIRST_CONTACT",
      relationship_origin: "match",
      messages: [{ role: "user", content: "你好" }],
    });
    expect(request).toMatchObject({
      platform: "soul",
      contactId: "contact-1",
      contactName: "客户",
      requestId: "req-1",
      hostingMode: "monitor_only",
      conversationStage: "first_contact",
      relationshipOrigin: "match",
    });
    expect(normalizePlatform("unknown")).toBe("");
    expect(normalizeHostingMode("MONITOR_ONLY")).toBe("monitor_only");
  });

  it("drops platform notices before later chat logic sees them", () => {
    const result = prepareChatInput(
      [{ role: "user", content: "【平台提示】对方正在输入……" }],
      normalizeProgramRules(DEFAULT_PROGRAM_RULES),
    );
    expect(result).toEqual({ kind: "skip", reason: "platform_notice" });
  });

  it("returns the configured fixed voice reply before a model call", () => {
    const rules = normalizeProgramRules({
      ...DEFAULT_PROGRAM_RULES,
      untranscribedVoice: {
        enabled: true,
        mode: "fixed_reply",
        fixedReply: "在呢 你打字跟我说嘛",
        redirectInstruction: "",
      },
    });
    expect(prepareChatInput([{ role: "user", content: "[语音]" }], rules)).toEqual({
      kind: "fixed_reply",
      reason: "untranscribed_voice_fixed",
      reply: "在呢 你打字跟我说嘛",
    });
  });
});
