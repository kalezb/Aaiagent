import { describe, expect, it } from "vitest";
import { buildConversationTimeStatePrompt } from "../functions/api/_conversation_time_state";
import { buildLayeredSystemPrompt } from "../functions/api/_reply_policy";

function epoch(value: string) {
  return Math.floor(Date.parse(value) / 1000);
}

describe("conversation time state", () => {
  it("marks a morning message after a long night gap as a new conversation", () => {
    const currentMessages = [{
      role: "user",
      content: "我一直都睡的挺晚的",
      created_at: epoch("2026-10-18T09:22:00+08:00"),
      time_kind: "ui_explicit",
    }];
    const historyMessages = [
      {
        role: "user",
        content: "hello",
        created_at: epoch("2026-10-18T00:24:00+08:00"),
        time_kind: "ui_explicit",
      },
      {
        role: "assistant",
        content: "我也准备躺下了",
        created_at: epoch("2026-10-18T09:21:00+08:00"),
        time_kind: "first_observed",
      },
      {
        role: "user",
        content: "我一直都睡的挺晚的",
        created_at: epoch("2026-10-18T09:22:00+08:00"),
        time_kind: "ui_explicit",
      },
    ];
    const prompt = buildConversationTimeStatePrompt(
      currentMessages,
      historyMessages,
      "2026-10-18 11:35:00",
    );

    expect(prompt).toContain("这是新一段对话");
    expect(prompt).toContain("旧对话已经结束");
    expect(prompt).toContain("我也准备躺下了");
    expect(prompt).toContain("不能把睡觉、吃饭、上班、出门、忙碌等旧状态续到现在");
    expect(prompt).toContain("他这条已经放了2小时13分钟");

    const fullPrompt = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: "你是苏棠，29岁，已婚，在家带娃。",
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-18 11:35:00",
      weekday: "星期日",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "两江新区" },
      weather: null,
      timeEnabled: true,
      stageText: "",
      relationStageLevel: 1,
      messageDelay: null,
      messages: currentMessages,
      historyMessages,
      xingmuSoulScope: false,
    });
    expect(fullPrompt).toContain("【对话时间状态｜代码已判定】");
    expect(fullPrompt).toContain("旧对话已经结束");
  });

  it("keeps a continuous conversation in the same session", () => {
    const prompt = buildConversationTimeStatePrompt([
      {
        role: "user",
        content: "刚吃完饭",
        created_at: epoch("2026-10-18T11:21:00+08:00"),
        time_kind: "ui_explicit",
      },
    ], [
      {
        role: "user",
        content: "中午吃什么",
        created_at: epoch("2026-10-18T11:20:00+08:00"),
        time_kind: "ui_explicit",
      },
      {
        role: "assistant",
        content: "你猜",
        created_at: epoch("2026-10-18T11:20:30+08:00"),
        time_kind: "ui_explicit",
      },
    ], "2026-10-18 11:22:00");

    expect(prompt).not.toContain("这是新一段对话");
    expect(prompt).not.toContain("旧对话已经结束");
  });
});
