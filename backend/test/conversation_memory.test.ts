import { describe, expect, it } from "vitest";
import { buildConversationMemoryPrompt } from "../functions/api/_conversation_memory";

describe("conversation memory prompt", () => {
  it("keeps unfinished questions and promises without replaying the whole transcript", () => {
    const prompt = buildConversationMemoryPrompt({
      summary: "上周聊过她在电商公司上班，平时要接孩子。",
      olderMessages: [
        { role: "user", content: "你平时几点下班呀？" },
        { role: "assistant", content: "我回头给你拍一张下班路上的照片" },
        { role: "user", content: "今天有点累" },
      ],
    });

    expect(prompt).toContain("没聊完的");
    expect(prompt).toContain("你平时几点下班呀");
    expect(prompt).toContain("我上次答应过");
    expect(prompt).toContain("我回头给你拍一张下班路上的照片");
    expect(prompt).toContain("更早的摘要");
    expect(prompt.length).toBeLessThan(1000);
  });

  it("returns empty when there is no older memory", () => {
    expect(buildConversationMemoryPrompt({
      summary: "",
      olderMessages: [],
    })).toBe("");
  });
});
