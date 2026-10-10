import { describe, expect, it } from "vitest";
import { parseFunnelStateRow } from "../functions/api/_funnel_runtime";

describe("funnel runtime", () => {
  it("turns a stored funnel row into the shared state shape", () => {
    const state = parseFunnelStateRow({
      stage: 3,
      user_turn_count: 7,
      evidence_json: JSON.stringify({ willingToRecycle: true }),
      evaluation_quote_sent: 0,
      completed: 0,
    });
    expect(state.stage).toBe(3);
    expect(state.userTurnCount).toBe(7);
    expect(state.evidence.willingToRecycle).toBe(true);
  });
});
