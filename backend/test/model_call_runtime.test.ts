import { describe, expect, it } from "vitest";
import { estimateLlmCost } from "../functions/api/_model_call_runtime";

describe("model call runtime", () => {
  it("uses provider-specific pricing without leaking it into chat logic", () => {
    const cost = estimateLlmCost({
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
    }, {
      GEMINI_INPUT_COST_PER_MILLION: 1,
      GEMINI_OUTPUT_COST_PER_MILLION: 2,
    }, { provider: "gemini" });
    expect(cost).toBe(3);
  });

  it("keeps a minimum charge so a tiny call is still visible", () => {
    expect(estimateLlmCost({ usage: {} }, {}, { provider: "deepseek" })).toBe(0.001);
  });
});
