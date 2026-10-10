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
});
