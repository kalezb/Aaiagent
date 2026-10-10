import { describe, expect, it } from "vitest";
import {
  createTimeoutSignal,
  json,
  parseJsonBody,
  resolveChatLlmTimeoutMs,
} from "../functions/api/_http_runtime";

describe("http runtime", () => {
  it("returns a json response without changing the caller payload", async () => {
    const response = json({ ok: true }, 201);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects malformed and oversized request bodies", async () => {
    const malformed = await parseJsonBody(new Request("https://example.com", {
      method: "POST",
      body: "{",
    }));
    expect(malformed).toMatchObject({ error: "invalid_json", status: 400 });

    const oversized = await parseJsonBody(new Request("https://example.com", {
      method: "POST",
      body: "12345",
    }), 3);
    expect(oversized).toMatchObject({ error: "request_too_large", status: 413 });
  });

  it("keeps timeout settings bounded", () => {
    expect(resolveChatLlmTimeoutMs({ CHAT_LLM_TIMEOUT_MS: "50" })).toBe(50);
    expect(resolveChatLlmTimeoutMs({ CHAT_LLM_TIMEOUT_MS: "999999" })).toBe(60_000);
    expect(createTimeoutSignal(1)).toBeInstanceOf(AbortSignal);
  });
});
