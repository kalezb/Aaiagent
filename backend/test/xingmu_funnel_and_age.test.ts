import { describe, expect, it } from "vitest";
import {
  buildXingmuCardPrompt,
  buildXingmuFunnelPrompt,
  hasEvaluationQuote,
  isChildAgeQuestion,
  isExcludedRecycleItem,
  isSelfAgeComparisonQuestion,
  isSelfAgeQuestion,
  localAgeReply,
  localExcludedRecycleReply,
  resolveXingmuEvaluationReply,
  sanitizeXingmuProductLeak,
  XINGMU_FIXED_AGE,
  XINGMU_PRODUCT_REPLY,
} from "../functions/api/_reply_policy";

describe("Xingmu funnel and age rules", () => {
  it("keeps the new recycle scope and rejects excluded items locally", () => {
    expect(isExcludedRecycleItem("旧耳机收不收")).toBe(true);
    expect(isExcludedRecycleItem("充电宝能收吗")).toBe(true);
    expect(isExcludedRecycleItem("旧数据线收吗")).toBe(true);
    expect(isExcludedRecycleItem("旧手表收吗")).toBe(true);
    expect(isExcludedRecycleItem("旧电话手表收吗")).toBe(false);
    expect(isExcludedRecycleItem("我平时戴蓝牙耳机")).toBe(false);
    expect(isExcludedRecycleItem("这个数据线音质不错")).toBe(false);
    expect(isExcludedRecycleItem("我的蓝牙耳机拿出来了")).toBe(false);
    expect(isExcludedRecycleItem("旧手表想处理掉")).toBe(true);
    expect(localExcludedRecycleReply([{ role: "user", content: "蓝牙耳机收不收" }]))
      .toBe("这些不收哈 只收带屏幕、带电池、带电路的旧数码");
    expect(localExcludedRecycleReply([{ role: "user", content: "我平时戴蓝牙耳机" }])).toBe("");
  });

  it("tracks the six-stage funnel and emits the evaluation entry alone", () => {
    expect(resolveXingmuEvaluationReply({
      stage: 5,
      incomingText: "怎么收",
      willingToRecycle: true,
    })).toBe("");
    expect(resolveXingmuEvaluationReply({
      stage: 6,
      incomingText: "这个怎么收",
      willingToRecycle: true,
    })).toBe(XINGMU_PRODUCT_REPLY);
    expect(resolveXingmuEvaluationReply({
      stage: 6,
      incomingText: "收什么",
      willingToRecycle: true,
    })).toBe(XINGMU_PRODUCT_REPLY);
    expect(resolveXingmuEvaluationReply({
      stage: 6,
      incomingText: "寄哪里",
      willingToRecycle: true,
    })).toBe(XINGMU_PRODUCT_REPLY);
    expect(resolveXingmuEvaluationReply({
      stage: 6,
      incomingText: "这个地址怎么处理",
      willingToRecycle: true,
    })).toBe("");
    expect(resolveXingmuEvaluationReply({
      stage: 6,
      incomingText: "家里有",
      willingToRecycle: true,
    })).toBe("");
    expect(resolveXingmuEvaluationReply({
      stage: 6,
      incomingText: "这个怎么收",
      willingToRecycle: false,
    })).toBe("");
    expect(hasEvaluationQuote([{ role: "assistant", content: XINGMU_PRODUCT_REPLY }])).toBe(true);
    expect(resolveXingmuEvaluationReply({
      stage: 6,
      incomingText: "怎么收",
      historyMessages: [{ role: "assistant", content: XINGMU_PRODUCT_REPLY }],
      willingToRecycle: true,
    })).toBe("");
    expect(resolveXingmuEvaluationReply({
      stage: 6,
      incomingText: "怎么收",
      quoteAlreadySent: true,
      willingToRecycle: true,
    })).toBe("");
    expect(buildXingmuFunnelPrompt(6, "怎么收", [], false, {
      userTurnCount: 42,
      completed: false,
    })).toContain("作为一个独立气泡");
  });

  it("keeps the evaluation entry out of ordinary model replies", () => {
    expect(sanitizeXingmuProductLeak("嗯 你先看看", true)).toBe("嗯 你先看看");
    expect(sanitizeXingmuProductLeak("评估报价，搜 shanhs668", true)).toBe("嗯 回头慢慢说");
    expect(sanitizeXingmuProductLeak("嗯 先这样|||评估报价，搜 shanhs668", true)).toBe("嗯 先这样");
    expect(sanitizeXingmuProductLeak("评估报价，搜 shanhs668", false))
      .toBe("评估报价，搜 shanhs668");
  });

  it("injects current-topic Xingmu cards without resurfacing old history", () => {
    const prompt = buildXingmuCardPrompt({
      stage: 2,
      incomingText: "你做什么工作，之前也离过婚吗",
      historyMessages: [{ role: "user", content: "你离过婚吗" }],
    });
    expect((prompt.match(/【命中卡片】/gu) || [])).toHaveLength(2);
    expect(prompt).toContain("上一段关系");
    expect(prompt).toContain("工作吐槽");
    const unrelatedPrompt = buildXingmuCardPrompt({
      stage: 2,
      incomingText: "你做什么工作",
      historyMessages: [{ role: "user", content: "你离过婚吗" }],
    });
    expect(unrelatedPrompt).toContain("工作吐槽");
    expect(unrelatedPrompt).not.toContain("上一段关系");
    expect(buildXingmuCardPrompt({
      stage: 2,
      incomingText: "你孩子做什么工作",
      historyMessages: [],
    })).not.toContain("工作吐槽");
    expect(buildXingmuCardPrompt({
      stage: 2,
      incomingText: "不喜欢",
      historyMessages: [{ role: "assistant", content: "才聊几句就喊宝贝，你这进度条拉太快了" }],
    })).not.toContain("偏好");
    expect(buildXingmuCardPrompt({
      stage: 2,
      incomingText: "你平时喜欢什么",
      historyMessages: [],
    })).toContain("偏好");
  });

  it("answers only self-directed age questions from the active persona", () => {
    expect(isSelfAgeQuestion("你多大了")).toBe(true);
    expect(isSelfAgeQuestion("你几岁")).toBe(true);
    expect(isSelfAgeQuestion("你今年多大")).toBe(true);
    expect(isSelfAgeQuestion("你的年龄")).toBe(true);
    expect(isSelfAgeComparisonQuestion("你比我大还是小")).toBe(true);
    expect(isSelfAgeComparisonQuestion("咱俩谁大")).toBe(true);
    expect(isSelfAgeComparisonQuestion("你孩子多大")).toBe(false);
    expect(isSelfAgeQuestion("你孩子多大")).toBe(false);
    expect(isSelfAgeQuestion("孩子多大了")).toBe(false);
    expect(isChildAgeQuestion("你孩子多大")).toBe(true);
    expect(isChildAgeQuestion("孩子多大了")).toBe(true);
    expect(localAgeReply([{ role: "user", content: "你多大了" }], "你是星暮，29岁女性，重庆人。")).toBe("29呀 你呢");
    expect(localAgeReply([{ role: "user", content: "你几岁" }], "你是陈屿，33岁男性，重庆人。")).toBe("33呀 你呢");
    expect(localAgeReply([{ role: "user", content: "你今年多大" }], "你是星暮，29岁女性，重庆人。")).toBe("29呀 你呢");
    expect(localAgeReply([{ role: "user", content: "你的年龄" }], "你是星暮，29岁女性，重庆人。")).toBe("29呀 你呢");
    expect(localAgeReply(
      [
        { role: "user", content: "我也自己住" },
        { role: "user", content: "我38" },
        { role: "user", content: "我87的" },
        { role: "user", content: "你比我大还是小" },
      ],
      "你是星暮，29岁女性，重庆人。",
      [],
      1_790_000_000,
    )).toBe("我29，你87年的，我比你小。");
    expect(localAgeReply(
      [
        { role: "user", content: "我38" },
        { role: "user", content: "你比我大还是小" },
      ],
      "你是星暮，29岁女性，重庆人。",
      [],
      1_790_000_000,
    )).toBe("我29，比你小9岁。");
    expect(localAgeReply(
      [{ role: "user", content: "你比我大还是小" }],
      "你是星暮，29岁女性，重庆人。",
      [],
      1_790_000_000,
    )).toBe("我29。你哪年的？");
    expect(localAgeReply([{ role: "user", content: "你孩子多大" }], "你是星暮，29岁女性，离异，无子女。"))
      .toBe("我没孩子。");
    expect(localAgeReply([{ role: "user", content: "孩子多大了" }], "你是星暮，29岁女性，离异，无子女。"))
      .toBe("");
    expect(localAgeReply([{ role: "user", content: "你孩子多大" }], "你是星暮，29岁女性。")).toBe("");
    expect(localAgeReply([{ role: "user", content: "你爸多大" }], "你是星暮，29岁女性，离异，无子女。")).toBe("");
    expect(localAgeReply([{ role: "user", content: "今天真累" }], "你是星暮，29岁女性。")).toBe("");
    expect(localAgeReply([{ role: "user", content: "你多大了" }], "没有年龄的人设")).toBe("");
    expect(localAgeReply(
      [{ role: "user", content: "你多大了" }],
      "你是星暮，没有写年龄。",
      [],
      undefined,
      XINGMU_FIXED_AGE,
    )).toBe("29呀 你呢");
    expect(localAgeReply(
      [{ role: "user", content: "你是哪年生的" }],
      "你是星暮，没有写年龄。",
      [],
      undefined,
      XINGMU_FIXED_AGE,
    )).toBe("29呀 你呢");
    expect(localAgeReply(
      [{ role: "user", content: "你多大了" }],
      "你是星暮，29岁女性，重庆人。",
      [{ role: "assistant", content: "29呀 你呢", created_at: 1_790_000_000 - 30 }],
      1_790_000_000,
    )).toBe("刚说过了呀 我29");
  });
});
