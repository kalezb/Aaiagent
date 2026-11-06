import { describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/[[route]]";
import { resolvePhotoExchangeGate } from "../functions/api/_photo_exchange_policy";
import { MockD1, MockKV } from "./chat-test-helpers";

describe("photo exchange policy", () => {
  it("follows the confirmed photo order", () => {
    expect(resolvePhotoExchangeGate()).toMatchObject({
      canSend: false,
      stage: "ask_him_first",
    });
    expect(resolvePhotoExchangeGate({
      hisPhotoInCurrentTurn: true,
    })).toMatchObject({
      canSend: false,
      stage: "just_received",
    });
    expect(resolvePhotoExchangeGate({
      hisPhotoSeenBeforeThisTurn: true,
    })).toMatchObject({
      canSend: true,
      stage: "ready",
    });
    expect(resolvePhotoExchangeGate({
      herPhotoSeenBeforeThisTurn: true,
    })).toMatchObject({
      canSend: true,
      stage: "already_shared",
    });
    expect(resolvePhotoExchangeGate({
      ruleEnabled: false,
    })).toMatchObject({
      canSend: true,
      stage: "rule_disabled",
    });
  });

  it("asks him for a photo first instead of sending one", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", trigger_keywords: "换个照片", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "first-photo-request",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "换个照片看看？" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      action: "send",
      reason: "photo_exchange_gate",
      photo_gate: "his_photo_not_seen",
    });
    expect(body.media).toBeUndefined();
    expect(body.reply).toContain("先");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send a photo in the same turn his photo arrives", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", trigger_keywords: "换个照片", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "photo-arrived-this-turn",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [
            { role: "user", content: "[图片]" },
            { role: "user", content: "换个照片看看？" },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      action: "send",
      reason: "photo_exchange_gate",
      photo_gate: "his_photo_arrived_this_turn",
    });
    expect(body.media).toBeUndefined();
    expect(body.reply).toContain("看到了");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets the dashboard switch this photo rule off immediately", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", trigger_keywords: "换个照片", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    db.agentRuleRows.set("photo-gate-disabled", {
      id: "photo-gate-disabled",
      legacy_rule_id: "her_photo_memory",
      persona_id: "",
      title: "照片交换顺序",
      detail: "当前关闭",
      gate: "execution",
      priority: 50,
      enabled: 0,
      sort_order: 0,
      source: "dashboard",
      deleted_at: 0,
    });
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "photo-gate-rule-disabled",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "换个照片看看？" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send_media");
    expect(body.media.group_id).toBe("daily");
  });
});
