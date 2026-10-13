import { describe, expect, it } from "vitest";
import {
  buildLayeredSystemPrompt,
  buildRelationshipBoundaryPrompt,
  buildTurnBrief,
  isIntimateTopic,
  replyGenerationSettings,
} from "../functions/api/_reply_policy";

describe("turn context and platform nickname", () => {
  it("treats an elliptical follow-up like 多久啦 as continuing the last question", () => {
    const history = [
      { role: "user", content: "我说你多久没有了" },
      { role: "assistant", content: "这种事哪能随口答你" },
    ];
    const brief = buildTurnBrief({
      messages: [{ role: "user", content: "多久啦" }],
      historyMessages: history,
      relationStageLevel: 2,
    });
    expect(brief).toContain("【短句理解】");
    expect(brief).toContain("顺着那个意思接一句");
    expect(brief).toContain("不能装作没听懂");
    expect(brief).toContain("禁止说“没头没尾");
    expect(brief).not.toContain("直接给出你的态度或答案");

    // 2026-10-11 真机（WuDi）原样复现：他先问“你多久没有那事”，隔几轮只丢一句“多久啦”。
    // 这种续追必须走“隐晦接住”，不能让模型自己去装糊涂。
    const wudiHistory = [
      { role: "user", content: "可以问你私人问题吗" },
      { role: "assistant", content: "私人问题可以问" },
      { role: "user", content: "你多久没有啦" },
      { role: "assistant", content: "这问题问得挺直接" },
      { role: "user", content: "多久没有那事？" },
      { role: "assistant", content: "这问题得看谁问的" },
      { role: "assistant", content: "这种事哪能随口答你" },
      { role: "user", content: "我说你多久了没有了" },
      { role: "user", content: "不是跟你做" },
      { role: "assistant", content: "你倒是急 还专门解释一句" },
    ];
    expect(isIntimateTopic("多久啦", wudiHistory)).toBe(true);
    const wudiBoundary = buildRelationshipBoundaryPrompt(2, "多久啦", wudiHistory);
    expect(wudiBoundary).toContain("【暧昧边界-隐晦】");
    expect(wudiBoundary).toContain("不许装听不懂");
    expect(wudiBoundary).toContain("不许报数字");
    expect(wudiBoundary).not.toContain("见面边界");

    // 整条提示词拼起来也要能同时出现“短句理解”和“隐晦接住”，别只在单测里成立。
    const wudiSystem = buildLayeredSystemPrompt({
      personaId: "female",
      personaPrompt: "你是苏棠。",
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-11 02:38:00",
      weekday: "星期六",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "两江新区" },
      weather: "",
      stageText: "已经聊过几次",
      relationStageLevel: 2,
      messages: [{ role: "user", content: "多久啦" }],
      historyMessages: wudiHistory,
    });
    expect(wudiSystem).toContain("【短句理解】");
    expect(wudiSystem).toContain("【暧昧边界-隐晦】");
    expect(wudiSystem).toContain("不许装听不懂");
  });

  it("keeps an intimate topic going when the new sentence alone is vague", () => {
    const intimateHistory = [
      { role: "user", content: "可以问你私人问题吗" },
      { role: "assistant", content: "私人问题可以问" },
      { role: "user", content: "你老公那方面行不行啊？" },
      { role: "assistant", content: "这种事哪能随口答你" },
    ];
    // 前面刚聊过那件事：这句“想不想啊”顺着当同一件事接住。
    expect(isIntimateTopic("你最近想不想啊？", intimateHistory)).toBe(true);
    expect(isIntimateTopic("要不要试试", intimateHistory)).toBe(true);
    expect(buildRelationshipBoundaryPrompt(2, "你最近想不想啊？", intimateHistory))
      .toContain("【暧昧边界-隐晦】");

    // 前面压根没提过那件事：走普通聊天，不能硬往那件事上套。
    expect(isIntimateTopic("你最近想不想啊？", [{ role: "user", content: "今天天气不错" }])).toBe(false);
    expect(isIntimateTopic("要不要试试", [{ role: "user", content: "周末去吃火锅吗" }])).toBe(false);
    expect(buildRelationshipBoundaryPrompt(2, "要不要试试", [{ role: "user", content: "周末去吃火锅吗" }])).toBe("");

    // 字面自己就能认出来的，不用靠前面几轮。
    expect(isIntimateTopic("你多久没有那事？", [])).toBe(true);
    expect(isIntimateTopic("你多久没那啥了", [])).toBe(true);
    expect(isIntimateTopic("那事你怎么解决的", [])).toBe(true);
    expect(isIntimateTopic("你老公满足得了你吗", [])).toBe(true);

    // 正常的事不能被误伤。
    expect(isIntimateTopic("那事办得怎么样了", [])).toBe(false);
    expect(isIntimateTopic("我弟弟最近是很难受", [])).toBe(false);
    expect(isIntimateTopic("今天天气不错", [])).toBe(false);
    expect(buildRelationshipBoundaryPrompt(2, "那事办得怎么样了", [])).toBe("");
  });

  it("injects the current platform account nickname", () => {
    const prompt = buildLayeredSystemPrompt({
      personaPrompt: "你是星皮。",
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-01 18:30:00",
      weekday: "星期四",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "两江新区" },
      weather: "",
      stageText: "刚认识",
      relationStageLevel: 1,
      messageDelay: null,
      messages: [{ role: "user", content: "你为什么叫另一面的我" }],
      historyMessages: [],
      selfNickname: "另一面的我",
    });

    expect(prompt).toContain("【当前平台账号昵称】你在soul上的账号昵称是“另一面的我”");
    expect(prompt).toContain("不代表其他平台昵称");
  });

  it("uses enough token room for natural replies without encouraging long chat messages", () => {
    expect(replyGenerationSettings([{ role: "user", content: "你好" }], null, {}).maxTokens).toBe(96);
    expect(replyGenerationSettings(
      [{ role: "user", content: "你好" }],
      { messageType: "greeting" },
      {},
    ).maxTokens).toBe(56);
    expect(replyGenerationSettings(
      [{ role: "user", content: "旧手机还收吗" }],
      { messageType: "business" },
      {},
    ).maxTokens).toBe(160);
  });
});
