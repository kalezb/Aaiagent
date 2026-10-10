import { describe, expect, it } from "vitest";
import { handleEntryMediaRequest } from "../functions/api/_entry_media_api";

describe("entry and media API", () => {
  it("leaves unrelated requests for the main route", async () => {
    const response = await handleEntryMediaRequest({
      request: new Request("https://example.com/api/chat"),
      env: {},
      path: "/api/chat",
      method: "POST",
    });
    expect(response).toBeNull();
  });

  it("reports health without touching auth", async () => {
    const db = {
      prepare: () => ({ first: async () => ({ 1: 1 }) }),
    };
    const response = await handleEntryMediaRequest({
      request: new Request("https://example.com/api/status"),
      env: { DB: db },
      path: "/api/status",
      method: "GET",
    });
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("rejects a wrong dashboard password", async () => {
    const response = await handleEntryMediaRequest({
      request: new Request("https://example.com/api/dashboard/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong" }),
      }),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      path: "/api/dashboard/login",
      method: "POST",
    });
    expect(response?.status).toBe(401);
  });

  it("keeps private media behind a device key", async () => {
    const response = await handleEntryMediaRequest({
      request: new Request("https://example.com/api/media/media_1"),
      env: {
        DB: {
          prepare: () => ({
            bind: () => ({ first: async () => null }),
          }),
        },
      },
      path: "/api/media/media_1",
      method: "GET",
    });
    expect(response?.status).toBe(401);
  });
});
