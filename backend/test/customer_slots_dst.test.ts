import { describe, expect, it } from "vitest";
import {
  extractCustomerDialogueSlots,
  isDrawerProbingKnownSlot,
  buildCustomerSlotsConstraintPrompt,
  sanitizeKnownSlotInquiries,
  type CustomerDialogueSlots,
} from "../functions/api/_customer_slots";
import { matchActiveDrawers } from "../functions/api/_persona_drawers";
import { buildLayeredSystemPrompt } from "../functions/api/_reply_policy";

describe("Customer Dialogue State Tracking (DST) & Anti-repetition", () => {
  it("extracts known slots from customer profile and contacts table", () => {
    const slots = extractCustomerDialogueSlots({
      customerProfile: {
        basic: { age: "32" },
        location: { residence: "渝北区照母山" },
        work: { role: "前端开发工程师" },
        family: { marital_status: "单身" },
      },
      contact: {
        marital_checked: 1,
        marital_status: "single",
        his_photo_at: 1729000000,
      },
      messages: [],
      historyMessages: [],
    });

    expect(slots.ageKnown).toBe(true);
    expect(slots.ageValue).toBe("32岁");
    expect(slots.maritalKnown).toBe(true);
    expect(slots.locationKnown).toBe(true);
    expect(slots.locationValue).toContain("照母山");
    expect(slots.workKnown).toBe(true);
    expect(slots.workValue).toBe("前端开发工程师");
    expect(slots.hisPhotoKnown).toBe(true);
  });

  it("extracts slots dynamically from user conversation messages", () => {
    const historyMessages = [
      { role: "user", content: "你好呀" },
      { role: "assistant", content: "在呢 这么晚还没睡" },
      { role: "user", content: "我今年34岁，单身一个人住" },
      { role: "assistant", content: "那挺自在的" },
      { role: "user", content: "平时在软件园做IT，家住在江北区" },
    ];
    const messages = [{ role: "user", content: "你呢？" }];

    const slots = extractCustomerDialogueSlots({
      customerProfile: {},
      contact: {},
      messages,
      historyMessages,
    });

    expect(slots.ageKnown).toBe(true);
    expect(slots.ageValue).toBe("34岁");
    expect(slots.maritalKnown).toBe(true);
    expect(slots.maritalValue).toBe("单身/独居");
    expect(slots.locationKnown).toBe(true);
    expect(slots.locationValue).toBe("江北区");
    expect(slots.workKnown).toBe(true);
  });

  it("detects when assistant probed a slot recently even if unconfirmed", () => {
    const historyMessages = [
      { role: "assistant", content: "你是大叔还是弟弟呀？" },
      { role: "user", content: "你猜猜看" },
    ];
    const slots = extractCustomerDialogueSlots({
      customerProfile: {},
      contact: {},
      messages: [],
      historyMessages,
    });

    expect(slots.ageProbedRecently).toBe(true);

    const photoSlots = extractCustomerDialogueSlots({
      customerProfile: {},
      contact: {},
      messages: [],
      historyMessages: [
        { role: "assistant", content: "近照还没发呢" },
        { role: "assistant", content: "我还没见过你照片呢" },
        { role: "assistant", content: "寸照也行，先看看嘛" },
      ],
    });
    expect(photoSlots.hisPhotoProbedRecently).toBe(true);
  });

  it("physically gates out drawer cards probing known slots in matchActiveDrawers", () => {
    const drawers = {
      topics: [
        {
          id: "probe_age_card",
          name: "探年龄",
          keywords: ["聊聊", "认识"],
          content: "你多大了呀？平时喜欢听什么歌",
          enabled: true,
        },
        {
          id: "probe_marital_card",
          name: "探查岗",
          keywords: ["聊聊", "认识"],
          content: "大半夜聊，你家里那位不查岗呀？",
          enabled: true,
        },
        {
          id: "safe_scene_card",
          name: "真丝睡衣感官",
          keywords: ["聊聊", "认识"],
          content: "刚换上真丝睡裙，身上一点束缚都不想有",
          enabled: true,
        },
      ],
    };

    const slots: CustomerDialogueSlots = {
      ageKnown: true,
      ageValue: "32岁",
      ageProbedRecently: false,
      maritalKnown: true,
      maritalValue: "单身",
      maritalProbedRecently: false,
      locationKnown: false,
      locationValue: "",
      locationProbedRecently: false,
      workKnown: false,
      workValue: "",
      workProbedRecently: false,
      hisPhotoKnown: false,
      hisPhotoProbedRecently: false,
    };

    const results = matchActiveDrawers(drawers, "很高兴认识你 聊聊呗", {
      customerSlots: slots,
    });

    // probe_age_card and probe_marital_card must be physically excluded
    expect(results.some((tip) => tip.includes("probe_age_card"))).toBe(false);
    expect(results.some((tip) => tip.includes("probe_marital_card"))).toBe(false);
    // safe card should pass through
    expect(results.some((tip) => tip.includes("safe_scene_card"))).toBe(true);
  });

  it("injects physical anti-repetition constraint prompt into buildLayeredSystemPrompt", () => {
    const slots: CustomerDialogueSlots = {
      ageKnown: true,
      ageValue: "28岁",
      ageProbedRecently: false,
      maritalKnown: true,
      maritalValue: "单身",
      maritalProbedRecently: false,
      locationKnown: true,
      locationValue: "渝北区",
      locationProbedRecently: false,
      workKnown: true,
      workValue: "做IT",
      workProbedRecently: false,
      hisPhotoKnown: true,
      hisPhotoProbedRecently: false,
    };

    const prompt = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: "我是苏棠",
      platform: "soul",
      messages: [{ role: "user", content: "在干嘛呢" }],
      historyMessages: [],
      homeLocation: { city: "重庆", district: "渝北区" },
      workLocation: { city: "重庆", district: "渝北区" },
      customerSlots: slots,
    });

    expect(prompt).toContain("【已确认的男方档案・绝对禁止重复发问（物理红线）】");
    expect(prompt).toContain("年龄已明确【28岁】");
    expect(prompt).toContain("婚姻状况已明确【单身】");
    expect(prompt).toContain("居住位置已明确【渝北区】");
    expect(prompt).toContain("工作职业已明确【做IT】");
    expect(prompt).toContain("男方照片已明确已看过");
  });

  it("sanitizes assistant output if LLM hallucinates an inquiry about a known slot", () => {
    const slots: CustomerDialogueSlots = {
      ageKnown: true,
      ageValue: "32岁",
      ageProbedRecently: false,
      maritalKnown: true,
      maritalValue: "单身",
      maritalProbedRecently: false,
      locationKnown: true,
      locationValue: "江北区",
      locationProbedRecently: false,
      workKnown: false,
      workValue: "",
      workProbedRecently: false,
      hisPhotoKnown: true,
      hisPhotoProbedRecently: false,
    };

    // Case 1: Inquiry embedded with other natural words
    const reply1 = "哈哈那就好，大半夜聊你家里那位不查岗呀？";
    expect(sanitizeKnownSlotInquiries(reply1, slots)).toBe("哈哈那就好");

    // Case 2: Inquiring age when age is known
    const reply2 = "刚忙完躺下|||对了你多大了呀？";
    expect(sanitizeKnownSlotInquiries(reply2, slots)).toBe("刚忙完躺下");

    // Case 3: Asking photo when his photo is known
    const reply3 = "嘴挺甜的|||发张照片看看长啥样呀";
    expect(sanitizeKnownSlotInquiries(reply3, slots)).toBe("嘴挺甜的");

    // Case 4: Whole reply is just a repeated inquiry -> fallback safely
    const reply4 = "你多大了呀？";
    expect(sanitizeKnownSlotInquiries(reply4, slots)).toBe("挺好的");
  });
});
