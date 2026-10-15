import { describe, expect, it } from "vitest";
import { getMessageDelayPolicy, sanitizeStaleAssistantReply } from "../functions/api/[[route]]";
import { normalizeLateReplyPersonaPrompt, stripLateReplyExcuse } from "../functions/api/_reply_policy";

describe("message delay policy", () => {
  it("classifies message delay bands without spending extra model calls", () => {
    const now = Math.floor(Date.parse("2026-09-25T00:59:00.000Z") / 1000);
    const policyFor = (ageSeconds: number) => getMessageDelayPolicy({
      role: "user",
      content: "在吗",
      created_at: now - ageSeconds,
    }, now);

    expect(policyFor(60).level).toBe("immediate");
    expect(policyFor(10 * 60).level).toBe("short_wait");
    expect(policyFor(60 * 60).level).toBe("acknowledge");
    expect(policyFor(3 * 3600).level).toBe("explicit_delay");
    expect(policyFor(10 * 3600).level).toBe("dayparted");
    expect(policyFor(2 * 86400).level).toBe("past_1_3d");
    expect(policyFor(5 * 86400).level).toBe("past_4_7d");
    expect(policyFor(10 * 86400).level).toBe("past_7_30d");
    expect(policyFor(40 * 86400).level).toBe("past_over_30d");
    expect(policyFor(60).prompt).toBe("");
    expect(policyFor(10 * 60).prompt).toBe("");
    expect(policyFor(2 * 3600).prompt).toBe("");
    expect(policyFor(3 * 3600).prompt).toBe("");
    expect(policyFor(10 * 3600).prompt).toBe("");
    expect(policyFor(2 * 86400).prompt).toContain("较早前的消息");
    expect(policyFor(10 * 86400).prompt).toContain("较早前的消息");
    expect(getMessageDelayPolicy({
      role: "user",
      content: "可以上门",
      created_at: now - 20,
    }, now).messageType).toBe("normal");
    expect(getMessageDelayPolicy({
      role: "user",
      content: "旧手机还收吗",
      created_at: now - 20,
    }, now).messageType).toBe("business");

    // 2026-10-05 方案1：分档基准改成“对方等了多久”。
    // 真机原样：对方 21:15 就问“人呢”，21:40 又发一批，只看最新一条会判成不用解释，
    // 模型于是自己编“刚去给娃盖了被子”。
    const waited = getMessageDelayPolicy(
      { role: "user", content: "人呢", created_at: now - 30 },
      now,
      20 * 60,
    );
    expect(waited.level).toBe("short_wait");
    expect(waited.prompt).toBe("");
    const waitedLong = getMessageDelayPolicy(
      { role: "user", content: "在吗", created_at: now - 30 },
      now,
      2 * 3600,
    );
    expect(waitedLong.level).toBe("acknowledge");
    expect(waitedLong.prompt).toBe("");
    // 消息本身更旧时，还是按消息的年龄分档
    expect(getMessageDelayPolicy({ role: "user", content: "在吗", created_at: now - 10 * 3600 }, now, 60).level)
      .toBe("dayparted");
  });

  it("does not rewrite stale wording into another late excuse", () => {
    const now = Math.floor(Date.parse("2026-10-05T11:35:00.000Z") / 1000);
    const policyFor = (ageSeconds: number) => getMessageDelayPolicy({
      role: "user",
      content: "在吗",
      created_at: now - ageSeconds,
    }, now);

    const overnight = policyFor(11 * 3600);
    expect(sanitizeStaleAssistantReply("刚忙完 你睡了吗", overnight)).toBe("刚忙完 你睡了吗");
    expect(sanitizeStaleAssistantReply("白天规规矩矩的 晚上才有空喘口气 你看着挺老实的 心里是不是也好奇我这一面？", overnight))
      .toBe("白天规规矩矩的 晚上才有空喘口气 你看着挺老实的 心里是不是也好奇我这一面？");
    const twoDays = policyFor(2 * 86400);
    expect(sanitizeStaleAssistantReply("刚看到|||咋啦", twoDays)).toBe("刚看到|||咋啦");
  });

  it("removes every leaked late-reply explanation before sending", () => {
    expect(stripLateReplyExcuse("这两天忙晕了 才上号看", 2 * 86400))
      .toBe("");
    expect(stripLateReplyExcuse("昨晚那条看到了 你先好好睡", 12 * 3600))
      .toBe("你先好好睡");
    expect(stripLateReplyExcuse("刚忙完 刚看到你消息|||在的", 12 * 3600))
      .toBe("在的");
    const normalized = normalizeLateReplyPersonaPrompt(
      "【时间】\n对方没问你在忙什么、也没问你怎么才回，就直接接他的话，不要汇报自己刚才在干什么。只有隔夜或隔天、或者他明确问起时，才用一句“这两天忙晕了”带过。\n任何时候都不要给自己安排一个刚做完的具体动作（刚去给娃盖被子、刚去倒水这类）；旧消息不要当成刚发来的接。"
    );
    expect(normalized).toContain("只接对方最新一句；不主动解释、不主动道歉、不主动汇报自己在忙什么。");
    expect(normalized).not.toContain("这两天忙晕了");
    expect(normalized).not.toContain("任何时候都不要给自己安排一个刚做完的具体动作");
  });

  it("keeps expired invitations and stable business questions logically aligned", () => {
    const now = Math.floor(Date.parse("2026-09-25T00:59:00.000Z") / 1000);
    const oldInvite = getMessageDelayPolicy({
      role: "user",
      content: "明天有空吗",
      created_at: now - 2 * 86400,
    }, now);
    expect(oldInvite.prompt).toContain("较早前的邀约");
    expect(sanitizeStaleAssistantReply("明天可以 我有空", oldInvite)).toBe("你刚说的那件事 现在还方便吗");

    const oldBusiness = getMessageDelayPolicy({
      role: "user",
      content: "现在还收手机吗",
      created_at: now - 3 * 86400,
    }, now);
    expect(oldBusiness.prompt).toContain("较早前问的工作或物品问题");
    expect(oldBusiness.prompt).toContain("不要主动重提");
    expect(sanitizeStaleAssistantReply("还收的 你现在要处理吗", oldBusiness))
      .toBe("还收的 你现在要处理吗");
    expect(sanitizeStaleAssistantReply("。。。", oldBusiness)).toBe("");
  });
});
