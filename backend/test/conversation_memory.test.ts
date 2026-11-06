import { describe, expect, it } from "vitest";
import {
  buildConversationMemoryPrompt,
  captureUserMemoryBeforeReply,
  mergeConversationMemory,
  normalizeConversationMemory,
} from "../functions/api/_conversation_memory";
import { MockD1 } from "./chat-test-helpers";

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

  it("stores facts, preferences, promises and open threads separately", () => {
    const memory = mergeConversationMemory({
      previous: {
        open_threads: ["你是做什么工作的？"],
      },
      messages: [
        { role: "user", content: "我在两江新区，平时喜欢喝咖啡" },
        { role: "user", content: "你几点下班呀？" },
      ],
      assistantReply: "我回头给你拍一张下班路上的照片，你几点方便？",
      relationshipStage: "familiar",
      nowSec: 123,
    });

    expect(memory.facts.join("")).toContain("两江新区");
    expect(memory.preferences.join("")).toContain("喜欢喝咖啡");
    expect(memory.promises.join("")).toContain("拍一张下班路上的照片");
    expect(memory.last_user_question).toContain("几点下班");
    expect(memory.last_assistant_question).toContain("几点方便");
    expect(memory.last_topic).toContain("你几点下班");
    expect(memory.relationship_stage).toBe("familiar");
  });

  it("keeps future plans and the user's last question available next turn", () => {
    const memory = mergeConversationMemory({
      messages: [
        { role: "user", content: "明天去南坪喝咖啡 一个人？" },
      ],
      assistantReply: "一个人去呀 要不要找个人陪",
      relationshipStage: "familiar",
      nowSec: 456,
    });

    expect(memory.open_threads.join("")).toContain("明天去南坪喝咖啡");
    expect(memory.last_user_question).toContain("一个人");

    const prompt = buildConversationMemoryPrompt({ memory });
    expect(prompt).toContain("没聊完");
    expect(prompt).toContain("明天去南坪喝咖啡");
    expect(prompt).toContain("对方上一轮问过");
    expect(prompt).toContain("已经回答过就不要重复回答");
    expect(prompt.length).toBeLessThan(800);
  });

  it("keeps a bounded set of the newest unfinished threads", () => {
    const memory = mergeConversationMemory({
      previous: {
        open_threads: ["旧约一", "旧约二", "旧约三", "旧约四", "旧约五", "旧约六", "旧约七"],
      },
      messages: [
        { role: "user", content: "周末一起吃饭吗" },
      ],
      assistantReply: "周末几点方便",
      nowSec: 789,
    });

    expect(memory.open_threads).toHaveLength(6);
    expect(memory.open_threads.at(-1)).toContain("周末几点方便");
    expect(memory.open_threads.join("")).toContain("周末一起吃饭");
    expect(memory.open_threads.join("")).not.toContain("旧约一");
  });

  it("saves user-side plans before the model has answered", async () => {
    const db = new MockD1();
    const saved = await captureUserMemoryBeforeReply({
      db,
      token: "test-token",
      platform: "soul",
      contactId: "memory-contact",
      previous: {},
      messages: [
        { role: "user", content: "明天去南坪喝咖啡 一个人？" },
      ],
      relationshipStage: "familiar",
      nowSec: 999,
    });

    expect(saved.open_threads.join("")).toContain("明天去南坪喝咖啡");
    expect(saved.last_user_question).toContain("一个人");
    expect(db.conversationMemoryRows.size).toBe(1);
  });

  it("keeps source, time and expiry on memory cards and hides inactive cards", () => {
    const now = 1_800_000_000;
    const memory = mergeConversationMemory({
      messages: [
        {
          role: "user",
          content: "我住两江新区，明天去面试",
          client_message_id: "source-message-1",
          created_at: now - 30,
        },
      ],
      assistantReply: "行，面试完跟我说结果",
      relationshipStage: "familiar",
      nowSec: now,
    });

    const fact = memory.cards.find((card) => card.kind === "fact");
    const thread = memory.cards.find((card) => card.kind === "open_thread");
    expect(fact?.source_message_id).toBe("source-message-1");
    expect(fact?.learned_at).toBe(now - 30);
    expect(thread?.expires_at).toBeGreaterThan(now);

    const withInactive = normalizeConversationMemory({
      ...memory,
      cards: [
        ...memory.cards,
        {
          id: "expired-fact",
          kind: "fact",
          text: "已经过期的旧事实",
          source_role: "user",
          source_message_id: "old",
          learned_at: 1,
          expires_at: now - 1,
          status: "active",
        },
        {
          id: "resolved-thread",
          kind: "open_thread",
          text: "已经办完的事",
          source_role: "user",
          source_message_id: "old-2",
          learned_at: 1,
          expires_at: 0,
          status: "resolved",
        },
      ],
    });
    const prompt = buildConversationMemoryPrompt({ memory: withInactive, nowSec: now });
    expect(prompt).not.toContain("已经过期的旧事实");
    expect(prompt).not.toContain("已经办完的事");
  });
});
