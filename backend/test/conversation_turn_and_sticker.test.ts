import { describe, expect, it } from "vitest";
import {
  latestIncomingText,
  isGreetingStickerContent,
  isStickerOnlyTurn,
} from "../functions/api/_message_text";
import {
  buildConversationTurnMessages,
  normalizeConversationTurnContext,
} from "../functions/api/_conversation_turn";
import {
  SUTANG_ACTION_LADDER_RULE,
  buildSituationTimeline,
} from "../functions/api/_reply_policy";

describe("conversation turns and sticker state", () => {
  it("keeps a short answer together with the question it answers", () => {
    const turns = buildConversationTurnMessages({
      historyMessages: [
        {
          role: "assistant",
          content: "璧山离我这边不近哦 你跑那么远干嘛|||一起玩 玩什么呀",
          created_at: 1000,
        },
      ],
      currentMessages: [
        { role: "user", content: "我", created_at: 1010 },
        { role: "user", content: "[小害羞]", created_at: 1011 },
      ],
      nowSec: 1020,
    });

    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toContain("把这一问一答连起来理解");
    expect(turns[0].content).toContain("我问：一起玩 玩什么呀");
    expect(turns[0].content).toContain("对方回：我");
    expect(turns[0].content).toContain("对方还发了个表情：[小害羞]");
  });

  it("normalizes the whole short-answer turn before the prompt is built", () => {
    const normalized = normalizeConversationTurnContext({
      historyMessages: [
        {
          role: "assistant",
          content: "璧山离我这边不近哦 你跑那么远干嘛|||一起玩 玩什么呀",
        },
      ],
      currentMessages: [
        { role: "user", content: "我" },
        { role: "user", content: "[小害羞]" },
      ],
    });

    expect(normalized.historyMessages).toHaveLength(0);
    expect(normalized.currentMessages).toHaveLength(1);
    expect(normalized.currentMessages[0].content).toContain("我问：一起玩 玩什么呀");
    expect(normalized.currentMessages[0].content).toContain("对方回：我");
  });

  it("uses the text as the message body and the sticker as tone", () => {
    expect(latestIncomingText([
      { role: "user", content: "我" },
      { role: "user", content: "[小害羞]" },
    ])).toBe("我");
    expect(latestIncomingText([
      { role: "user", content: "[小害羞]" },
    ])).toBe("[小害羞]");
  });

  it("distinguishes pure sticker state from greeting stickers", () => {
    expect(isStickerOnlyTurn([
      { role: "user", content: "[小害羞]" },
      { role: "user", content: "[表情包：偷笑（偷着乐）]" },
    ])).toBe(true);
    expect(isStickerOnlyTurn([
      { role: "user", content: "我" },
      { role: "user", content: "[小害羞]" },
    ])).toBe(false);
    expect(isGreetingStickerContent("对方发来时段问候表情「晚安」")).toBe(true);
    expect(isGreetingStickerContent("对方发来 Soul 官方表情「你好」")).toBe(true);
    expect(isGreetingStickerContent("[小害羞]")).toBe(false);
  });

  it("shows the whole current turn instead of only the last sticker", () => {
    const timeline = buildSituationTimeline(
      [
        { role: "user", content: "我" },
        { role: "user", content: "[小害羞]" },
      ],
      [{ role: "assistant", content: "一起玩 玩什么呀", created_at: 900 }],
    );

    expect(timeline).toContain("他这轮说");
    expect(timeline).toContain("我 / [小害羞]");
    expect(timeline).toContain("同一轮连着发来的消息");
    expect(timeline).toContain("这是紧挨着的一问一答");
    expect(timeline).toContain("你上一句「一起玩 玩什么呀」");
    expect(timeline).not.toContain("这轮要处理的就是他最新这一条");
  });

  it("does not force high-pressure questioning in the Sutang default rule", () => {
    expect(SUTANG_ACTION_LADDER_RULE).not.toContain("高位反问制止");
    expect(SUTANG_ACTION_LADDER_RULE).toContain("先听懂对方这轮完整意思");
  });
});
