import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_RULES } from "../functions/api/_agent_rule_inventory";
import { defaultDrawersForPersona } from "../functions/api/_persona_drawers";
import { buildSutangRuleHealth } from "../functions/api/_sutang_rule_health";

describe("Su Tang rule health", () => {
  it("shows a clean result for the current defaults and cards", () => {
    const cards = [
      ...(defaultDrawersForPersona("female_sutang").topics || []),
      ...(defaultDrawersForPersona("female_sutang").counters || []),
    ];
    const health = buildSutangRuleHealth(DEFAULT_AGENT_RULES, cards);

    expect(
      health.status,
      JSON.stringify(health.rewritten_rules.filter((item) => !item.ok)),
    ).toBe("ok");
    expect(health.summary).toMatchObject({
      legacy_total: 4,
      legacy_handled: 4,
      legacy_active: 0,
      rewritten_total: 10,
      rewritten_ok: 10,
      cards_total: 4,
      cards_ok: 4,
      retired_cards_total: 40,
      retired_cards_removed: 40,
      residual_conflicts: 0,
    });
  });

  it("shows old active rules and retired cards instead of hiding them behind a total count", () => {
    const rules = DEFAULT_AGENT_RULES.map((rule) => ({ ...rule, deleted_at: 0 })).concat([{
      id: "proactive_style_sutang",
      legacy_rule_id: "proactive_style_sutang",
      persona_id: "female_sutang",
      title: "旧版高位推进方式",
      detail: "高位审视，反复考核，问两次再给联系方式",
      enabled: true,
      deleted_at: 0,
    }]);
    const cards = [
      ...(defaultDrawersForPersona("female_sutang").topics || []),
      ...(defaultDrawersForPersona("female_sutang").counters || []),
    ].concat([{
      id: "scene_18_meeting_arrangement",
      name: "旧见面卡",
      keywords: ["酒店"],
      content: "第一次就白天找个公开地方",
      enabled: true,
    }]);
    const health = buildSutangRuleHealth(rules, cards);

    expect(health.status).toBe("error");
    expect(health.summary.legacy_active).toBe(1);
    expect(health.summary.residual_conflicts).toBeGreaterThan(0);
    expect(health.summary.cards_ok).toBe(4);
    expect(health.summary.retired_cards_removed).toBe(39);
    expect(health.residual_conflicts.some((item) => item.title.includes("旧版"))).toBe(true);
  });
});
