import { describe, expect, it, vi } from "vitest";
import { handleVisionConfigRequest } from "../functions/api/_vision_config_api";

describe("vision and device config API", () => {
  it("leaves unrelated requests for the main route", async () => {
    const response = await handleVisionConfigRequest({
      request: new Request("https://example.com/api/chat"),
      env: {},
      path: "/api/chat",
      method: "POST",
    });
    expect(response).toBeNull();
  });

  it("keeps vision behind a device key", async () => {
    const response = await handleVisionConfigRequest({
      request: new Request("https://example.com/api/vision/describe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: "abc" }),
      }),
      env: {
        DB: {
          prepare: () => ({
            bind: () => ({ first: async () => null }),
          }),
        },
      },
      path: "/api/vision/describe",
      method: "POST",
    });
    expect(response?.status).toBe(401);
  });

  it("saves a device line without hitting an undeclared cache variable", async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: any[]) => ({
          first: async () =>
            sql.includes("SELECT token") ? { token: "device-1" } : null,
          run: async () => ({ success: true }),
          params,
        }),
      }),
    };
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    };
    const response = await handleVisionConfigRequest({
      request: new Request("https://example.com/api/config/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_key: "device-1", action: "switch_line", line: "b" }),
      }),
      env: { DB: db, KV: kv },
      path: "/api/config/save",
      method: "POST",
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      success: true,
      line: "b",
    });
  });

  it("handles /api/vision/ground with unauthorized key", async () => {
    const response = await handleVisionConfigRequest({
      request: new Request("https://example.com/api/vision/ground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: "abc" }),
      }),
      env: {
        DB: {
          prepare: () => ({
            bind: () => ({ first: async () => null }),
          }),
        },
      },
      path: "/api/vision/ground",
      method: "POST",
    });
    expect(response?.status).toBe(401);
  });

  it("handles /api/vision/ground and parses target coordinates", async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: any[]) => ({
          first: async () => {
            if (sql.includes("SELECT token")) return { token: "device-test" };
            if (sql.includes("device_settings")) return { model_line: "a" };
            if (sql.includes("monthly_token_usage")) return { total_tokens: 0 };
            return null;
          },
          run: async () => ({ success: true }),
          params,
        }),
      }),
    };
    const kv = {
      get: vi.fn(async () => null),
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              has_popup: true,
              popup_kind: "meme_bar",
              action: "click",
              target_point: { x: 171, y: 2346 },
              normalized_point: { x: 0.140, y: 0.865 },
              confidence: 0.98,
              reason: "悬浮表情栏关闭按钮",
            }),
          },
        }],
        usage: { total_tokens: 100 },
      }),
    })) as any;

    try {
      const response = await handleVisionConfigRequest({
        request: new Request("https://example.com/api/vision/ground", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer device-test",
          },
          body: JSON.stringify({
            image_base64: "dGVzdA==",
            screen_width: 1220,
            screen_height: 2712,
            intent: "close_meme_bar",
          }),
        }),
        env: {
          DB: db,
          KV: kv,
          DEEPSEEK_API_KEY: "mock-deepseek-key",
          GEMINI_API_KEY: "mock-gemini-key",
          GEMINI_MODEL: "gemini-2.5-flash",
        },
        path: "/api/vision/ground",
        method: "POST",
      });

      expect(response?.status).toBe(200);
      const jsonResult = await response?.json();
      expect(jsonResult).toMatchObject({
        success: true,
        has_popup: true,
        popup_kind: "meme_bar",
        action: "click",
        target_point: { x: 171, y: 2346 },
        confidence: 0.98,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
