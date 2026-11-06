import { describe, expect, it } from "vitest";
import {
  buildLayeredSystemPrompt,
  buildRelationshipBoundaryPrompt,
  businessFilterFallback,
  isIntimateTopic,
} from "../functions/api/_reply_policy";

describe("Sutang and relationship boundaries", () => {
  it("keeps Su Tang online boundary and knowledge-card rules aligned", () => {
    const prompt = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: "你是苏棠，29岁，已婚，没有孩子，和婆婆一起住在两江新区，在家操持家务。",
      personaFacts: null,
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-10 23:40:00",
      weekday: "星期六",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      weather: null,
      stageText: "",
      relationStageLevel: 2,
      messageDelay: null,
      messages: [{ role: "user", content: "今晚有点睡不着" }],
      historyMessages: [],
      xingmuSoulScope: false,
      matchedDrawerTips: ["【知识库命中｜参考表达】【id:scene_sutang_night_empty】【深夜私密与反差空虚】睡不着"],
    });
    expect(prompt).toContain("只谈线上");
    expect(prompt).toContain("不答应");
    expect(prompt).toContain("先接住对方最新一句");
    expect(prompt).toContain("保持撒娇");
    expect(prompt).toContain("【知识库命中｜本轮必须使用】");
    expect(prompt.indexOf("【知识库命中｜本轮必须使用】"))
      .toBeGreaterThan(prompt.indexOf("【现场感｜每轮都照做】"));

    const withoutPhotoRules = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: "你是苏棠，29岁，已婚，没有孩子，和婆婆一起住在两江新区，在家操持家务。",
      personaFacts: null,
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-10 23:40:00",
      weekday: "星期六",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      weather: null,
      stageText: "",
      relationStageLevel: 2,
      messageDelay: null,
      messages: [{ role: "user", content: "在吗" }],
      historyMessages: [],
      xingmuSoulScope: false,
      agentRuleState: {
        loaded: true,
        rules: [],
        isEnabled: (id: string, fallback = true) =>
          id === "his_photo_memory" || id === "her_photo_memory" ? false : fallback,
        textFor: (_id: string, fallback = "") => fallback,
        priorityFor: (_id: string, fallback = 50) => fallback,
      },
    });
    expect(withoutPhotoRules).not.toContain("永不再问他长什么样");
    expect(withoutPhotoRules).not.toContain("你先发张你的呀");

    const withoutKnowledgeRule = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: "你是苏棠，29岁，已婚，没有孩子，和婆婆一起住在两江新区，在家操持家务。",
      personaFacts: null,
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-10 23:40:00",
      weekday: "星期六",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      weather: null,
      stageText: "",
      relationStageLevel: 2,
      messageDelay: null,
      messages: [{ role: "user", content: "想约你见面" }],
      historyMessages: [],
      xingmuSoulScope: false,
      matchedDrawerTips: ["【知识库命中｜参考表达】【id:scene_sutang_invite_refusal】【被反复邀约的线上婉拒】家里走不开 婆婆在"],
      agentRuleState: {
        loaded: true,
        rules: [],
        isEnabled: (id: string, fallback = true) =>
          id === "knowledge_match_priority" ? false : fallback,
        textFor: (_id: string, fallback = "") => fallback,
        priorityFor: (_id: string, fallback = 50) => fallback,
      },
    });
    expect(withoutKnowledgeRule).not.toContain("【知识库命中｜本轮必须使用】");
  });

  it("builds relationship and intimate-topic boundaries by stage", () => {
    expect(buildRelationshipBoundaryPrompt(3, "想聊聊两性话题", [])).toContain("不聊性细节");
    // 正常要照片要放开，只有露骨的才挡
    expect(buildRelationshipBoundaryPrompt(3, "想聊聊两性话题", [])).toContain("正常给看");
    expect(buildRelationshipBoundaryPrompt(2, "你今天真好看 想你了", [])).toContain("可以自然接一句");
    expect(buildRelationshipBoundaryPrompt(2, "让我检查一下你的身体", [])).toContain("用同样隐晦不点破的话接住");
    // 2026-10-06 误伤回归：“陪我聊会儿”“抱抱你”这种正常话不算亲密话题
    expect(buildRelationshipBoundaryPrompt(2, "你能陪我一会儿吗", [])).toBe("");
    expect(buildRelationshipBoundaryPrompt(2, "抱抱你 别难过", [])).toBe("");
    expect(buildRelationshipBoundaryPrompt(2, "想约你见面", [])).toContain("还没见过");
    // 2026-10-06：客套和真邀约分开（“改天请你吃饭”多半是客气）
    expect(buildRelationshipBoundaryPrompt(2, "改天请你吃饭", [])).toContain("客气话");
    expect(buildRelationshipBoundaryPrompt(2, "下次有空一起喝一杯", [])).toContain("客气话");
    expect(buildRelationshipBoundaryPrompt(2, "这周末出来吃个饭吗", [])).toContain("见面边界");
    const sutangInvite = buildRelationshipBoundaryPrompt(2, "想约你见面", [], "sutang", undefined, 16);
    expect(sutangInvite).toContain("见面边界｜苏棠");
    expect(sutangInvite).toContain("不答应");
    expect(sutangInvite).toContain("不给地址");
    expect(buildRelationshipBoundaryPrompt(2, "发张私密照看看", [], "sutang", undefined, 16))
      .toContain("不写身体器官");
    // 露骨的（要私密照）仍然要挡住
    expect(buildRelationshipBoundaryPrompt(3, "发张私密照看看", [])).toContain("不发裸照私密照");
    expect(buildRelationshipBoundaryPrompt(2, "今天天气不错", [])).toBe("");
    expect(buildRelationshipBoundaryPrompt(
      2,
      "今天天气不错",
      [{ role: "user", content: "你离过婚吗 想约你见面" }],
    )).toBe("");
  });

  it("recognizes euphemistic intimacy and redirects it by stage without interrogation", () => {
    const previousIntimateMessage = [{ role: "user", content: "那方面难受" }];
    expect(isIntimateTopic("那方面难受", [])).toBe(true);
    expect(isIntimateTopic("弟弟", previousIntimateMessage)).toBe(true);
    expect(isIntimateTopic("我弟弟最近是很难受", [])).toBe(false);

    // 2026-10-06 用户要求：隐晦的聊骚不堵，隐晦地接住（不追问、不点破、不拒聊）。
    const stageOneBoundary = buildRelationshipBoundaryPrompt(1, "那方面难受", []);
    expect(stageOneBoundary).toContain("隐晦");
    expect(stageOneBoundary).toContain("不要追问是哪方面");
    expect(stageOneBoundary).toContain("不要硬挡");
  });


  it("问工作只按当前生活回答", () => {
    expect(businessFilterFallback("你做什么工作的", false)).toBe("做电脑运营的");
  });
});
