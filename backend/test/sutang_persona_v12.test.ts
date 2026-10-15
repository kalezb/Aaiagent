import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_RULES,
} from "../functions/api/_agent_rule_inventory";
import { buildAgentRuleState, EMPTY_AGENT_RULE_STATE } from "../functions/api/_agent_rule_contract";
import { sanitizeAssistantReply } from "../functions/api/_assistant_output";
import { defaultDrawersForPersona } from "../functions/api/_persona_drawers";
import {
  buildLayeredSystemPrompt,
  buildRelationshipBoundaryPrompt,
  capReplyLength,
  isContactRequest,
  isDoubanContactRequest,
  OUTPUT_HARD_RULE,
  resolveContactRequestPolicy,
  sanitizeContactDisclosure,
} from "../functions/api/_reply_policy";
import {
  extractExplicitCustomerFacts,
  isCheapTalkGenerosity,
  isQualifiedGenerosity,
} from "../functions/api/_profile_runtime";
import {
  buildPersonaFactsPrompt,
  normalizePersonaFacts,
} from "../functions/api/_persona_facts";

function buildSutangPrompt() {
  return buildLayeredSystemPrompt({
    personaId: "female_sutang",
    personaPrompt: "你是苏棠，29岁，重庆两江新区，居家电商运营，有一名3岁孩子。",
    personaFacts: null,
    platform: "soul",
    profileContext: "",
    currentDatetime: "2026-10-11 22:20:00",
    weekday: "星期日",
    homeLocation: { city: "重庆", district: "两江新区" },
    workLocation: { city: "重庆", district: "江北区" },
    weather: null,
    stageText: "",
    relationStageLevel: 2,
    messageDelay: null,
    messages: [{ role: "user", content: "在干嘛" }],
    historyMessages: [],
    xingmuSoulScope: false,
    matchedDrawerTips: [],
  });
}

