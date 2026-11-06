import { describe, expect, it } from "vitest";
import {
  MODEL_CONTEXT_EXCHANGES,
  MODEL_CONTEXT_MAX_MESSAGES,
  MODEL_CONTEXT_MAX_CHARS,
  selectRecentConversationTurns,
} from "../functions/api/_conversation_turn";

describe("model conversation context window", () => {
  it("keeps only the latest ten complete exchanges", () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message-${index + 1}`,
    }));

    const selected = selectRecentConversationTurns(messages);

    expect(selected).toHaveLength(20);
    expect(selected[0]).toMatchObject({ role: "user", content: "message-1" });
    expect(selected.at(-1)).toMatchObject({ role: "assistant", content: "message-20" });
  });

  it("keeps consecutive short bubbles in the same exchange", () => {
    const messages = [
      { role: "user", content: "在吗" },
      { role: "user", content: "问你个事" },
      { role: "assistant", content: "在" },
      { role: "assistant", content: "你说" },
      { role: "user", content: "今天忙不忙" },
      { role: "assistant", content: "刚忙完" },
    ];

    const selected = selectRecentConversationTurns(messages, 1);

    expect(selected.map((message) => message.content)).toEqual([
      "今天忙不忙",
      "刚忙完",
    ]);
  });

  it("limits raw messages without splitting a continuous role block", () => {
    const messages = Array.from({ length: 12 }, (_, exchange) => [
      { role: "user", content: `u-${exchange}-1` },
      { role: "user", content: `u-${exchange}-2` },
      { role: "assistant", content: `a-${exchange}-1` },
      { role: "assistant", content: `a-${exchange}-2` },
    ]).flat();

    const selected = selectRecentConversationTurns(messages);

    expect(selected.length).toBeLessThanOrEqual(MODEL_CONTEXT_MAX_MESSAGES);
    expect(selected.length % 2).toBe(0);
    expect(selected[0].role).toBe("user");
    expect(selected[1].role).toBe("user");
  });

  it("drops older complete turns when the recent chat is too long", () => {
    const long = "这是一条很长但必须整组保留的聊天内容".repeat(20);
    const messages = Array.from({ length: 12 }, (_, exchange) => [
      { role: "user", content: `${exchange}-${long}` },
      { role: "assistant", content: `${exchange}-${long}` },
    ]).flat();

    const selected = selectRecentConversationTurns(
      messages,
      MODEL_CONTEXT_EXCHANGES,
      MODEL_CONTEXT_MAX_MESSAGES,
      MODEL_CONTEXT_MAX_CHARS,
    );

    const chars = selected.reduce((total, message) => total + message.content.length, 0);
    expect(chars).toBeLessThanOrEqual(MODEL_CONTEXT_MAX_CHARS);
    expect(selected.at(-1)?.content).toContain("11-");
  });
});
