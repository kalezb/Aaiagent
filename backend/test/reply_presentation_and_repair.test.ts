import { describe, expect, it } from "vitest";
import {
  buildConversationAnchor,
  buildTurnBrief,
  buildXingmuBoundaryFeedbackRepairPrompt,
  buildXingmuContextRepairPrompt,
  buildXingmuConversationRepairPrompt,
  buildXingmuStyleDirection,
  isBoundaryFeedbackTurn,
  normalizeAssistantReplyPresentation,
  shouldRepairXingmuBoundaryFeedbackReply,
  shouldRepairXingmuContextMismatch,
  shouldRepairXingmuDeadEndReply,
  XINGMU_BOUNDARY_FEEDBACK_FALLBACK,
} from "../functions/api/_reply_policy";

describe("reply presentation and repair", () => {
  it("normalizes punctuation, expands single-character replies and keeps exact review quotes", () => {
    expect(normalizeAssistantReplyPresentation("你也是重庆的")).toBe("你也是重庆的？");
    expect(normalizeAssistantReplyPresentation("你也在重庆")).toBe("你也在重庆？");
    expect(normalizeAssistantReplyPresentation("29了 你呢")).toBe("29了 你呢？");
    // 苏棠这种软语气人设：句尾的“呢”是语气词，不是问句
    expect(normalizeAssistantReplyPresentation("刚在收拾娃的玩具呢", { softParticles: true })).toBe("刚在收拾娃的玩具呢");
    expect(normalizeAssistantReplyPresentation("刚在收拾娃的玩具呢？", { softParticles: true })).toBe("刚在收拾娃的玩具呢？");
    // 2026-10-06：苏棠不再自动补“？”（真人打字不句句带标点，工整感是“像 AI”的来源之一）
    expect(normalizeAssistantReplyPresentation("你多大了呢", { softParticles: true })).toBe("你多大了呢");
    expect(normalizeAssistantReplyPresentation("你在干嘛", { softParticles: true })).toBe("你在干嘛");
    // 星暮（非软语气）保持自动补问号
    expect(normalizeAssistantReplyPresentation("你在干嘛")).toBe("你在干嘛？");
    expect(normalizeAssistantReplyPresentation("不喜欢啥，喊宝贝还是我这人")).toBe("不喜欢啥，喊宝贝还是我这人？");
    expect(normalizeAssistantReplyPresentation("不管你喜欢咖啡还是茶，我都行")).toBe("不管你喜欢咖啡还是茶，我都行");
    expect(normalizeAssistantReplyPresentation("重庆哪边")).toBe("重庆哪边？");
    expect(normalizeAssistantReplyPresentation("梦到我什么了")).toBe("梦到我什么了？");
    expect(normalizeAssistantReplyPresentation("那刚那个表情包是谁点的")).toBe("那刚那个表情包是谁点的？");
    expect(normalizeAssistantReplyPresentation("那张照片谁发的")).toBe("那张照片谁发的？");
    expect(normalizeAssistantReplyPresentation("这话谁说的")).toBe("这话谁说的？");
    expect(normalizeAssistantReplyPresentation("你哪来的这个")).toBe("你哪来的这个？");
    expect(normalizeAssistantReplyPresentation("为什么会这样")).toBe("为什么会这样？");
    expect(normalizeAssistantReplyPresentation("是不是没收到")).toBe("是不是没收到？");
    expect(normalizeAssistantReplyPresentation("要不要再发一遍")).toBe("要不要再发一遍？");
    expect(normalizeAssistantReplyPresentation("嗯")).toBe("嗯，知道了。");
    expect(normalizeAssistantReplyPresentation("哪有什么另一面，不就一普通人")).toBe("哪有什么另一面，不就一普通人");
    expect(normalizeAssistantReplyPresentation("评估报价，搜 shanhs668")).toBe("评估报价，搜 shanhs668");
  });

  it("splits only at complete sentence endings and never at spaces", () => {
    expect(normalizeAssistantReplyPresentation(
      "自己住清静，我也一个人住惯了，屋子随便收拾 严肃是因为说的都是正经话，没在跟你谈生意 不累，刚收拾完坐下",
    )).toBe(
      "自己住清静，我也一个人住惯了，屋子随便收拾 严肃是因为说的都是正经话，没在跟你谈生意 不累，刚收拾完坐下",
    );
    expect(normalizeAssistantReplyPresentation(
      "不爱拍是真的，不是端着。你到家了没？还是还在那坐着？",
    )).toBe("不爱拍是真的，不是端着。|||你到家了没？|||还是还在那坐着？");
    expect(normalizeAssistantReplyPresentation("我用 iPhone 15 Pro 拍")).toBe("我用 iPhone 15 Pro 拍");
    expect(normalizeAssistantReplyPresentation("29了 你呢")).toBe("29了 你呢？");
  });

  it("repairs high-pressure boundary feedback without turning it into a relationship test", () => {
    const history = [
      { role: "user", content: "宝贝" },
      { role: "assistant", content: "才聊几句就喊宝贝，你这进度条拉太快了" },
    ];
    const messages = [
      { role: "user", content: "哈哈哈" },
      { role: "user", content: "不喜欢" },
    ];
    const risky = "不喜欢啥，喊宝贝还是我这人";
    expect(isBoundaryFeedbackTurn(messages, history)).toBe(true);
    expect(shouldRepairXingmuBoundaryFeedbackReply(risky, messages, history, true)).toBe(true);
    expect(shouldRepairXingmuBoundaryFeedbackReply("行，那我收一点。", messages, history, true)).toBe(true);
    expect(shouldRepairXingmuBoundaryFeedbackReply(
      "不是不喜欢，就是宝贝这个称呼太快了，先正常聊着呗。",
      messages,
      history,
      true,
    )).toBe(false);
    expect(shouldRepairXingmuBoundaryFeedbackReply(risky, messages, history, false)).toBe(false);
    expect(buildXingmuBoundaryFeedbackRepairPrompt(risky, messages, history))
      .toContain("候选回复：不喜欢啥，喊宝贝还是我这人");
    expect(buildXingmuBoundaryFeedbackRepairPrompt(risky, messages, history))
      .toContain("你是不是不喜欢我刚刚叫你宝贝");
    expect(XINGMU_BOUNDARY_FEEDBACK_FALLBACK)
      .toBe("不是不喜欢，就是宝贝这个称呼太快了，先正常聊着呗。");
  });

  it("detects dead-end replies and builds a repair prompt that leaves a low-pressure hook", () => {
    const messages = [{ role: "user", content: "最近压力挺大的" }];
    expect(shouldRepairXingmuDeadEndReply("哈哈 先聊点别的", messages, [], true)).toBe(true);
    expect(shouldRepairXingmuDeadEndReply("嗯嗯，好的。", messages, [], true)).toBe(true);
    expect(shouldRepairXingmuDeadEndReply("听着就挺累的，是工作堆一块了吗？", messages, [], true)).toBe(false);
    expect(shouldRepairXingmuDeadEndReply("好", [{ role: "user", content: "好" }], [], true)).toBe(false);
    expect(buildXingmuConversationRepairPrompt("哈哈 先聊点别的", messages, []))
      .toContain("低压力接点");
    expect(buildXingmuConversationRepairPrompt("哈哈 先聊点别的", messages, []))
      .not.toContain("不要用“先聊点别的”");
  });

  it("anchors replies to the latest turn and catches unrelated old topics", () => {
    const invitationMessages = [{ role: "user", content: "有空一起玩" }];
    const invitationAnchor = buildConversationAnchor({
      messages: invitationMessages,
      historyMessages: [{ role: "assistant", content: "你平时周末忙吗？" }],
      relationStageLevel: 1,
    });
    expect(invitationAnchor.latestUserMessage).toBe("有空一起玩");
    expect(invitationAnchor.previousAssistantReply).toBe("你平时周末忙吗？");
    expect(invitationAnchor.currentTopic).toBe("邀约、一起玩或一起吃东西");
    expect(invitationAnchor.intents).toContain("invitation");
    expect(shouldRepairXingmuContextMismatch(
      "嗯，怎么了？",
      invitationMessages,
      [],
      1,
      true,
    )).toBe(true);
    expect(shouldRepairXingmuContextMismatch(
      "好呀，等你有空，一起找个地方玩。",
      invitationMessages,
      [],
      1,
      true,
    )).toBe(false);

    const ackMessages = [{ role: "user", content: "没事呀" }];
    expect(shouldRepairXingmuContextMismatch(
      "29呀 你呢",
      ackMessages,
      [],
      1,
      true,
    )).toBe(true);
    expect(shouldRepairXingmuContextMismatch(
      "那就好，我还以为你有事。",
      ackMessages,
      [],
      1,
      true,
    )).toBe(false);

    const entityMessages = [{ role: "user", content: "有空来荣昌耍，吃卤鹅" }];
    const entityAnchor = buildConversationAnchor({
      messages: entityMessages,
      relationStageLevel: 1,
    });
    expect(entityAnchor.entities).toEqual(expect.arrayContaining(["荣昌", "卤鹅"]));
    expect(shouldRepairXingmuContextMismatch(
      "一个人住，离婚之后就自己过了。",
      entityMessages,
      [],
      1,
      true,
    )).toBe(true);
    expect(shouldRepairXingmuContextMismatch(
      "荣昌卤鹅听着不错，你常去耍吗？",
      entityMessages,
      [],
      1,
      true,
    )).toBe(false);
    expect(buildXingmuContextRepairPrompt(
      "一个人住，离婚之后就自己过了。",
      entityMessages,
      [],
      1,
    )).toContain("必须优先回应最新对方原话");
    expect(buildXingmuContextRepairPrompt(
      "一个人住，离婚之后就自己过了。",
      entityMessages,
      [],
      1,
    )).toContain("必须接住的具体信息：荣昌、卤鹅");
  });

  it("chooses a live style direction without forcing every turn into a question", () => {
    const emotion = buildXingmuStyleDirection({
      messages: [{ role: "user", content: "最近压力挺大的" }],
      relationStageLevel: 2,
    });
    expect(emotion.styles).toContain("warm_empathy");
    expect(emotion.direction).toContain("温暖共情");
    expect(emotion.requireHook).toBe(true);

    const invitation = buildXingmuStyleDirection({
      messages: [{ role: "user", content: "周末有空一起吃饭吗" }],
      relationStageLevel: 2,
    });
    expect(invitation.styles).toContain("accept_invite");
    expect(invitation.direction).toContain("不锁时间地点");

    const acknowledgement = buildXingmuStyleDirection({
      messages: [{ role: "user", content: "没事呀" }],
      relationStageLevel: 1,
    });
    expect(acknowledgement.styles).toContain("natural_close");
    expect(acknowledgement.allowQuestion).toBe(false);
    expect(acknowledgement.requireHook).toBe(false);

    const noQuestionLoop = buildXingmuStyleDirection({
      messages: [{ role: "user", content: "今天有点累" }],
      historyMessages: [
        { role: "assistant", content: "是不是工作太忙了？" },
        { role: "assistant", content: "那你平时怎么休息？" },
      ],
      relationStageLevel: 2,
    });
    expect(noQuestionLoop.styles).not.toContain("curious_follow_up");
    expect(noQuestionLoop.allowQuestion).toBe(false);

    const brief = buildTurnBrief({
      messages: [{ role: "user", content: "最近压力挺大的" }],
      relationStageLevel: 2,
    });
    expect(brief).toContain("【风格导演】");
    expect(brief).toContain("本轮主色");
  });
});
