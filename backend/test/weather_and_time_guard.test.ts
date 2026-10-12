import { describe, expect, it } from "vitest";
import { defaultDrawersForPersona, matchActiveDrawers } from "../functions/api/_persona_drawers";
import { isFragmentedMessage, buildFragmentedMessageGuidance } from "../functions/api/_reply_policy";

describe("时空与天气代码守门员 & 半截话承接机制", () => {
  const sutangDrawers = defaultDrawersForPersona("female_sutang");

  describe("天气守门员 (Weather Gating)", () => {
    it("晴天且用户未主动提雨时，绝不误触【阴雨连绵与颈背酸胀】卡片（防穿帮）", () => {
      const matched = matchActiveDrawers(sutangDrawers, "坐一天办公室 后背好酸", {
        weatherCondition: "晴",
        weatherTemp: 26,
        currentHour: 15,
      });
      const text = matched.join("\n");
      expect(text).not.toContain("scene_14_rainy_neck");
      expect(text).not.toContain("外面下雨路不好走");
    });

    it("真在下雨（小雨/中雨/雷阵雨）时，用户提到酸痛能正常命中雨天卡片", () => {
      const matched = matchActiveDrawers(sutangDrawers, "后背好酸 坐了一整天", {
        weatherCondition: "小雨",
        weatherTemp: 20,
        currentHour: 19,
      });
      const text = matched.join("\n");
      expect(text).toContain("scene_14_rainy_neck");
      expect(text).toContain("外面下雨路不好走");
    });

    it("即使天气数据不是雨天，但对方主动提起下雨时，尊重当前对话上下文允许命中", () => {
      const matched = matchActiveDrawers(sutangDrawers, "外面突然下暴雨了 我后背酸得不行", {
        weatherCondition: "多云",
        weatherTemp: 25,
        currentHour: 18,
      });
      const text = matched.join("\n");
      expect(text).toContain("scene_14_rainy_neck");
    });

    it("烈日高温（>=30度或天气为晴/热）时，命中夏日冷气续命卡片", () => {
      const matched = matchActiveDrawers(sutangDrawers, "外面好热 太阳晒死人了", {
        weatherCondition: "晴",
        weatherTemp: 34,
        currentHour: 14,
      });
      const text = matched.join("\n");
      expect(text).toContain("scene_23_sunny_hot_summer");
      expect(text).toContain("烈日大热与冷气续命");
      expect(text).toContain("空调房里续命");
    });

    it("降温大风（<=10度或寒风天气）时，命中降温保暖卡片", () => {
      const matched = matchActiveDrawers(sutangDrawers, "今天降温了 风吹得直打哆嗦", {
        weatherCondition: "阴",
        weatherTemp: 6,
        currentHour: 16,
      });
      const text = matched.join("\n");
      expect(text).toContain("scene_24_cold_wind_winter");
      expect(text).toContain("降温大风与保暖包裹");
      expect(text).toContain("厚羊绒大衣");
    });

    it("舒适天气微风时，可命中舒适微风江边漫步卡片", () => {
      const matched = matchActiveDrawers(sutangDrawers, "今天天气真舒服 微风吹着很惬意", {
        weatherCondition: "多云",
        weatherTemp: 22,
        currentHour: 17,
      });
      const text = matched.join("\n");
      expect(text).toContain("scene_25_pleasant_breeze");
      expect(text).toContain("舒适微风与江边漫步");
    });
  });

  describe("时间守门员 (Time Slot Gating)", () => {
    it("白天（14点）禁止命中深夜哄睡卡片（防白天说刚把孩子哄睡）", () => {
      const matched = matchActiveDrawers(sutangDrawers, "这个点孩子睡了吗", {
        currentHour: 14,
      });
      const text = matched.join("\n");
      expect(text).not.toContain("scene_15_after_child_sleep");
      expect(text).not.toContain("刚把孩子哄睡");
    });

    it("深夜（22点）讨论宝宝时允许命中深夜哄睡卡片", () => {
      const matched = matchActiveDrawers(sutangDrawers, "这个点孩子睡了吗", {
        currentHour: 22,
      });
      const text = matched.join("\n");
      expect(text).toContain("scene_15_after_child_sleep");
      expect(text).toContain("孩子刚睡稳");
    });

    it("下午（15点）禁止命中深夜失眠卡片", () => {
      const matched = matchActiveDrawers(sutangDrawers, "失眠 睡不着怎么办", {
        currentHour: 15,
      });
      const text = matched.join("\n");
      expect(text).not.toContain("scene_22_late_night_insomnia");
    });
  });

  describe("半截话与碎片词识别与承接", () => {
    it("正确识别叹气、短碎片词与未说完的半截话", () => {
      expect(isFragmentedMessage("唉")).toBe(true);
      expect(isFragmentedMessage("唉……")).toBe(true);
      expect(isFragmentedMessage("好累")).toBe(true);
      expect(isFragmentedMessage("无语")).toBe(true);
      expect(isFragmentedMessage("在？")).toBe(true);
      expect(isFragmentedMessage("其实我……")).toBe(true);
      expect(isFragmentedMessage("那个~")).toBe(true);
    });

    it("正常完整句子不判定为碎片话", () => {
      expect(isFragmentedMessage("你今天晚上打算吃什么呀")).toBe(false);
      expect(isFragmentedMessage("我刚下班到家，今天公司开了一整天会")).toBe(false);
      expect(isFragmentedMessage("我也觉得这个项目做起来挺不容易的")).toBe(false);
    });

    it("碎片话输入时，不盲目带入大段重型场景卡片", () => {
      const matched = matchActiveDrawers(sutangDrawers, "好累", {
        currentHour: 21,
        isFragmented: true,
      });
      // 碎片话不应该误匹配大段场景展开
      expect(matched.length).toBe(0);
    });

    it("生成高情商接话指引：有上文工作话题时，轻推测+反问推拉", () => {
      const guidance = buildFragmentedMessageGuidance("好累", [
        { role: "assistant", content: "今天盯了一下午投流和电商店铺数据 眼睛都看酸了" },
      ]);
      expect(guidance).toContain("半截话承接");
      expect(guidance).toContain("工作");
      expect(guidance).toContain("不要瞎猜对方的具体细节");
    });

    it("生成高情商接话指引：无明确上文时，高位慵懒推拉踢球", () => {
      const guidance = buildFragmentedMessageGuidance("唉……", []);
      expect(guidance).toContain("半截话承接");
      expect(guidance).toContain("绝对不要脑补猜测具体发生何事");
      expect(guidance).toContain("话讲一半 吊谁胃口呢");
    });
  });
});
