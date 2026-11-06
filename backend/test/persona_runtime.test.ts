import { describe, expect, it } from "vitest";
import {
  effectivePersonaDrawers,
  mergeDrawerCards,
  stripRetiredSutangDrawers,
  stripForeignPersonaSegments,
} from "../functions/api/_persona_runtime";
import { matchActiveDrawers } from "../functions/api/_persona_drawers";
import { RETIRED_SUTANG_DRAWER_IDS } from "../functions/api/_persona_drawers_data";

describe("persona runtime", () => {
  it("merges stored card overrides without changing default cards", () => {
    const merged = mergeDrawerCards(
      [{
        id: "style",
        name: "默认",
        content: "默认内容",
        enabled: true,
        minExchanges: 5,
        afterMinute: 22 * 60,
        beforeMinute: 23 * 60,
      }],
      [{ id: "style", name: "改过的", content: "新内容" }],
      "lore",
    );
    expect(merged[0]).toMatchObject({
      id: "style",
      name: "改过的",
      content: "新内容",
      minExchanges: 5,
      afterMinute: 22 * 60,
      beforeMinute: 23 * 60,
      source: "default",
    });
  });

  it("keeps personas and cards available through one runtime drawer shape", () => {
    const drawers = effectivePersonaDrawers("female_sutang", { custom: [] });
    expect(drawers).toHaveProperty("topics");
    expect(drawers).toHaveProperty("counters");
    expect(drawers).toHaveProperty("custom");
    expect(drawers.topics?.find((item) => item.id === "scene_sutang_night_empty")).toMatchObject({
      minExchanges: 10,
      afterMinute: 21 * 60,
    });
  });

  it("does not revive deleted default cards from old cloud backups", () => {
    const merged = mergeDrawerCards(
      [],
      [{ id: "sofa_tired", name: "下班瘫沙发", content: "旧内容", enabled: true }],
      "topic",
      { includeUnknown: false },
    );
    expect(merged).toEqual([]);

    const drawers = effectivePersonaDrawers("female_sutang", {
      topics: [
        { id: "sofa_tired", name: "下班瘫沙发", content: "旧内容", enabled: true },
        { id: "scene_01_black_stockings", name: "改过的黑丝卡", content: "新内容", enabled: true },
      ],
      counters: [{ id: "flirt_praise", name: "旧被夸卡", content: "旧内容", enabled: true }],
      custom: [],
    });
    expect(drawers.topics.some((item) => item.id === "sofa_tired")).toBe(false);
    expect(drawers.counters.some((item) => item.id === "flirt_praise")).toBe(false);
    expect(drawers.topics.some((item) => item.id === "scene_01_black_stockings")).toBe(false);
  });

  it("drops every retired Su Tang knowledge card and keeps only the new card set", () => {
    const retiredCards = RETIRED_SUTANG_DRAWER_IDS.map((id) => ({
      id,
      name: "旧苏棠卡",
      content: "第一次就白天找个公开地方\n私密房间也不去",
      enabled: true,
    }));
    const drawers = effectivePersonaDrawers("female_sutang", {
      topics: retiredCards,
      custom: [{
        id: "custom_keep",
        name: "自己加的知识",
        content: "保留这条",
        enabled: true,
      }],
    });
    const byId = new Map(drawers.topics.map((card) => [card.id, card]));
    for (const id of RETIRED_SUTANG_DRAWER_IDS) {
      expect(byId.has(id)).toBe(false);
    }
    expect(byId.has("scene_sutang_probe_spending")).toBe(true);
    expect(byId.has("scene_sutang_night_empty")).toBe(true);
    expect(byId.has("scene_sutang_intimate_questions")).toBe(true);
    expect(byId.has("scene_sutang_hotel_co_booking_pay")).toBe(false);
    expect(byId.has("scene_sutang_invite_refusal")).toBe(true);
    expect(drawers.custom.find((card) => card.id === "custom_keep")?.content).toBe("保留这条");

    const cleaned = stripRetiredSutangDrawers({
      topics: retiredCards,
      custom: [{ id: "custom_keep", content: "保留这条" }],
    });
    expect(cleaned.changed).toBe(true);
    expect(cleaned.value.topics).toEqual([]);
    expect(cleaned.value.custom?.[0]?.id).toBe("custom_keep");
  });

  it("prefers the card with more and more precise keyword hits", () => {
    const matched = matchActiveDrawers({
      custom: [
        {
          id: "broad",
          name: "宽泛被窝卡",
          keywords: ["被窝"],
          content: "宽泛内容",
          enabled: true,
          priority: 100,
        },
        {
          id: "precise",
          name: "失眠卡",
          keywords: ["被窝凉", "睡不着"],
          content: "失眠内容",
          enabled: true,
          priority: 95,
        },
      ],
    }, "今晚被窝凉 睡不着", { maxKeywordCards: 1 });
    expect(matched.join("\n")).toContain("失眠卡");
    expect(matched.join("\n")).not.toContain("宽泛被窝卡");
  });

  it("removes only the segments that contain another persona's identity", () => {
    expect(stripForeignPersonaSegments("你好呀|||我是星暮", ["星暮"])).toBe("你好呀");
    expect(stripForeignPersonaSegments("我是星暮", ["星暮"])).toBe("");
  });
});
