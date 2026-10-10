import { describe, expect, it } from "vitest";
import { handleMessageSyncRequest } from "../functions/api/_message_sync_api";

describe("message sync API", () => {
  it("leaves unrelated requests for the main route", async () => {
    const response = await handleMessageSyncRequest({
      request: new Request("https://example.com/api/chat"),
      env: {},
      context: {},
      path: "/api/chat",
      method: "POST",
    });
    expect(response).toBeNull();
  });

  it("keeps message sync behind a device key", async () => {
    const db = {
      prepare: () => ({
        bind: () => ({ first: async () => null }),
      }),
    };
    const response = await handleMessageSyncRequest({
      request: new Request("https://example.com/api/messages/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      env: { DB: db },
      context: {},
      path: "/api/messages/sync",
      method: "POST",
    });
    expect(response?.status).toBe(401);
  });
});
