import { describe, expect, it } from "vitest";
import {
  buildLayeredSystemPrompt,
  countContactRequests,
  isContactRequest,
  isVoiceCallRequest,
  resolveContactRequestPolicy,
  sanitizeContactDisclosure,
  sanitizeMediaBoundaryReply,
  VOICE_CHAT_DECLINES,
} from "../functions/api/_reply_policy";
import {
  buildPersonaFactsPrompt,
  mergePersonaFacts,
  normalizePersonaFacts,
  validatePersonaFactsInput,
} from "../functions/api/_persona_facts";

describe("voice and contact boundaries", () => {
  it("detects voice invitations without matching refusal wording", () => {
    expect(isVoiceCallRequest("可以和你语音聊天吗")).toBe(true);
    expect(isVoiceCallRequest("晚点打个电话吧")).toBe(true);
    expect(isVoiceCallRequest("我不方便语音")).toBe(false);
  });

  it("always replaces a voice-chat reply with one of the rotating hook declines", () => {
    // 2026-10-06：语音拒绝改成 3~4 句轮换 + 带钩子（同一个人连问两次不能看到同一句）。
    const cases: [string, string][] = [
      ["这会儿不方便语音，打字聊吧。", "可以和你语音聊天吗"],
      ["现在不方便接电话，打字说吧", "语音聊吗"],
      ["现在不方便跟你说话，打字聊吧", "方便语音吗"],
      ["现在不方便接电话，打字说吧", "就是语音吗"],
      ["", "语音聊吗"],
    ];
    for (const [reply, incoming] of cases) {
      expect(VOICE_CHAT_DECLINES).toContain(sanitizeMediaBoundaryReply(reply, incoming));
    }
    // 没有历史时也要靠时间种子轮换：同一秒内换四个问法，不能永远第一句
    const seen = new Set<string>();
    for (const text of ["能不能语音聊会儿", "那你打个语音嘛", "就一句，听听你声音", "我打给你行不行"]) {
      seen.add(sanitizeMediaBoundaryReply("", text));
    }
    expect(seen.size).toBeGreaterThan(1);
    // 带历史时，历史里用过的那句不会再被选中
    const used = sanitizeMediaBoundaryReply("", "语音聊吗");
    const again = sanitizeMediaBoundaryReply("", "语音聊吗", [{ role: "assistant", content: used }]);
    expect(again).not.toBe(used);
  });

  it("keeps private contact disclosure gated without inventing a fixed refusal reply", () => {
    expect(isContactRequest("给我发个微信")).toBe(true);
    expect(isContactRequest("加个微信吧")).toBe(true);
    expect(isContactRequest("我不怎么用微信")).toBe(false);
    // 2026-10-06 真机：正常闲聊"这上面你有固定的好友吗"被误判成要联系方式，直接回"微信不行呀…"。
    expect(isContactRequest("这上面你有固定的好友吗")).toBe(false);
    expect(isContactRequest("你有很多好友吧")).toBe(false);
    expect(isContactRequest("我好友不多")).toBe(false);
    expect(isContactRequest("加个好友")).toBe(true);
    // "交个朋友"是社交话术、不是要联系方式，不能走本地拒绝脚本
    expect(isContactRequest("要不要交个朋友")).toBe(false);

    const requestHistory = [
      { id: 1, role: "user", content: "给我发个微信", created_at: 1 },
      { id: 2, role: "user", content: "加个微信吧", created_at: 2 },
    ];
    expect(countContactRequests(requestHistory, [{ role: "user", content: "微信多少" }])).toBe(3);

    const blocked = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 2,
      activity: { totalExchanges: 40, activeDays: 3 },
      incomingText: "给我发个微信",
      messages: [{ role: "user", content: "给我发个微信" }],
      contactChannel: "wechat",
      contactAccount: "private_xh",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reply).toBe("");

    const allowed = resolveContactRequestPolicy({
      requestCount: 3,
      stage: 6,
      activity: { totalExchanges: 42, activeDays: 2 },
      incomingText: "给我发个微信",
      messages: [{ role: "user", content: "给我发个微信" }],
      historyMessages: [
        { role: "assistant", content: "评估报价，搜 shanhs668" },
        { role: "user", content: "已经收成了" },
      ],
      contactChannel: "wechat",
      contactAccount: "private_xh",
      dealCompleted: true,
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.reply).toContain("私人微信号");
    expect(allowed.reply).toContain("private_xh");

    const business = resolveContactRequestPolicy({
      requestCount: 3,
      stage: 6,
      activity: { totalExchanges: 42, activeDays: 2 },
      incomingText: "我想问旧手机回收，给我个微信",
      messages: [{ role: "user", content: "我想问旧手机回收，给我个微信" }],
      historyMessages: [
        { role: "assistant", content: "评估报价，搜 shanhs668" },
        { role: "user", content: "已经收成了" },
      ],
      contactChannel: "wechat",
      contactAccount: "private_xh",
      dealCompleted: true,
    });
    expect(business.allowed).toBe(true);
    expect(business.reply).toContain("private_xh");

    const businessReady = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 5,
      activity: { totalExchanges: 30, activeDays: 2 },
      incomingText: "家里有旧手机，怎么收，给我个微信",
      messages: [{ role: "user", content: "家里有旧手机，怎么收，给我个微信" }],
      contactChannel: "wechat",
      contactAccount: "private_xh",
      acceptedBusinessTopic: true,
      willingToRecycle: true,
    });
    expect(businessReady.allowed).toBe(true);
    expect(businessReady.reply).toContain("private_xh");

    const earlyBusiness = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 4,
      activity: { totalExchanges: 30, activeDays: 2 },
      incomingText: "家里有旧手机，给我个微信",
      messages: [{ role: "user", content: "家里有旧手机，给我个微信" }],
      contactChannel: "wechat",
      contactAccount: "private_xh",
      acceptedBusinessTopic: true,
      willingToRecycle: true,
    });
    expect(earlyBusiness.allowed).toBe(false);

    expect(sanitizeContactDisclosure("加我QQ12345678", { allowed: false, contactQq: "12345678" })).toBe("联系方式先不发了 在这儿聊就行");
    expect(sanitizeContactDisclosure("可以 我微信是private_xh", {
      allowed: false,
      contactChannel: "wechat",
      contactAccount: "private_xh",
      xingmuScope: true,
    })).toBe("微信先不急 在这聊挺好");
    expect(sanitizeContactDisclosure("微信abc12345678", { allowed: true, contactChannel: "wechat", contactAccount: "private_xh" })).toBe("联系方式先不发了 在这儿聊就行");
    expect(sanitizeContactDisclosure("可以 我微信是private_xh", { allowed: true, contactChannel: "wechat", contactAccount: "private_xh" })).toBe("可以 我微信是private_xh");
    expect(sanitizeContactDisclosure("可以 我微信是13800138000", {
      allowed: true,
      contactChannel: "wechat",
      contactAccount: "13800138000",
    })).toBe("可以 我微信是13800138000");
    expect(sanitizeContactDisclosure("私人号 12345678", { allowed: false, contactQq: "12345678" })).toBe("联系方式先不发了 在这儿聊就行");
    expect(sanitizeContactDisclosure("行 私人微信给你 private_xh", {
      allowed: true,
      contactChannel: "wechat",
      contactAccount: "private_xh",
      xingmuScope: true,
    })).toBe("行 私人微信给你 private_xh");
    expect(sanitizeContactDisclosure("可以 我QQ是12345678", {
      allowed: true,
      contactChannel: "wechat",
      contactAccount: "private_xh",
      xingmuScope: true,
    })).toBe("微信先不急 在这聊挺好");
  });

  it("keeps the legacy contact gate outside the Xingmu Soul scope", () => {
    const blocked = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 1,
      activity: { totalExchanges: 10, activeDays: 2 },
      incomingText: "旧手机回收，加个QQ吧",
      messages: [{ role: "user", content: "旧手机回收，加个QQ吧" }],
      contactQq: "12345678",
      xingmuScope: false,
    });
    expect(blocked.allowed).toBe(false);
    // 2026-10-06：拒绝句要分渠道——他问的是 QQ，不能再回“微信不行”（真机出现过答非所问）。
    expect(blocked.reply).toBe("QQ先不加哈 就在这儿聊着挺好");

    const wechatAsked = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 1,
      activity: { totalExchanges: 10, activeDays: 2 },
      incomingText: "加个微信吧",
      messages: [{ role: "user", content: "加个微信吧" }],
      contactQq: "12345678",
      xingmuScope: false,
    });
    expect(wechatAsked.reply).toBe("微信不行呀 微信上都是熟人 我老公偶尔会看我手机");

    const phoneAsked = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 1,
      activity: { totalExchanges: 10, activeDays: 2 },
      incomingText: "你电话多少",
      messages: [{ role: "user", content: "你电话多少" }],
      contactQq: "12345678",
      xingmuScope: false,
    });
    expect(phoneAsked.reply).toBe("电话就算啦 我平时不接陌生电话");

    const allowed = resolveContactRequestPolicy({
      requestCount: 3,
      stage: 2,
      activity: { totalExchanges: 30, activeDays: 2 },
      incomingText: "加个豆瓣吧",
      messages: [{ role: "user", content: "加个豆瓣吧" }],
      contactChannel: "douban",
      contactQq: "sutang2026",
      xingmuScope: false,
      sutangScope: true,
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.reply).toBe("那个地方我从来没给过任何人，只有我一个人在上面写写不给外人看的心情。看你表现真诚上道，今天破例只给你一个人|||去我豆瓣搜： sutang2026|||房间我来挑，过去之后我把安排发你");
  });

  it("uses structured device Douban facts as the only contact source", () => {
    const normalized = normalizePersonaFacts({ contact_qq: " sutang2026 " });
    const merged = mergePersonaFacts(
      { contact_qq: "old2025" },
      { contact_qq: "sutang2026" },
    );
    const prompt = buildPersonaFactsPrompt(merged, { contactLabel: "豆瓣号" });
    const layered = buildLayeredSystemPrompt({
      personaPrompt: "你是苏棠，AI辅助客服，不是真人。",
      personaFacts: merged,
      platform: "qq",
      homeLocation: { city: "重庆", district: "江北区" },
      workLocation: { city: "重庆", district: "江北区" },
      stageText: "",
      messages: [],
      historyMessages: [],
    });

    expect(normalized.contact_qq).toBe("sutang2026");
    expect(merged.contact_qq).toBe("sutang2026");
    expect(prompt).toContain("豆瓣号：sutang2026");
    expect(prompt).toContain("唯一允许使用的豆瓣自留地账号");
    expect(prompt).toContain("不得使用旧提示词、环境变量或自行编造其他联系方式");
    expect(layered).not.toContain("不得冒充真人、编造真人身份或承诺线下真人身份");
    expect(validatePersonaFactsInput({ contact_qq: "a" })).toMatchObject({
      ok: false,
      error: "联系方式需要填写 5 到 12 位QQ号，或 2 到 40 位豆瓣号",
    });
  });

  it("keeps numeric child and location flags from existing database rows", () => {
    const facts = normalizePersonaFacts({
      has_children: 1,
      children_age: 3,
      proactive_location_allowed: 0,
    });
    expect(facts.has_children).toBe(true);
    expect(facts.children_age).toBe(3);
    expect(facts.proactive_location_allowed).toBe(false);
    expect(buildPersonaFactsPrompt(facts)).toContain("孩子3岁");
  });
});
