import { describe, expect, it } from "vitest";
import {
  buildLayeredSystemPrompt,
  buildTurnBrief,
  classifyConversationTurn,
  isXingmuSoulScope,
  PROACTIVE_STYLE_GENERIC,
  PROACTIVE_STYLE_SUTANG,
  PROACTIVE_STYLE_XINGMU,
} from "../functions/api/_reply_policy";

describe("Xingmu prompt and turn context", () => {
  it("scopes the new Xingmu prompt rules to the Soul persona", () => {
    const promptFor = (
      personaPrompt: string,
      platform: string,
      mediaActionsEnabled = false,
      personaFacts: Record<string, unknown> | null = null,
    ) => buildLayeredSystemPrompt({
      personaPrompt,
      personaFacts,
      platform,
      profileContext: "",
      currentDatetime: "2026-09-30 22:30:00",
      weekday: "星期三",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "两江新区" },
      weather: null,
      weatherEnabled: false,
      timeEnabled: false,
      stageText: "测试阶段",
      relationStageLevel: 1,
      messages: [{ role: "user", content: "你好" }],
      historyMessages: [],
      mediaActionsEnabled,
      mediaGroups: [
        { id: "daily", name: "日常照" },
        { id: "body", name: "身材照" },
      ],
    });

    const soulPrompt = promptFor("你是王雅慧，对外叫星暮。", "soul", true, {
      age_mode: "fixed_age",
      fixed_age: 29,
      marital_status: "divorced",
      has_children: false,
      vehicle: "宝马X3",
      housing: "自有住房",
      hometown: "重庆",
      current_city: "重庆",
      current_district: "两江新区",
      work_city: "重庆",
      work_district: "江北区",
      location_precision: "district",
      proactive_location_allowed: false,
    });
    expect(soulPrompt).toContain("【星暮六段漏斗】");
    expect(soulPrompt).toContain("【关系前提】");
    expect(soulPrompt).toContain("【人物事实｜最高优先级】");
    expect(soulPrompt).toContain("【人设风格｜只负责表达方式】");
    expect(soulPrompt).toContain("优先级高于历史聊天、人设风格描述、对方推测和模型推断");
    expect(soulPrompt).toContain("不能自行补充、改写、推断自己的身份事实");
    expect(soulPrompt).not.toContain("【年龄事实｜最高优先级】");
    expect(soulPrompt).toContain("婚姻状态：离异");
    expect(soulPrompt).toContain("子女：没有孩子");
    expect(soulPrompt).toContain("车辆：宝马X3");
    expect(soulPrompt).toContain("住房：自有住房");
    expect(soulPrompt).not.toContain("已婚，无子女");
    expect(soulPrompt).toContain("不要回复单字");
    expect(soulPrompt).toContain("默认只发日常照");
    expect(soulPrompt).toContain("身材照、腿照或腰照");
    expect(soulPrompt).toContain("【离场判断｜最高优先级】");
    expect(soulPrompt).toContain("[[NO_REPLY:类型]]");
    expect(soulPrompt).toContain("[[SELF_LEAVE:类型]]");

    const agedSoulPrompt = promptFor("你是王雅慧，对外叫星暮，29岁。", "soul", true);
    expect(agedSoulPrompt).toContain("【年龄事实｜最高优先级】你的人设年龄固定为29岁");

    const qqPrompt = promptFor("你是王雅慧，对外叫星暮。", "qq", true);
    expect(qqPrompt).toContain("【星暮六段漏斗】");
    expect(qqPrompt).toContain("【关系前提】");
    expect(qqPrompt).toContain("照片动作以系统图片指令为准");
    expect(qqPrompt).toContain("[[SELF_LEAVE:类型]]");
    expect(qqPrompt).not.toContain("见面或开房当成");
    expect(qqPrompt).toContain(PROACTIVE_STYLE_XINGMU);
    expect(qqPrompt).not.toContain(PROACTIVE_STYLE_SUTANG);

    const otherPersonaPrompt = promptFor("你是陈屿，33岁男性。", "soul");
    expect(otherPersonaPrompt).not.toContain("【星暮六段漏斗】");
    expect(otherPersonaPrompt).not.toContain("【关系前提】");
    expect(otherPersonaPrompt).toContain("【人设风格｜只负责表达方式】");
    expect(otherPersonaPrompt).toContain("你是陈屿，33岁男性。");
    expect(otherPersonaPrompt).toContain(PROACTIVE_STYLE_GENERIC);
    expect(otherPersonaPrompt).not.toContain(PROACTIVE_STYLE_XINGMU);
    expect(otherPersonaPrompt).not.toContain(PROACTIVE_STYLE_SUTANG);
  });

  it("keeps Xingmu identity on non-Soul platforms after removing the platform guard", () => {
    expect(isXingmuSoulScope({
      personaPrompt: "你是王雅慧，对外叫星暮。",
      platform: "qq",
    })).toBe(true);
  });

  it("把转发动态卡片判成专门场景，不被卡片正文里的词带跑", () => {
    // 安卓侧读出来的卡片长这样：固定标记 + 作者 + 正文 + 配图描述。
    const card = {
      role: "user",
      content: "[对方转发了动态]。动态作者：另一面的我。动态正文：最近压力太大有点掉发。" +
        "动态配图（客观识别）：一个女生站在洗手池前。",
    };
    const praise = { role: "user", content: "好棒" };

    // 正文里有"压力"，但绝不能因此判成"对方在倾诉情绪"。
    expect(classifyConversationTurn([card])).toBe("forwarded_moment");
    // 后面紧跟的短句是冲着这条动态说的，走同一个场景，不另起新话题。
    expect(classifyConversationTurn([card, praise])).toBe("forwarded_moment");
    // 单独一句"好棒"不受影响，还是普通聊天。
    expect(classifyConversationTurn([praise])).toBe("normal");
    // 历史里躺着卡片、本轮只是普通文字时，不能误判。
    expect(classifyConversationTurn(
      [{ role: "user", content: "今天天气不错" }], "", [card],
    )).toBe("normal");

    const brief = buildTurnBrief({ messages: [card, praise] });
    expect(brief).toContain("场景：对方转发了一条动态过来");
    expect(brief).toContain("对方转发了一条动态");
  });

  it("builds a concise turn brief instead of forcing a fixed reply template", () => {
    expect(classifyConversationTurn([{ role: "user", content: "你好" }])).toBe("greeting");
    expect(classifyConversationTurn([{ role: "user", content: "你多大" }])).toBe("age");
    expect(classifyConversationTurn([{ role: "user", content: "你做什么工作的" }])).toBe("work");
    expect(classifyConversationTurn([{ role: "user", content: "今天累死了" }])).toBe("emotion");
    expect(classifyConversationTurn([{ role: "user", content: "旧手机还收吗" }])).toBe("business");
    expect(classifyConversationTurn([{ role: "user", content: "好" }])).toBe("ack");
    expect(classifyConversationTurn([{ role: "user", content: "你真好看" }])).toBe("compliment");
    expect(classifyConversationTurn([{ role: "user", content: "可以和你语音聊天吗" }])).toBe("voice_request");
    expect(classifyConversationTurn([{ role: "user", content: "可以视频看看你吗" }])).toBe("video_request");
    const boundaryHistory = [
      { role: "user", content: "看看有没有机会发展一下" },
      { role: "assistant", content: "看你表现呗" },
      { role: "user", content: "宝贝" },
      { role: "assistant", content: "才聊几句就喊宝贝，你这进度条拉太快了" },
    ];
    const boundaryFeedbackMessages = [
      { role: "user", content: "哈哈哈" },
      { role: "user", content: "不喜欢" },
    ];
    expect(classifyConversationTurn(boundaryFeedbackMessages, "", boundaryHistory)).toBe("boundary_feedback");

    const greeting = buildTurnBrief({
      messages: [{ role: "user", content: "你好" }],
      currentDatetime: "2026-09-29 03:00:00",
      relationStageLevel: 1,
    });
    expect(greeting).toContain("场景：问候或确认你在不在");
    expect(greeting).toContain("先把那件具体的事答了");
    expect(greeting).toContain("不要汇报自己正在做什么");
    expect(greeting).toContain("三连");
    expect(greeting).toContain("不要只回“咋啦”");
    expect(greeting).toContain("你好呀");

    const voiceRequest = buildTurnBrief({ messages: [{ role: "user", content: "可以和你语音聊天吗" }] });
    expect(voiceRequest).toContain("场景：对方邀请语音或通话");
    expect(voiceRequest).toContain("用一句带点玩味的话拒绝语音");
    expect(voiceRequest).toContain("不要答应以后打语音或打电话");

    const videoRequest = buildTurnBrief({ messages: [{ role: "user", content: "可以视频看看你吗" }] });
    expect(videoRequest).toContain("场景：对方要求视频");
    expect(videoRequest).toContain("不能发视频");

    const age = buildTurnBrief({ messages: [{ role: "user", content: "你多大了" }] });
    expect(age).toContain("场景：对方询问年龄");
    expect(age).toContain("你呢");

    const emotion = buildTurnBrief({ messages: [{ role: "user", content: "今天累死了" }] });
    expect(emotion).toContain("先接住情绪");
    expect(emotion).toContain("不要把话题拐到手机或业务");
    expect(emotion).toContain("【上下文锚点】");
    expect(emotion).toContain("最新对方原话：今天累死了");
    expect(emotion).toContain("已经结束的旧话题不要重开");

    const business = buildTurnBrief({ messages: [{ role: "user", content: "旧手机还收吗" }] });
    expect(business).toContain("先直接回答对方问的业务问题");
    expect(business).toContain("不报价、不催单");

    const ack = buildTurnBrief({ messages: [{ role: "user", content: "好" }] });
    expect(ack).toContain("场景：对方只是简单应了一声");
    expect(ack).toContain("不要突然问工作、旧数码、回收");

    const compliment = buildTurnBrief({ messages: [{ role: "user", content: "你真好看" }] });
    expect(compliment).toContain("场景：对方在夸你");
    expect(compliment).toContain("直接接住夸奖");

    const boundary = buildTurnBrief({
      messages: [{ role: "user", content: "其实还好吧" }],
      historyMessages: [{ role: "assistant", content: "别叫我女神，怪不好意思的" }],
      relationStageLevel: 1,
    });
    expect(boundary).toContain("对方在轻轻回应你上一轮已经表达过的称呼边界");
    expect(boundary).toContain("不要否定自己刚说过的边界");

    const boundaryFeedback = buildTurnBrief({
      messages: boundaryFeedbackMessages,
      historyMessages: boundaryHistory,
      relationStageLevel: 2,
    });
    expect(boundaryFeedback).toContain("场景：对方用省略式短句在反问上一轮的称呼或聊天节奏");
    expect(boundaryFeedback).toContain("你不喜欢我叫你宝贝吗");
    expect(boundaryFeedback).toContain("不是不喜欢，就是宝贝这个称呼来得太快了");
    expect(boundaryFeedback).toContain("先正常聊着呗");
    expect(boundaryFeedback).toContain("不要问“不喜欢啥”");
    expect(boundaryFeedback).toContain("【本批语境】");
    expect(boundaryFeedback).toContain("【短句理解】");
  });
});
