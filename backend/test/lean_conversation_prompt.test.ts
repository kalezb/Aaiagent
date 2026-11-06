import { describe, expect, it } from "vitest";
import { buildLeanConversationPrompt } from "../functions/api/_lean_conversation_prompt";
import { buildLayeredSystemPrompt } from "../functions/api/_reply_policy";

const base = {
  personaId: "female",
  personaPrompt: "你是王雅慧，对外叫星暮，29岁，重庆人，离异，无子女。做二手手机和废旧数码回收。",
  personaFacts: {
    age_mode: "fixed_age",
    fixed_age: 29,
    marital_status: "divorced",
    has_children: false,
    current_city: "重庆",
    current_district: "两江新区",
    work_city: "重庆",
    work_district: "江北区",
  },
  platform: "soul",
  profileContext: "对方做设计，最近连续加班，不喜欢被反复追问。",
  currentDatetime: "2026-10-17 15:30:00",
  weekday: "星期六",
  homeLocation: { city: "重庆", district: "两江新区" },
  workLocation: { city: "重庆", district: "江北区" },
  weather: null,
  weatherEnabled: false,
  stageText: "熟悉阶段",
  relationStageLevel: 3,
  conversationStage: "familiar",
  relationshipOrigin: "match",
  messages: [{ role: "user", content: "今天开会开得脑袋都木了，你现在忙不忙" }],
  historyMessages: [],
  memorySummary: "【长期记忆】对方最近加班多，提过周末想在家睡觉。",
  mediaGroups: [],
  mediaActionsEnabled: false,
  selfNickname: "另一面的我",
  xingmuSoulScope: true,
  activePersonaScope: "xingmu",
};

describe("lean conversation prompt", () => {
  it("keeps the current turn, stable facts and memory while dropping legacy rule piles", () => {
    const prompt = buildLeanConversationPrompt(base);

    expect(prompt).toContain("【人物事实｜最高优先级】");
    expect(prompt).toContain("现居地：重庆两江新区");
    expect(prompt).toContain("对方最近加班多");
    expect(prompt).toContain("最新对方原话：今天开会开得脑袋都木了，你现在忙不忙");
    expect(prompt).toContain("【输出格式】");
    expect(prompt).not.toContain("【星暮六段漏斗】");
    expect(prompt).not.toContain("你可以自己编");
    expect(prompt).not.toContain("编了就守住");
    expect(prompt.length).toBeLessThan(5000);
  });

  it("is materially smaller than the old layered prompt", () => {
    const lean = buildLeanConversationPrompt(base);
    const full = buildLayeredSystemPrompt({
      ...base,
      personaScope: undefined,
    });

    expect(lean.length).toBeLessThan(full.length);
    expect(full.length - lean.length).toBeGreaterThan(1500);
  });

  it("lets Su Tang naturally ask one personal detail without interrogating", () => {
    const prompt = buildLeanConversationPrompt({
      ...base,
      personaId: "female_sutang",
      activePersonaScope: "sutang",
      messages: [{ role: "user", content: "刚下班，今天累死了" }],
    });

    expect(prompt).toContain("可以自然问对方的工作、年龄、城市、兴趣或生活安排");
    expect(prompt).toContain("一次只问一个");
    expect(prompt).toContain("已经问过、对方答过或刚聊过的话题不要重复问");
    expect(prompt).toContain("通常 1 到 2 条");
    expect(prompt).toContain("整轮最多 25 个字");
  });

  it("injects dynamic micro-step ladder into lean prompt for Su Tang", () => {
    const earlyPrompt = buildLeanConversationPrompt({
      ...base,
      personaId: "female_sutang",
      activePersonaScope: "sutang",
      messages: [{ role: "user", content: "今晚出来开房不" }],
      historyMessages: [
        { role: "user", content: "在吗" },
        { role: "assistant", content: "在的" },
      ],
    });
    expect(earlyPrompt).toContain("【本轮接话重点｜不聊线下私密安排】");
    expect(earlyPrompt).toContain("挡回去");

    const matureHistory = Array.from({ length: 12 }, (_, i) => ({
      role: "user",
      content: `聊过的话题${i}`,
    }));
    const maturePrompt = buildLeanConversationPrompt({
      ...base,
      personaId: "female_sutang",
      activePersonaScope: "sutang",
      messages: [{ role: "user", content: "今晚想见你" }],
      historyMessages: matureHistory,
    });
    expect(maturePrompt).toContain("【本轮接话重点｜婉拒见面】");
  });
});
