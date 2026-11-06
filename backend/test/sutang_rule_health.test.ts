import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_RULES } from "../functions/api/_agent_rule_inventory";
import { defaultDrawersForPersona } from "../functions/api/_persona_drawers";
import { buildSutangRuleHealth } from "../functions/api/_sutang_rule_health";

describe("Su Tang rule health", () => {
  it("shows a clean result for the current defaults and cards", () => {
    const drawers = defaultDrawersForPersona("female_sutang");
    const cards = [...(drawers.topics || []), ...(drawers.counters || [])];
    const health = buildSutangRuleHealth(DEFAULT_AGENT_RULES, cards);

    expect(
      health.status,
      JSON.stringify(health.rewritten_rules.filter((item) => !item.ok)),
    ).toBe("ok");
    expect(health.summary).toMatchObject({
      legacy_total: 0,
      legacy_handled: 0,
      legacy_active: 0,
      rewritten_total: 10,
      rewritten_ok: 10,
      cards_total: 4,
      cards_ok: 4,
      retired_cards_total: 0,
      retired_cards_removed: 0,
      residual_conflicts: 0,
    });
  });

  it("warns when a current rule is missing", () => {
    const rules = DEFAULT_AGENT_RULES.filter((rule) => rule.id !== "sutang_action_ladder");
    const drawers = defaultDrawersForPersona("female_sutang");
    const cards = [...(drawers.topics || []), ...(drawers.counters || [])];
    const health = buildSutangRuleHealth(rules, cards);

    expect(health.status).toBe("warn");
    expect(health.summary.rewritten_ok).toBe(9);
    expect(health.rewritten_rules.find((item) => item.key === "sutang_action_ladder")?.state).toBe("missing");
  });
});
