import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEMINI_MODEL,
  buildModelHeaders,
  buildModelRequestPayload,
  isGeminiModelConfig,
  loadLlmConfig,
} from "../functions/api/_model_runtime";

class MemoryKv {
  values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }
}

describe("model runtime", () => {
  it("keeps provider-specific request differences inside the model layer", () => {
    expect(buildModelRequestPayload(
      { provider: "deepseek" },
      "deepseek-v4-flash",
      [{ role: "user", content: "hi" }],
      0.5,
      120,
    )).toMatchObject({
      thinking: { type: "disabled" },
      max_tokens: 120,
    });

    expect(buildModelRequestPayload(
      { provider: "gemini" },
      "gemini-3.8-flash",
      [{ role: "user", content: "hi" }],
      0.5,
      320,
    )).toMatchObject({
      reasoning_effort: "low",
      max_tokens: 320,
    });
  });

  it("adds the Gemini key header only for Gemini", () => {
    expect(buildModelHeaders("secret", { provider: "gemini" })).toMatchObject({
      Authorization: "Bearer secret",
      "X-goog-api-key": "secret",
    });
    expect(buildModelHeaders("secret", { provider: "deepseek" })).not.toHaveProperty("X-goog-api-key");
  });

  it("loads line A and line B from the same stored configuration", async () => {
    const kv = new MemoryKv();
    kv.values.set("llm:model", "deepseek-v4-flash");
    kv.values.set("llm:gemini_model", DEFAULT_GEMINI_MODEL);
    kv.values.set("llm:base_url", "https://api.deepseek.com/v1");
    kv.values.set("llm:gemini_base_url", "https://generativelanguage.googleapis.com/v1beta/openai");

    const lineA = await loadLlmConfig(kv, { DEEPSEEK_API_BASE: "https://api.deepseek.com/v1" }, "a");
    const lineB = await loadLlmConfig(kv, { GEMINI_API_KEY: "gemini-key" }, "b");

    expect(lineA).toMatchObject({
      provider: "deepseek",
      modelName: "deepseek-v4-flash",
      apiKeyOverride: "",
    });
    expect(lineB).toMatchObject({
      provider: "gemini",
      modelName: DEFAULT_GEMINI_MODEL,
      apiKeyOverride: "gemini-key",
    });
    expect(isGeminiModelConfig(lineB)).toBe(true);
    expect(isGeminiModelConfig(lineA)).toBe(false);
  });
});
