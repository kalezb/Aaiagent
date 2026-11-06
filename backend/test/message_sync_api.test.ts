import { describe, expect, it } from "vitest";
import { handleMessageSyncRequest } from "../functions/api/_message_sync_api";
import { onRequest } from "../functions/api/[[route]]";
import { MockD1, MockKV } from "./chat-test-helpers";

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

  it("keeps the same words when the same person says them again", async () => {
    const db = new MockD1();
    const now = Math.floor(Date.now() / 1000);
    const response = await onRequest({
      request: new Request("https://example.com/api/messages/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "repeat-contact",
          contact_name: "重复消息",
          messages: [
            {
              role: "user",
              content: "还在躺着呢",
              source: "sync",
              created_at: now - 20,
              message_key: "repeat-1",
            },
            {
              role: "user",
              content: "还在躺着呢",
              source: "sync",
              created_at: now - 5,
              message_key: "repeat-2",
            },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV() },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      accepted: 2,
      inserted: 2,
    });
    expect(db.historyRows).toHaveLength(2);
  });

  it("corrects an old message time when the page now gives a real time", async () => {
    const db = new MockD1([
      {
        id: 1,
        token: "test-token",
        platform: "soul",
        contact_id: "time-contact",
        contact_name: "夜凄凉",
        role: "user",
        content: "还在躺着呢",
        created_at: 1_000,
        source: "sync",
        message_key: "stable-message",
        persona_id: "",
        persona_version: 0,
        time_kind: "first_observed",
      },
    ]);
    const response = await onRequest({
      request: new Request("https://example.com/api/messages/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "time-contact",
          contact_name: "夜凄凉",
          messages: [{
            role: "user",
            content: "还在躺着呢",
            source: "sync",
            created_at: 1_180,
            message_key: "stable-message",
            time_kind: "ui_explicit",
          }],
        }),
      }),
      env: { DB: db, KV: new MockKV() },
    } as never);

    expect(response.status).toBe(200);
    expect(db.historyRows[0]).toMatchObject({
      created_at: 1_180,
      time_kind: "ui_explicit",
    });
  });
});
