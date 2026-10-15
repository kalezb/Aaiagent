import { describe, expect, it } from "vitest";
import {
  buildLayeredSystemPrompt,
  buildRelationshipBoundaryPrompt,
  businessFilterFallback,
  EMPTY_REPLY_FALLBACK,
  isIntimateTopic,
  normalizeAssistantReplyPresentation,
  sanitizeBusinessTopicDrift,
  sanitizeIntimateTopicReply,
  shouldRepairXingmuLowContextReply,
} from "../functions/api/_reply_policy";

describe("Sutang and relationship boundaries", () => {
  it("keeps Su Tang meeting, night and knowledge-card rules aligned", () => {
    const prompt = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: "你是苏棠，29岁，重庆人，做电商运营。",
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
      matchedDrawerTips: ["【知识库命中｜参考表达】【id:scene_10_insomnia】【深夜失眠与空间失重】睡不着"],
    });
    expect(prompt).toContain("苏棠遇到见面、独处、酒店或现实安排时");
    expect(prompt).toContain("在Soul上严格筛选，男方真诚愿意付出、达成酒店独处共识后才放行豆瓣自留地");
    expect(prompt).toContain("1次认可 + 1次具体推进");
    expect(prompt).toContain("300元以上像样的舒适型连锁");
    expect(prompt).toContain("排查针孔偷拍等设备保护隐私");
    expect(prompt).not.toContain("最终奖励");
    expect(prompt).not.toContain("不主动提见面、不主动推销或催单");
    expect(prompt).not.toContain("【别拿睡觉当话题】");
    expect(prompt).toContain("【知识库命中｜本轮必须使用】");
    expect(prompt.indexOf("【知识库命中｜本轮必须使用】"))
      .toBeGreaterThan(prompt.indexOf("【现场感｜每轮都照做】"));

    const withoutPhotoRules = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: "你是苏棠，29岁，重庆人，做电商运营。",
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

    const withoutMeetingOrKnowledgeRules = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: "你是苏棠，29岁，重庆人，做电商运营。",
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
      matchedDrawerTips: ["【知识库命中｜参考表达】【id:scene_13_invitation_reward】【面对邀约与最终奖励】内容"],
      agentRuleState: {
        loaded: true,
        rules: [],
        isEnabled: (id: string, fallback = true) =>
          id === "sutang_meeting_reward_rule" || id === "knowledge_match_priority"
            ? false
            : fallback,
        textFor: (_id: string, fallback = "") => fallback,
        priorityFor: (_id: string, fallback = 50) => fallback,
      },
    });
    expect(withoutMeetingOrKnowledgeRules).not.toContain("【邀约与最终奖励】");
    expect(withoutMeetingOrKnowledgeRules).not.toContain("【知识库命中｜本轮必须使用】");
  });

  it("builds relationship and intimate-topic boundaries by stage", () => {
    expect(buildRelationshipBoundaryPrompt(1, "你离过婚吗", [])).toContain("离过婚，现在一个人住");
    expect(buildRelationshipBoundaryPrompt(2, "为什么离婚", [])).toContain("说得很漂亮却没有行动");
    expect(buildRelationshipBoundaryPrompt(4, "上一段关系是怎么回事", [])).toContain("真正怕的是又变成一直主动的人");
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
    expect(buildRelationshipBoundaryPrompt(4, "想约你见面", [])).toContain("对方主动提出时可以认真接住");
    const sutangInvite = buildRelationshipBoundaryPrompt(2, "想约你见面", [], "sutang");
    expect(sutangInvite).toContain("邀约与线下独处推进");
    expect(sutangInvite).toContain("坦荡正视成年人吸引力与私密需求");
    expect(sutangInvite).toContain("300元以上像样舒适型连锁");
    expect(sutangInvite).toContain("排查针孔偷拍等设备保护隐私");
    const sutangRoom = buildRelationshipBoundaryPrompt(2, "想跟你开房", [], "sutang");
    expect(sutangRoom).toContain("300元以上像样舒适型连锁");
    expect(sutangRoom).toContain("在Soul上严禁出现“代付”二字");
    expect(sutangRoom).not.toContain("不答应见面");
    expect(buildRelationshipBoundaryPrompt(2, "发张私密照看看", [], "sutang")).toContain("不发裸照私密照");
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

    const stageFourBoundary = buildRelationshipBoundaryPrompt(4, "想那个", []);
    expect(stageFourBoundary).toContain("同样隐晦");
    expect(stageFourBoundary).toContain("旧手机");

    // 2026-10-06 用户选 C 方案：不再用固定拒绝句。单段内容删掉后没别的可留，就保留模型原话。
    expect(sanitizeIntimateTopicReply("哪方面啊，说清楚点", "那方面难受", [], 1))
      .toBe("哪方面啊，说清楚点");
    expect(sanitizeIntimateTopicReply(
      "弟弟，那你直说。我这边一个人住，听着呢？",
      "弟弟",
      previousIntimateMessage,
      1,
    )).toBe("弟弟，那你直说。我这边一个人住，听着呢？");
    // 固定拒绝句不许再出现
    expect(sanitizeIntimateTopicReply("哪方面啊，说清楚点", "那方面难受", [], 1))
      .not.toContain("我接不住");
    expect(sanitizeIntimateTopicReply(
      "哈哈，这个先打住。你家那堆旧数码翻得怎么样了？",
      "想那个",
      [],
      4,
    )).toBe("哈哈，这个先打住。你家那堆旧数码翻得怎么样了？");
    expect(sanitizeBusinessTopicDrift(
      "哈哈，这个先打住。你家那堆旧数码翻得怎么样了？",
      "想那个",
      [],
    )).toBe("哈哈，这个先打住。你家那堆旧数码翻得怎么样了？");
  });

  it("keeps the recycling script inside the Xingmu persona only", () => {
    // 苏棠（电商运营）落到兜底时，绝不能冒出"旧数码/回收"那套话术。
    // C 方案后不再有兜底句；苏棠落到这里也是保留模型原话，不冒出旧数码话术。
    expect(sanitizeIntimateTopicReply("哪方面啊，说清楚点", "那方面难受", [], 4, false))
      .toBe("哪方面啊，说清楚点");
    expect(sanitizeIntimateTopicReply("哪方面啊，说清楚点", "那方面难受", [], 5, false))
      .not.toContain("旧数码");
    expect(businessFilterFallback("你做什么工作的", false)).toBe("做电商运营的，平时挺忙");
    expect(businessFilterFallback("你做什么工作的", false)).not.toContain("旧数码");
    // 星暮 scope 保持原样：他才是回收客服（C 方案后亲密话题不再有兜底句，这里看业务兜底）。
    expect(businessFilterFallback("你做什么工作的", true)).toBe("不是餐饮 我做旧数码这行的");
    expect(sanitizeBusinessTopicDrift(
      "手机啊，二手回收这块，你手上有闲置的没",
      "自己开店，太强了",
      [],
      "自己开店，太强了",
      false,
    )).not.toContain("旧数码");
  });

  it("always keeps one human-sounding last-resort fallback", () => {
    // 全链兜底必须存在（防止把不该说的内容发出去），但不能是"恩恩，好的。"
    expect(EMPTY_REPLY_FALLBACK).toBe("嗯 我在呢");
  });

  it("does not replace contextual replies with a generic fallback", () => {
    expect(sanitizeIntimateTopicReply("嗯，我听着呢。", "今天有点累", [], 1)).toBe("嗯，我听着呢。");
    expect(sanitizeIntimateTopicReply("嗯，你说吧。", "今天有点累", [], 1)).toBe("嗯，你说吧。");
    expect(normalizeAssistantReplyPresentation("啊")).toBe("啊");
  });

  it("repairs low-context replies with the surrounding conversation", () => {
    const messages = [{ role: "user", content: "后者" }];
    const history = [{ role: "assistant", content: "大冒险就是让你干点丢人的事，你先说你想选哪个" }];

    expect(shouldRepairXingmuLowContextReply("啊", messages, history, true)).toBe(true);
    expect(shouldRepairXingmuLowContextReply("你说吧", messages, history, true)).toBe(true);
    expect(
      shouldRepairXingmuLowContextReply(
        "行，大冒险。你先给通讯录第一个人发一句我想你了。",
        messages,
        history,
        true,
      )
    ).toBe(false);
  });
});
