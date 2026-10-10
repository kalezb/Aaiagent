import { describe, expect, it } from "vitest";
import {
  applyReplyDecisionPipeline,
  createImmediateReplyDecision,
} from "../functions/api/_reply_decision";
import {
  buildGenericLowSignalRepairPrompt,
  shouldRepairGenericLowSignalReply,
} from "../functions/api/_reply_policy";

describe("reply decision pipeline", () => {
  it("keeps an unmodified model reply and records no override", () => {
    const result = applyReplyDecisionPipeline("在的，怎么了？", [
      { rule: "noop", apply: (value) => value },
    ]);

    expect(result.reply).toBe("在的，怎么了？");
    expect(result.overrides).toEqual([]);
  });

  it("records the rule and both sides when a safety step replaces a reply", () => {
    const result = applyReplyDecisionPipeline("宝宝，想你了", [
      {
        rule: "boundary",
        reason: "too_intimate",
        apply: () => "这个先打住。",
      },
    ]);

    expect(result.reply).toBe("这个先打住。");
    expect(result.overrides).toEqual([
      {
        rule: "boundary",
        reason: "too_intimate",
        before: "宝宝，想你了",
        after: "这个先打住。",
      },
    ]);
  });

  it("preserves rule order and records every effective override", () => {
    const result = applyReplyDecisionPipeline("一", [
      { rule: "first", apply: () => "二" },
      { rule: "second", apply: () => "三" },
    ]);

    expect(result.reply).toBe("三");
    expect(result.overrides.map((item) => item.rule)).toEqual(["first", "second"]);
    expect(result.overrides[0].before).toBe("一");
    expect(result.overrides[0].after).toBe("二");
    expect(result.overrides[1].before).toBe("二");
    expect(result.overrides[1].after).toBe("三");
  });

  it("describes an immediate hard-rule decision explicitly", () => {
    expect(
      createImmediateReplyDecision(
        "local_voice",
        "voice_call_request",
        "我不喜欢语音聊天",
        { priority: 10 },
      ),
    ).toEqual({
      source: "local_voice",
      reason: "voice_call_request",
      content: "我不喜欢语音聊天",
      extra: { priority: 10 },
    });
  });

  it("can point at an already persisted pending reply", () => {
    expect(
      createImmediateReplyDecision(
        "pending_evaluation",
        "existing_evaluation_reply",
        "评估报价，搜 shanhs668",
        {},
        "reply-1",
      ),
    ).toEqual({
      source: "pending_evaluation",
      reason: "existing_evaluation_reply",
      content: "评估报价，搜 shanhs668",
      replyId: "reply-1",
      extra: {},
    });
  });

  it("rejects a low-context acknowledgement when the user asked something concrete", () => {
    expect(
      shouldRepairGenericLowSignalReply(
        "嗯，怎么了",
        [{ role: "user", content: "我今天被领导说了，心里挺烦的" }],
      ),
    ).toBe(true);
    expect(
      shouldRepairGenericLowSignalReply(
        "然后呢",
        [{ role: "user", content: "你觉得我该怎么跟他说" }],
      ),
    ).toBe(true);
  });

  it("keeps a short acknowledgement when the user only acknowledged something", () => {
    expect(
      shouldRepairGenericLowSignalReply(
        "收到",
        [{ role: "user", content: "嗯" }],
      ),
    ).toBe(false);
    expect(
      shouldRepairGenericLowSignalReply(
        "收到了",
        [{ role: "user", content: "你收到我发的消息了吗" }],
      ),
    ).toBe(false);
  });

  it("builds a repair prompt from the latest context without a canned fallback", () => {
    const prompt = buildGenericLowSignalRepairPrompt(
      "嗯，怎么了",
      [{ role: "user", content: "我今天有点难受" }],
      [{ role: "assistant", content: "怎么了？" }],
    );

    expect(prompt).toContain("我今天有点难受");
    expect(prompt).toContain("嗯，怎么了");
    expect(prompt).toContain("只输出一条自然、具体、简短的新回复");
  });
});
