import { describe, expect, it } from "vitest";
import { resolvePersonaScope } from "../functions/api/_reply_policy";
import {
  LIHUI_FACTS,
  buildLihuiDaypartRule,
  buildLihuiMicroStep,
} from "../functions/api/_lihui_persona";
import { matchPlaybookCards } from "../functions/api/_persona_playbook";
import { resolveContactConfig } from "../functions/api/_persona_scope_runtime";
import { resolveContactRequestPolicy, sanitizeContactDisclosure } from "../functions/api/_reply_contact";
import { capReplyLength, needsReplyLengthRewrite } from "../functions/api/_reply_length";
import { buildLeanConversationPrompt } from "../functions/api/_lean_conversation_prompt";

describe("李辉人设与规则引擎 (Lihui Persona & Rules Engine)", () => {
  describe("1. 人设识别与物理隔离 (Persona Scope & Isolation)", () => {
    it("正确识别 male 人设为 lihui scope", () => {
      const scopeById = resolvePersonaScope({
        personaId: "male",
        personaPrompt: "",
        xingmuSoulScope: false,
      });
      expect(scopeById).toBe("lihui");

      const scopeByPrompt = resolvePersonaScope({
        personaId: "custom_1",
        personaPrompt: "你是李辉，32岁，现居重庆永川，离异单身",
        xingmuSoulScope: false,
      });
      expect(scopeByPrompt).toBe("lihui");
    });

    it("与苏棠(female_sutang)和星暮(female)保持严格物理隔离", () => {
      const sutangScope = resolvePersonaScope({
        personaId: "female_sutang",
        personaPrompt: "你是苏棠",
        xingmuSoulScope: false,
      });
      expect(sutangScope).toBe("sutang");

      const xingmuScope = resolvePersonaScope({
        personaId: "female",
        personaPrompt: "你是星暮",
        xingmuSoulScope: true,
      });
      expect(xingmuScope).toBe("xingmu");
    });

    it("李辉客观事实 DNA 锁定", () => {
      expect(LIHUI_FACTS.name).toBe("李辉");
      expect(LIHUI_FACTS.age).toBe(32);
      expect(LIHUI_FACTS.city).toBe("重庆永川");
      expect(LIHUI_FACTS.marital_status).toBe("离异单身");
      expect(LIHUI_FACTS.child_fact).toContain("9岁女儿随前妻生活");
      expect(LIHUI_FACTS.assets).toContain("荣华府的房子和宝马X3都留给前妻和女儿了");
      expect(LIHUI_FACTS.job_design).toContain("电商平面设计");
      expect(LIHUI_FACTS.job_payment).toContain("商户支付通道");
    });
  });

  describe("2. 场景与时间感知引擎 (Time & Context Engine)", () => {
    it("上午时段 (08:00 - 11:30) 映射慢悠悠干活、咖啡醒脑", () => {
      const rule = buildLihuiDaypartRule("2026-10-23 09:30:00");
      expect(rule).toContain("手冲咖啡醒脑");
      expect(rule).toContain("严禁聊宵夜");
    });

    it("中午时段 (11:30 - 14:00) 映射下厨煮面或蹄花汤", () => {
      const rule = buildLihuiDaypartRule("2026-10-23 12:30:00");
      expect(rule).toContain("自个儿下厨煮面");
      expect(rule).toContain("围绕吃饭、午休");
    });

    it("下午时段 (14:00 - 18:00) 映射改图眼酸、商户催码", () => {
      const rule = buildLihuiDaypartRule("2026-10-23 15:45:00");
      expect(rule).toContain("改图眼睛酸");
      expect(rule).toContain("催开码子");
    });

    it("晚上时段 (18:00 - 22:30) 映射收工、烟火气、试探线下", () => {
      const rule = buildLihuiDaypartRule("2026-10-23 20:00:00");
      expect(rule).toContain("交图收工");
      expect(rule).toContain("试探性约线下");
    });

    it("深夜时段 (22:30 以后) 映射夜猫子、允许暧昧暗车", () => {
      const rule = buildLihuiDaypartRule("2026-10-23 23:15:00");
      expect(rule).toContain("冲完热水澡");
      expect(rule).toContain("暧昧暗车");
    });
  });

  describe("3. 动态思考与微步拉扯决策 (Dynamic Generalization & MicroStep)", () => {
    it("打招呼时随手回一句，严禁硬凑两句", () => {
      const step = buildLihuiMicroStep("你好", [], "KaLeZiBen");
      expect(step.title).toContain("随手短句问候");
      expect(step.instruction).toContain("只回 1 条自然短句");
      expect(step.instruction).toContain("严禁硬凑两句");
    });

    it("面对工作抱怨充当安全同谋", () => {
      const step = buildLihuiMicroStep("老板又加需求，烦死了", [], "KaLeZiBen");
      expect(step.title).toContain("安全同谋");
      expect(step.instruction).toContain("摸会儿鱼");
    });

    it("被问婚育资产云淡风轻翻篇", () => {
      const step = buildLihuiMicroStep("你结婚了吗有孩子吗", [], "KaLeZiBen");
      expect(step.title).toContain("坦荡翻篇");
      expect(step.instruction).toContain("9岁跟她妈");
      expect(step.instruction).toContain("荣华府房子和宝马X3都留给她们了");
    });

    it("被问生理需求成年人幽默坦然", () => {
      const step = buildLihuiMicroStep("你这么多年一个人，生理需求怎么解决", [], "KaLeZiBen");
      expect(step.title).toContain("成人坦然与幽默");
      expect(step.instruction).toContain("总不至于觉得我出家了吧");
    });

    it("对方要微信爽快给出微信号 KaLeZiBen", () => {
      const step = buildLihuiMicroStep("能加个微信吗", [], "KaLeZiBen");
      expect(step.title).toContain("爽快给微信");
      expect(step.instruction).toContain("KaLeZiBen");
    });

    it("未知场景遵循自适应造句公式", () => {
      const step = buildLihuiMicroStep("今天去看了个先锋现代艺术展", [], "KaLeZiBen");
      expect(step.title).toContain("自适应拉扯");
      expect(step.instruction).toContain("遵循公式");
    });
  });

  describe("4. 联系方式放行与锦囊库 (Contact & Playbook)", () => {
    it("联系方式策略中李辉直接放行且返回微信号 KaLeZiBen", () => {
      const config = resolveContactConfig(
        {},
        false,
        null,
        false,
        false,
        true,
      );
      expect(config.channel).toBe("wechat");
      expect(config.account).toBe("KaLeZiBen");

      const policy = resolveContactRequestPolicy({
        requestCount: 1,
        incomingText: "加个V呗",
        xingmuScope: false,
        sutangScope: false,
        lihuiScope: true,
        contactAccount: "KaLeZiBen",
      });
      expect(policy.allowed).toBe(true);
      expect(policy.reply).toContain("KaLeZiBen");
    });

    it("sanitizeContactDisclosure 保护 KaLeZiBen 输出", () => {
      const sanitized = sanitizeContactDisclosure("行啊 我微信 KaLeZiBen 加上聊", {
        allowed: true,
        lihuiScope: true,
        contactAccount: "KaLeZiBen",
      });
      expect(sanitized).toBe("行啊 我微信 KaLeZiBen 加上聊");
    });

    it("李辉专属锦囊已随其他人设规则一起移除", () => {
      const cards = matchPlaybookCards("male", "老板又加需求，烦死了", {});
      expect(cards.length).toBe(0);
    });
  });

  describe("5. 长度预算与质检豁免 (Length Budget & Presentation)", () => {
    it("李辉 18~25 字单条短句不被误判截断", () => {
      const reply = "这届老板真不让人省心，摸会儿鱼当没看见";
      expect(reply.length).toBeGreaterThan(15);
      expect(reply.length).toBeLessThanOrEqual(25);
      const capped = capReplyLength(reply, "老板烦死了", "lihui");
      expect(capped).toBe("这届老板真不让人省心|||摸会儿鱼当没看见");
      expect(needsReplyLengthRewrite(reply, "lihui")).toBe(false);
    });

    it("超过 2 气泡或超过 40 字时触发重写", () => {
      const tooLongReply = "这届老板真不让人省心，摸会儿鱼当没看见先缓缓|||等下再看看改图怎么弄吧真的累死了|||第三句超标了";
      expect(needsReplyLengthRewrite(tooLongReply, "lihui")).toBe(true);
    });
  });

  describe("6. 提示词端到端装配 (buildLeanConversationPrompt End-to-End)", () => {
    it("注入李辉专属交流方式、打字节奏、时间段约束和输出格式", () => {
      const prompt = buildLeanConversationPrompt({
        personaId: "male",
        platform: "微信",
        activePersonaScope: "lihui",
        currentDatetime: "2026-10-23 21:00:00",
        weekday: "星期五",
        messages: [{ role: "user", content: "你平时周末都干嘛" }],
        personaFacts: {
          age_mode: "fixed_age",
          fixed_age: 32,
          current_city: "重庆",
          current_district: "永川区",
          marital_status: "divorced",
          has_children: true,
          children_age: 9,
          contact_qq: "KaLeZiBen",
          contact_account: "KaLeZiBen",
          contact_channel: "wechat",
        },
      });

      expect(prompt).toContain("李辉微信单手随手敲字");
      expect(prompt).toContain("成年熟男的自适应拉扯");
      expect(prompt).toContain("单条气泡控制在 6~18 字（上限 25 字）");
      expect(prompt).toContain("交图收工");
      expect(prompt).toContain("KaLeZiBen");
      expect(prompt).not.toContain("苏棠");
      expect(prompt).not.toContain("二手手机数码回收");
      expect(prompt).not.toContain("不主动暧昧，不硬推业务");
    });
  });
});
