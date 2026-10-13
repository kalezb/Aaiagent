import { describe, expect, it } from "vitest";
import {
  avoidRepeatedAssistantReply,
  sanitizeAgeConsistency,
  sanitizeGroundingMismatch,
  sanitizePersonaFactsReply,
  sanitizeXingmuIdentity,
  XINGMU_FIXED_AGE,
} from "../functions/api/_reply_policy";

describe("reply grounding and persona facts", () => {
  it("keeps replies grounded in explicit user facts and drops echoed challenges", () => {
    const history = [
      { role: "user", content: "睡醒了" },
      { role: "user", content: "睡得也不早" },
    ];
    expect(sanitizeGroundingMismatch(
      "掉头发这事我认，最近是掉得有点多 你倒是睡得挺香",
      "睡得也不早",
      history,
    // 2026-10-06 用户反馈：补救句只在他真的质问“我什么时候说过”时才用；
    // 平时模型自己编了一句，就直接删掉那段，别顶“我记岔了”进正常聊天。
    )).toBe("");
    expect(sanitizeGroundingMismatch(
      "你怎么晓得我睡得香，我这边灯还亮着呢？",
      "你怎么晓得我睡得香",
      history,
    )).toMatch(/^(?:我记岔了|哎 我记岔了|刚那句我记混了)$/);
    expect(sanitizeGroundingMismatch(
      "你早点休息",
      "你怎么晓得我睡得香",
      history,
    )).toBe("你早点休息");
  });

  it("does not replace a meaningful repeated reply with an unrelated generic question", () => {
    const now = 1_790_000_000;
    const history = [{
      role: "assistant",
      content: "你怎么晓得我睡得香",
      created_at: now - 20,
    }];
    expect(avoidRepeatedAssistantReply(
      "你怎么晓得我睡得香，我这边灯还亮着呢？",
      history,
      "十脸懵逼",
      now,
    )).toBe("你怎么晓得我睡得香，我这边灯还亮着呢？");
  });

  it("does not resend a slice of a longer previous message", () => {
    // 真机原样（♩讲究郎¶吾先森（89已婚））：他新问"你想拿什么换"，
    // 她把自己两分钟前那条三段消息的第一段又单独发了一遍。
    const now = 1_790_000_000;
    const history = [{
      role: "assistant",
      content: "企鹅我看到了 就是不太方便加呢|||这边聊着不挺好 你急什么呀|||想看我 那得先说说你拿什么换",
      created_at: now - 120,
    }];
    const result = avoidRepeatedAssistantReply("企鹅我看到了 就是不太方便加呢", history, "你想拿什么换", now);
    expect(result).not.toBe("企鹅我看到了 就是不太方便加呢");
    expect(result.length).toBeGreaterThan(0);
  });

  it("drops a line she said the day before (real case: 请叫我球⚽️)", () => {
    // 2026-10-07 真机：她 00:11 说“我醒了就得翻半天才迷糊回去”，20 小时后 20:43 原句又说了一遍。
    const now = 1_800_000_000;
    const history = [
      {
        role: "assistant",
        content: "醒一下还能接上，这本事我服|||我醒了就得翻半天才迷糊回去",
        created_at: now - 20 * 3600,
      },
      { role: "user", content: "醒也是醒 醒一下我能接着睡", created_at: now - 120 },
    ];
    // 整条都是旧话 → 换成不重复的短句，绝不原样发出去
    const whole = avoidRepeatedAssistantReply("我醒了就得翻半天才迷糊回去", history, "醒也是醒", now);
    expect(whole).not.toContain("我醒了就得翻半天才迷糊回去");
    // 一半旧话一半新话 → 只丢旧的那半
    const mixed = avoidRepeatedAssistantReply("我醒了就得翻半天才迷糊回去|||你今晚几点睡呀", history, "醒也是醒", now);
    expect(mixed).toBe("你今晚几点睡呀");
  });

  it("replaces legacy married-persona facts with the current Xingmu identity", () => {
    expect(sanitizeXingmuIdentity("不是，我结婚了。", "你结婚了吗", true))
      .toBe("离过婚，现在一个人住。");
    expect(sanitizeXingmuIdentity("他出差了，不在重庆。", "你老公今晚不陪你吗", true))
      .toBe("离过婚，现在一个人住。");
    expect(sanitizeXingmuIdentity("他主动来找我，我让他等会儿。", "那你怎么说的", true))
      .toBe("他主动来找我，我让他等会儿。");
    expect(sanitizeXingmuIdentity("我没有老公，一个人住。", "你老公呢", true))
      .toBe("我没有老公，一个人住。");
    expect(sanitizeXingmuIdentity("我孩子今年五岁。", "你孩子多大了", true))
      .toBe("我没孩子。");
    expect(sanitizeXingmuIdentity("离过婚，现在一个人住。", "你结婚了吗", true))
      .toBe("离过婚，现在一个人住。");
    expect(sanitizeXingmuIdentity("我已经结婚了", "你好", false)).toBe("我已经结婚了");
    expect(sanitizeXingmuIdentity(
      "我29，89年的",
      "你多大了",
      true,
      XINGMU_FIXED_AGE,
    )).toBe("29呀 你呢");
    expect(sanitizeAgeConsistency(
      "我今年30，1996年生的",
      "你多大了",
      XINGMU_FIXED_AGE,
    )).toBe("29呀 你呢");
    expect(sanitizeAgeConsistency(
      "我29，比你小",
      "你比我大还是小",
      XINGMU_FIXED_AGE,
    )).toBe("我29，比你小");
  });

  it("keeps structured vehicle facts and blocks invented family details", () => {
    const facts = {
      age_mode: "fixed_age",
      fixed_age: 29,
      marital_status: "divorced",
      has_children: false,
      vehicle: "宝马X3",
      housing: "自有住房",
      current_city: "重庆",
      current_district: "两江新区",
      work_city: "重庆",
      work_district: "江北区",
    };

    expect(sanitizePersonaFactsReply(
      "宝马没有 小电驴倒是有一辆",
      "你是开宝马吗",
      facts,
    )).toBe("有辆宝马X3，平时代步而已。");
    // Natural family talk is allowed now; only invented family structure is
    // rewritten, because the canned refusal read as a robot.
    expect(sanitizePersonaFactsReply(
      "我妈在重庆，平时各过各的",
      "你不陪爸爸妈妈吗",
      facts,
    )).toBe("我妈在重庆，平时各过各的");
    expect(sanitizePersonaFactsReply(
      "对，就我一个，独生女，早习惯了",
      "你家就你一个吗",
      facts,
    )).toBe("家里的事先不聊，聊点别的吧。");
  });

  it("keeps natural spouse talk instead of the canned refusal", () => {
    const facts = {
      age_mode: "fixed_age",
      fixed_age: 29,
      marital_status: "married",
      has_children: true,
      children_age: 3,
    };

    // Regression: these carried no 结婚/老公 keyword and were replaced by
    // "我结婚了，这些私事不展开。" — the reply the user saw as too robotic.
    expect(sanitizePersonaFactsReply(
      "他出差去了，一个月回来一次",
      "你老公呢",
      facts,
    )).toBe("他出差去了，一个月回来一次");
    expect(sanitizePersonaFactsReply(
      "我老公偶尔出差 在家也没话说",
      "你老公呢",
      facts,
    )).toBe("我老公偶尔出差 在家也没话说");
    expect(sanitizePersonaFactsReply(
      "搭伙过日子呗 各忙各的",
      "你婚姻怎么样",
      facts,
    )).toBe("搭伙过日子呗 各忙各的");

    // A real contradiction still falls back, in a natural voice.
    expect(sanitizePersonaFactsReply(
      "我未婚啊",
      "你结婚了吗",
      facts,
    )).toBe("结了，搭伙过日子呗。");
    expect(sanitizePersonaFactsReply(
      "我离过婚，现在一个人",
      "你结婚了吗",
      facts,
    )).toBe("结了，搭伙过日子呗。");
  });

  it("suppresses the same assistant reply when it was sent again within ten minutes", () => {
    const now = 1_790_000_000;
    const history = [{
      role: "assistant",
      content: "哈哈 先聊点别的",
      created_at: now - 28,
    }];
    expect(avoidRepeatedAssistantReply("哈哈 先聊点别的", history, "可以可以", now))
      .toBe("行，那就先这样。");
    expect(avoidRepeatedAssistantReply("哈哈 先聊点别的", history, "那你平时忙什么", now))
      .toBe("哈哈 先聊点别的");
    expect(avoidRepeatedAssistantReply(
      "行，那就先这样。",
      [
        { role: "assistant", content: "行，那就先这样。", created_at: now - 20 },
      ],
      "可以可以",
      now,
      "行，那就先这样。",
    )).toBe("行，不催你了。");
  });
});