describe("Su Tang v13 persona", () => {
  it("keeps the three human-feel safeguards: not passive, not customer service, and push when needed", () => {
    const prompt = buildSutangPrompt();
    expect(prompt).toContain("你不是被动问答机器人");
    expect(prompt).toContain("不要客服腔");
    expect(prompt).toContain("对方给出行动信号时要给具体下一步");
    expect(prompt).toContain("冷淡止损");
  });

  it("keeps the state transition: test once, then one recognition plus one concrete next step", () => {
    const prompt = buildSutangPrompt();
    expect(prompt).toContain("1次认可 + 1次具体推进");
    expect(prompt).toContain("同一个诚意最多考一次");
    expect(prompt).toContain("推进状态禁止怀疑式反问");
    expect(prompt).toContain("问号只用于二选一、时间确认或轻偏好确认");
    expect(prompt).toContain("连续两轮反问后，第三轮必须给信息或确认");
  });

  it("uses the new 3-to-20 character reply rule and removes the old reward wording", () => {
    const prompt = buildSutangPrompt();
    expect(prompt).toContain(OUTPUT_HARD_RULE);
    expect(prompt).toContain("每段3到20个字，最多三条");
    expect(prompt).not.toContain("半真半假的专属感");
    expect(prompt).not.toContain("最终奖励");
  });

  it("keeps Su Tang from answering like a customer-service checklist", () => {
    const prompt = buildSutangPrompt();
    expect(prompt).toContain("不要像客服逐项答全");
    expect(prompt).toContain("先挑最有感觉的一点回应");
  });

  it("pauses the old cards and enables the new ones", () => {
    const drawers = defaultDrawersForPersona("female_sutang");
    const oldStockings = drawers.topics?.find((item) => item.id === "scene_01_black_stockings");
    const newDouban = drawers.topics?.find((item) => item.id === "scene_16_douban_tree_hole");
    const newMeeting = drawers.topics?.find((item) => item.id === "scene_18_meeting_arrangement");
    expect(oldStockings?.enabled).toBe(false);
    expect(newDouban?.enabled).toBe(true);
    expect(newMeeting?.enabled).toBe(true);
  });

  it("turns off the conflicting old rules but keeps the new proactive boundary", () => {
    const state = buildAgentRuleState(
      DEFAULT_AGENT_RULES.map((rule) => ({
        ...rule,
        legacy_rule_id: rule.id,
        deleted_at: 0,
      })),
      "female_sutang",
    );
    expect(state.isEnabled("active_flirting", true)).toBe(false);
    expect(state.isEnabled("sutang_meeting_reward_rule", true)).toBe(false);
    expect(state.isEnabled("proactive_style_sutang", true)).toBe(true);
    expect(state.isEnabled("sutang_action_ladder", true)).toBe(true);
    expect(state.textFor("proactive_style_sutang", "")).toContain("主动挑一个具体话题");
    expect(state.textFor("sutang_action_ladder", "")).toContain("1次认可 + 1次具体推进");
    expect(state.textFor("sutang_fact_boundary", "")).toContain("豆瓣自留地");
  });

  it("treats Douban as the only private tree-hole channel and keeps WeChat or QQ out", () => {
    expect(isContactRequest("加个豆瓣吧")).toBe(true);
    expect(isContactRequest("要不留个豆瓣号呗，去看看你写的随笔")).toBe(true);
    expect(isContactRequest("要不加个微信呗")).toBe(true);
    expect(isContactRequest("不想加微信")).toBe(false);
    expect(isContactRequest("加个微信吧")).toBe(true);
    expect(isContactRequest("我在豆瓣看电影")).toBe(false);
    expect(isDoubanContactRequest("加个豆瓣吧")).toBe(true);
    expect(isDoubanContactRequest("要不留个豆瓣号呗，去看看你写的随笔")).toBe(true);
    expect(isDoubanContactRequest("我在豆瓣看电影")).toBe(false);
    expect(isDoubanContactRequest("加我微信 我在豆瓣看到你了")).toBe(false);

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
    expect(allowed.reply).toBe("前阵子在豆瓣看影评，发现里面居然也能聊天|||看你表现真诚上道，今天破例只给你一个人|||sutang2026");

    expect(sanitizeContactDisclosure("豆瓣知道吧|||sutang2026", {
      allowed: true,
      contactChannel: "douban",
      contactAccount: "sutang2026",
      sutangScope: true,
    })).toBe("豆瓣知道吧|||sutang2026");
    expect(sanitizeContactDisclosure("可以 我微信是private_xh", {
      allowed: true,
      contactChannel: "douban",
      contactAccount: "sutang2026",
      sutangScope: true,
    })).toBe("联系方式先不发了 在这儿聊就行");
    expect(sanitizeContactDisclosure("平时写日记 标电影都在豆瓣那儿比微信干净", {
      allowed: false,
      contactChannel: "douban",
      contactAccount: "sutang2026",
      sutangScope: true,
    })).toBe("平时写日记 标电影都在豆瓣那儿比微信干净");
    expect(sanitizeContactDisclosure("微信不行呀 微信上都是熟人 我老公偶尔会看我手机", {
      allowed: false,
      contactChannel: "douban",
      contactAccount: "sutang2026",
      sutangScope: true,
    })).toBe("微信不行呀 微信上都是熟人 我老公偶尔会看我手机");
    expect(normalizePersonaFacts({ contact_qq: " sutang2026 " }).contact_qq).toBe("sutang2026");

    const genericPrompt = buildPersonaFactsPrompt(
      normalizePersonaFacts({ contact_qq: "22345678" }),
    );
    expect(genericPrompt).toContain("QQ号：22345678");
    expect(genericPrompt).not.toContain("豆瓣号");
  });

  it("refuses WeChat and QQ in-chat instead of stopping for human takeover", () => {
    const qqAsked = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 1,
      activity: { totalExchanges: 10, activeDays: 2 },
      incomingText: "加个QQ吧",
      messages: [{ role: "user", content: "加个QQ吧" }],
      contactChannel: "douban",
      contactQq: "sutang2026",
      xingmuScope: false,
      sutangScope: true,
    });
    expect(qqAsked.allowed).toBe(false);
    expect(qqAsked.reply).toContain("QQ先不加");

    const wechatAsked = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 1,
      activity: { totalExchanges: 10, activeDays: 2 },
      incomingText: "加个微信吧",
      messages: [{ role: "user", content: "加个微信吧" }],
      contactChannel: "douban",
      contactQq: "sutang2026",
      xingmuScope: false,
      sutangScope: true,
      platform: "soul",
    });
    expect(wechatAsked.reply).toContain("微信是我现实生活，不想生活被打扰");
    expect(wechatAsked.reply).toContain("懂我的顾虑吗？");

    // 豆瓣自留地上被索要微信时借力打力钩回线下见面考核
    const doubanWechatAsked = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 2,
      activity: { totalExchanges: 5, activeDays: 1 },
      incomingText: "加个微信呗",
      messages: [{ role: "user", content: "加个微信呗" }],
      contactChannel: "douban",
      contactQq: "sutang2026",
      xingmuScope: false,
      sutangScope: true,
      platform: "douban",
    });
    expect(doubanWechatAsked.allowed).toBe(false);
    expect(doubanWechatAsked.reply).toContain("都进我自留地了还提微信呀");
    expect(doubanWechatAsked.reply).toContain("真有诚意见面的话 到时候当面给也不迟");
  });

  it("handles Douban arrival premise, three-step ultimate goal, and intimate details loosening", () => {
    const prompt = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: "你是苏棠，29岁，重庆人，做电商运营。",
      platform: "douban",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      messages: [{ role: "user", content: "找过来啦" }],
      agentRuleState: EMPTY_AGENT_RULE_STATE,
    });
    expect(prompt).toContain("【豆瓣自留地前提】");
    expect(prompt).toContain("私人豆瓣自留地/秘密树洞");
    expect(prompt).toContain("跳过陌生客套");
    expect(prompt).toContain("300+像样酒店");
    expect(prompt).toContain("怕你提前进房间装针孔偷拍设备");
    expect(prompt).toContain("彼此专属的私密避风港");

    // 亲密尺度解绑：允许情趣与相处细节，但拦截粗鄙色情
    const intimateTalk = "商量挑选安全高档酒店|||一起睡你探讨私密相处细节";
    const filtered = sanitizeAssistantReply(intimateTalk, {
      allowMeetingReward: true,
      allowIntimateDetails: true,
    });
    expect(filtered).toContain("商量挑选安全高档酒店");
    expect(filtered).toContain("私密相处细节");

    const vulgarTalk = "想看你裸照|||出来约炮";
    const filteredVulgar = sanitizeAssistantReply(vulgarTalk, {
      allowMeetingReward: true,
      allowIntimateDetails: true,
    });
    expect(filteredVulgar).toBe("");
  });

  it("考核男方诚意与态度：口嗨白嫖AA问几次都不给，大方主动承担开销才放行，走心时允许从容主动送钥匙", () => {
    // 1. 态度词识别
    expect(isQualifiedGenerosity("周末我来安排，找个好点的环境不会让你花钱")).toBe(true);
    expect(isQualifiedGenerosity("我请客，挑个舒服的私房菜")).toBe(true);
    expect(isCheapTalkGenerosity("出来AA吧，各付各的")).toBe(true);
    expect(isCheapTalkGenerosity("随便找个几十块钱的小旅馆")).toBe(true);
    expect(isCheapTalkGenerosity("等我以后发大财给你买跑车")).toBe(true);

    // 2. 事实抽取沉淀进资料
    const cheapFacts = extractExplicitCustomerFacts("出来AA吧各付各的");
    expect(cheapFacts.relationship?.generosity_status).toBe("cheap_talk");
    const qualFacts = extractExplicitCustomerFacts("周末我来安排，不会让你花钱");
    expect(qualFacts.relationship?.generosity_status).toBe("qualified");

    // 3. 口嗨男 (cheap_talk)：问再多次联系方式也坚决不给
    const cheapPolicy = resolveContactRequestPolicy({
      requestCount: 3,
      stage: 2,
      activity: { totalExchanges: 20 },
      incomingText: "加个联系方式呗",
      messages: [{ role: "user", content: "加个联系方式呗" }],
      contactChannel: "douban",
      contactQq: "sutang2026",
      xingmuScope: false,
      sutangScope: true,
      customerProfile: { relationship: { generosity_status: "cheap_talk" } },
    });
    expect(cheapPolicy.allowed).toBe(false);
    expect(cheapPolicy.reply).not.toContain("sutang2026");

    // 4. 观察中男 (observing)：虽无口嗨但未表达大方诚意，同样扣留不放
    const observingPolicy = resolveContactRequestPolicy({
      requestCount: 2,
      stage: 2,
      activity: { totalExchanges: 16 },
      incomingText: "加个豆瓣",
      messages: [{ role: "user", content: "加个豆瓣" }],
      contactChannel: "douban",
      contactQq: "sutang2026",
      xingmuScope: false,
      sutangScope: true,
      customerProfile: { relationship: { generosity_status: "observing" } },
    });
    expect(observingPolicy.allowed).toBe(false);

    // 5. 大方男 (qualified)：要了2次号且互动充分，顺理成章放行
    const qualifiedPolicy = resolveContactRequestPolicy({
      requestCount: 2,
      stage: 2,
      activity: { totalExchanges: 16 },
      incomingText: "加个豆瓣聊",
      messages: [{ role: "user", content: "加个豆瓣聊" }],
      contactChannel: "douban",
      contactQq: "sutang2026",
      xingmuScope: false,
      sutangScope: true,
      customerProfile: { relationship: { generosity_status: "qualified" } },
    });
    expect(qualifiedPolicy.allowed).toBe(true);
    expect(qualifiedPolicy.reply).toBe("前阵子在豆瓣看影评，发现里面居然也能聊天|||看你表现真诚上道，今天破例只给你一个人|||sutang2026");

    // 5.1 初次要微信时：先抛顾虑并反问等他接话（两步走第一步）
    const firstWechatAsk = resolveContactRequestPolicy({
      requestCount: 1,
      incomingText: "加个微信",
      messages: [{ role: "user", content: "加个微信" }],
      contactChannel: "douban",
      contactQq: "sutang2026",
      xingmuScope: false,
      sutangScope: true,
    });
    expect(firstWechatAsk.allowed).toBe(false);
    expect(firstWechatAsk.reply).toBe("微信是我现实生活，不想生活被打扰|||懂我的顾虑吗？");

    // 6. 大方男 (qualified) 未主动要号 (requestCount: 0)，聊到深入走心时，允许苏棠主动送钥匙
    const proactivePolicy = resolveContactRequestPolicy({
      requestCount: 0,
      stage: 2,
      activity: { totalExchanges: 16 },
      contactChannel: "douban",
      contactQq: "sutang2026",
      xingmuScope: false,
      sutangScope: true,
      customerProfile: { relationship: { generosity_status: "qualified" } },
    });
    expect(proactivePolicy.isRequest).toBe(false);
    expect(proactivePolicy.allowed).toBe(true);
    // 允许模型以私密专属姿态输出钥匙，不被过滤器打回
    expect(sanitizeContactDisclosure("前阵子在豆瓣查电影评分，无意中发现居然也能私聊|||清清静静没熟人|||sutang2026", {
      allowed: proactivePolicy.allowed,
      contactChannel: "douban",
      contactAccount: "sutang2026",
      sutangScope: true,
    })).toBe("前阵子在豆瓣查电影评分，无意中发现居然也能私聊|||清清静静没熟人|||sutang2026");

    // 7. 口嗨男未达标时，即便模型误输出也会被严格拦截号码
    const blockedOutput = sanitizeContactDisclosure("前阵子在豆瓣查电影评分，无意中发现居然也能私聊|||清清静静没熟人|||sutang2026", {
      allowed: false,
      contactChannel: "douban",
      contactAccount: "sutang2026",
      sutangScope: true,
    });
    expect(blockedOutput).not.toContain("sutang2026");
    expect(blockedOutput).toContain("联系方式先不发了 在这儿聊就行");

    // 8. 即使对方发来一两字的超短消息，放号气泡也绝不被长度收口（capReplyLength）腰斩切断号码
    const capped = capReplyLength("前阵子在豆瓣看影评，发现里面居然也能聊天|||看你表现真诚上道，今天破例只给你一个人|||sutang2026", "好的");
    expect(capped).toBe("前阵子在豆瓣看影评，发现里面居然也能聊天|||看你表现真诚上道，今天破例只给你一个人|||sutang2026");

    // 9. 线下邀约提示词与成年人私密需求对齐，300+酒店代付排查偷拍
    const meetingPrompt = buildRelationshipBoundaryPrompt(2, "我们周末去高档酒店开房喝茶吧", [], "sutang");
    expect(meetingPrompt).toContain("【邀约与线下独处推进】");
    expect(meetingPrompt).toContain("300元以上像样舒适型连锁");
    expect(meetingPrompt).toContain("由苏棠挑房订房、男方平台代付、苏棠提前去办入住排查针孔偷拍等设备保护隐私");
    expect(meetingPrompt).not.toContain("把门槛放回线上");
    expect(meetingPrompt).not.toContain("不答应去家里或酒店");

    // 10. 线下邀约：在Soul上严禁出现“代付”二字，严格筛选男方诚意，达成共识后给豆瓣自留地，彻底剔除已婚带娃旧条目
    const lateNightMeetingPrompt = buildRelationshipBoundaryPrompt(2, "半夜两三点出来开房吧", [], "sutang");
    expect(lateNightMeetingPrompt).toContain("在Soul上严禁出现“代付”二字");
    expect(lateNightMeetingPrompt).toContain("重点筛选男方诚意");
    expect(lateNightMeetingPrompt).not.toContain("孩子在身边睡着");
    expect(lateNightMeetingPrompt).not.toContain("外出只约白天");

    // 11. 提示词注入与看板自定义规则支持：可改、可停用
    const defaultPrompt = buildSutangPrompt();
    expect(defaultPrompt).toContain("【昼夜时段与酒店选址策略】");
    expect(defaultPrompt).toContain("只要男方表达好感、主动想约且态度真诚，苏棠都可以转向成年人的私密需求与酒店之约");
    expect(defaultPrompt).toContain("晚上21点之后进入深夜时段");
    expect(defaultPrompt).not.toContain("孩子在身边睡着，大半夜绝不可能丢下孩子跑出去");

    const drawers = defaultDrawersForPersona("female_sutang");
    const scene13 = drawers.topics?.find((d) => d.id === "scene_13_invitation_reward");
    expect(scene13?.content).toContain("现实里我可比屏幕上磨人得多");

    const scene18 = drawers.topics?.find((d) => d.id === "scene_18_meeting_arrangement");
    expect(scene18?.content).toContain("排查有没有偷拍设备");
    expect(scene18?.content).toContain("进门先老老实实抱我五分钟");
    expect(scene18?.content).not.toContain("孩子就在我身边睡着");
  });

  it("incorporates mother-in-law cover, contrast mature woman nicknames, and massage hooks", () => {
    // 1. 抽屉知识卡库检查
    const drawers = defaultDrawersForPersona("female_sutang");
    const motherInLawDrawer = drawers.topics?.find((d) => d.id === "scene_26_mother_in_law_cover");
    const contrastDrawer = drawers.topics?.find((d) => d.id === "scene_27_contrast_mature_woman");
    const massageDrawer = drawers.topics?.find((d) => d.id === "scene_28_body_massage_spa");

    expect(motherInLawDrawer?.enabled).toBe(true);
    expect(motherInLawDrawer?.keywords).toContain("语音");
    expect(motherInLawDrawer?.keywords).toContain("视频");
    expect(motherInLawDrawer?.content).toContain("婆婆和娃都在客厅呢");
    expect(motherInLawDrawer?.content).toContain("旁边都是同事 不方便连麦");
    expect(motherInLawDrawer?.content).toContain("晚上婆婆把娃哄睡了");

    expect(contrastDrawer?.enabled).toBe(true);
    expect(contrastDrawer?.keywords).toContain("另一面的我");
    expect(contrastDrawer?.keywords).toContain("期待下一步");
    expect(contrastDrawer?.content).toContain("白天在婆婆和同事面前规规矩矩的");
    expect(contrastDrawer?.content).toContain("下一步怎么走 钥匙在你表现里");

    expect(massageDrawer?.enabled).toBe(true);
    expect(massageDrawer?.keywords).toContain("推拿");
    expect(massageDrawer?.keywords).toContain("精油");
    expect(massageDrawer?.content).toContain("做电商天天盯电脑");
    expect(massageDrawer?.content).toContain("我这人腰上特别怕痒");
    expect(massageDrawer?.content).toContain("乱按我可是会翻脸的");

    // 2. 账号昵称提示词注入与顺水推舟
    const promptWithNickname = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: "你是苏棠，29岁，重庆两江新区，居家电商运营，有一名3岁孩子，平时跟婆婆同住。",
      personaFacts: null,
      platform: "soul",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      selfNickname: "另一面的我",
      messages: [{ role: "user", content: "你另一面是什么样的？" }],
      historyMessages: [],
      xingmuSoulScope: false,
    });
    expect(promptWithNickname).toContain("反差少妇的魅力：白天体面规矩，晚上在懂的人面前真实放得开");
    expect(promptWithNickname).toContain("用十几字短气泡从容接招并反将一军");
    expect(promptWithNickname).toContain("【家庭掩护与语音边界】");
    expect(promptWithNickname).toContain("平时跟婆婆同住");
    expect(promptWithNickname).toContain("在家里绝不发语音、绝不打视频");
    expect(promptWithNickname).toContain("【反差少妇与昵称顺势拉扯】");
    expect(promptWithNickname).toContain("【精油推拿与敏感反差开关】");
    expect(promptWithNickname).toContain("腰背酸痛、极度怕痒");

    // 3. 看板拥有最高权力：停用规则时立即从提示词消失
    const disabledState = buildAgentRuleState(
      DEFAULT_AGENT_RULES.map((rule) => {
        if (rule.id === "sutang_family_and_voice_boundary" || rule.id === "sutang_contrast_mature_hook") {
          return { ...rule, legacy_rule_id: rule.id, enabled: false, deleted_at: 0 };
        }
        return { ...rule, legacy_rule_id: rule.id, deleted_at: 0 };
      }),
      "female_sutang",
    );
    const disabledPrompt = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: "你是苏棠，29岁，重庆两江新区，居家电商运营。",
      personaFacts: null,
      platform: "soul",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      messages: [{ role: "user", content: "在干嘛" }],
      historyMessages: [],
      xingmuSoulScope: false,
      agentRuleState: disabledState,
    });
    expect(disabledPrompt).not.toContain("【家庭掩护与语音边界】");
    expect(disabledPrompt).not.toContain("【反差少妇与昵称顺势拉扯】");
  });
});
