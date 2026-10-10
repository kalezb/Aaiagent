import { describe, expect, it } from "vitest";
import {
  normalizeAgentRuleGate,
  RULE_PREVIEW_CASES,
} from "../functions/api/_agent_rule_runtime";

describe("agent rule runtime", () => {
  it("keeps every rule inside the four declared gates", () => {
    expect(normalizeAgentRuleGate("input")).toBe("input");
    expect(normalizeAgentRuleGate("unknown")).toBe("prompt");
  });

  it("keeps original and merged preview text separate", () => {
    expect(RULE_PREVIEW_CASES.facts_consistency.original).not.toBe(
      RULE_PREVIEW_CASES.facts_consistency.merged,
    );
    expect(Object.keys(RULE_PREVIEW_CASES)).toEqual(expect.arrayContaining([
      "facts_consistency",
      "reply_shape",
      "old_message",
      "non_user_input",
      "photo_execution",
      "history_budget",
    ]));
  });
});
