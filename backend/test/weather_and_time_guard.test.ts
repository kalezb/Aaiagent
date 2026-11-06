import { describe, expect, it } from "vitest";
import { defaultDrawersForPersona, matchActiveDrawers } from "../functions/api/_persona_drawers";
import { isFragmentedMessage, buildFragmentedMessageGuidance } from "../functions/api/_reply_policy";

describe("时空与天气代码守门员 & 半截话承接机制", () => {
  const sutangDrawers = defaultDrawersForPersona("female_sutang");

  describe("新知识卡门槛", () => {
    it("旧天气和家务卡已经彻底退出，不再因为天气或腰酸触发", () => {
      const text = matchActiveDrawers(sutangDrawers, "外面下雨了 后背好酸 今天好热", {
        weatherCondition: "小雨",
        weatherTemp: 34,
        currentHour: 15,
        totalExchanges: 20,
        maturityGateEnabled: true,
      }).join("\n");
      expect(text).not.toContain("sutang_home_tired");
      expect(text).not.toContain("sutang_hot_day");
      expect(text).not.toContain("sutang_cold_day");
      expect(text).not.toContain("sutang_nice_weather");
    });

    it("白天满5轮才了解对方的工作与出行，前4轮只当普通聊天", () => {
      const before = matchActiveDrawers(sutangDrawers, "今天下雨 上班堵车吗", {
        currentHour: 15,
        currentMinute: 15 * 60,
        totalExchanges: 4,
        maturityGateEnabled: true,
      }).join("\n");
      expect(before).not.toContain("scene_sutang_probe_spending");

      const ready = matchActiveDrawers(sutangDrawers, "今天下雨 上班堵车吗", {
        currentHour: 15,
        currentMinute: 15 * 60,
        totalExchanges: 5,
        maturityGateEnabled: true,
      }).join("\n");
      expect(ready).toContain("scene_sutang_probe_spending");
      expect(ready).toContain("还是坐办公室");
      expect(ready).not.toContain("外面下雨路不好走");
    });

    it("深夜卡必须同时满足21:00和满10轮", () => {
      const tooEarly = matchActiveDrawers(sutangDrawers, "洗完澡 睡不着", {
        currentHour: 20,
        currentMinute: 20 * 60 + 59,
        totalExchanges: 10,
        maturityGateEnabled: true,
      }).join("\n");
      expect(tooEarly).not.toContain("scene_sutang_night_empty");

      const notFamiliar = matchActiveDrawers(sutangDrawers, "洗完澡 睡不着", {
        currentHour: 21,
        currentMinute: 21 * 60,
        totalExchanges: 9,
        maturityGateEnabled: true,
      }).join("\n");
      expect(notFamiliar).not.toContain("scene_sutang_night_empty");

      const ready = matchActiveDrawers(sutangDrawers, "洗完澡 睡不着", {
        currentHour: 21,
        currentMinute: 21 * 60,
        totalExchanges: 10,
        maturityGateEnabled: true,
      }).join("\n");
      expect(ready).toContain("scene_sutang_night_empty");
      expect(ready).toContain("屋里太静了");

      const afterMidnight = matchActiveDrawers(sutangDrawers, "洗完澡 睡不着", {
        currentHour: 1,
        currentMinute: 60,
        totalExchanges: 10,
        maturityGateEnabled: true,
      }).join("\n");
      expect(afterMidnight).toContain("scene_sutang_night_empty");

      const morning = matchActiveDrawers(sutangDrawers, "洗完澡 睡不着", {
        currentHour: 5,
        currentMinute: 5 * 60,
        totalExchanges: 10,
        maturityGateEnabled: true,
      }).join("\n");
      expect(morning).not.toContain("scene_sutang_night_empty");
    });
  });

  describe("时间守门员 (Time Slot Gating)", () => {
    it("白天和深夜都不再保留旧的深夜哄睡卡", () => {
      const matched = matchActiveDrawers(sutangDrawers, "这个点孩子睡了吗", {
        currentHour: 14,
      });
      const text = matched.join("\n");
      expect(text).not.toContain("scene_15_after_child_sleep");
      expect(text).not.toContain("刚把孩子哄睡");
    });

    it("深夜讨论宝宝时也不会再命中旧电商和哄睡混在一起的卡片", () => {
      const matched = matchActiveDrawers(sutangDrawers, "这个点孩子睡了吗", {
        currentHour: 22,
      });
      const text = matched.join("\n");
      expect(text).not.toContain("scene_15_after_child_sleep");
      expect(text).not.toContain("报表");
    });

    it("下午不会命中深夜卡，旧深夜卡也不存在", () => {
      const text = matchActiveDrawers(sutangDrawers, "失眠 睡不着怎么办", {
        currentHour: 15,
        currentMinute: 15 * 60,
        totalExchanges: 20,
        maturityGateEnabled: true,
      }).join("\n");
      expect(text).not.toContain("scene_sutang_night_empty");
      expect(text).not.toContain("sutang_late_night_alone");
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

    it("生成接话指引：有上文工作话题时，只顺着方向关心，不瞎猜细节", () => {
      const guidance = buildFragmentedMessageGuidance("好累", [
        { role: "assistant", content: "今天上班开了一天会 到现在还没缓过来" },
      ]);
      expect(guidance).toContain("半截话承接");
      expect(guidance).toContain("工作");
      expect(guidance).toContain("不要瞎猜对方的具体细节");
    });

    it("生成接话指引：无明确上文时先接情绪，不挑衅也不催", () => {
      const guidance = buildFragmentedMessageGuidance("唉……", []);
      expect(guidance).toContain("半截话承接");
      expect(guidance).toContain("绝对不要脑补猜测具体发生何事");
      expect(guidance).toContain("先接住他的情绪");
      expect(guidance).not.toContain("高位");
    });
  });
});
