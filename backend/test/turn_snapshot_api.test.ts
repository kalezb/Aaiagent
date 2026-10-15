import { describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/[[route]]";
import { MockD1, MockKV } from "./chat-test-helpers";

describe("chat turn snapshot gate", () => {
  it("asks the phone to resync before a model call when the snapshot does not match", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          request_id: "snapshot-mismatch-1",
          platform: "soul",
          contact_id: "snapshot-contact",
          contact_name: "快照测试",
          messages: [{ role: "user", content: "你说多少", created_at: 100 }],
          snapshot: {
            turn_id: "turn-1",
            message_count: 2,
            last_message_at: 100,
            capture_complete: true,
          },
        }),
      }),
      env: { DB: new MockD1(), KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "resync",
      reason: "snapshot_message_count_mismatch",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets a complete matching snapshot reach the model normally", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "在的" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          request_id: "snapshot-match-1",
          platform: "soul",
          contact_id: "snapshot-ok",
          contact_name: "快照正常",
          messages: [{ role: "user", content: "你好", created_at: 100 }],
          snapshot: {
            turn_id: "turn-ok",
            message_count: 1,
            last_message_at: 100,
            capture_complete: true,
          },
        }),
      }),
      env: { DB: new MockD1(), KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "在的",
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
  });
});
