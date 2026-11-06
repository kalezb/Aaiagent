import { describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/[[route]]";
import { MockD1, MockKV } from "./chat-test-helpers";

describe("final follow-up bubbles", () => {
  it("preserves the model's final bubbles without a second rewrite", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const history = [{
      id: 1,
      token: "test-token",
      platform: "soul",
      contact_id: "follow-up-bubble-contact",
      role: "assistant",
      content: "今天在家休息吗？",
      created_at: nowSec - 60,
      source: "ai",
      message_key: "previous-question",
      persona_id: "female",
      persona_version: 0,
      time_kind: "ai_generated",
    }];
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                messages: ["我刚睡醒", "就别怕我当真？"],
              }),
            },
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "follow-up-bubble-test",
          platform: "soul",
          contact_id: "follow-up-bubble-contact",
          contact_name: "追问测试",
          messages: [{ role: "user", content: "我刚睡醒", created_at: nowSec }],
        }),
      }),
      env: {
        DB: new MockD1(history),
        KV: new MockKV(),
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    const data = (await response.json()) as Record<string, any>;
    expect(data.action).toBe("send");
    expect(data.reply).toBe("我刚睡醒|||就别怕我当真？");
    expect(data.reply_parts).toEqual(["我刚睡醒", "就别怕我当真？"]);
  });
});
