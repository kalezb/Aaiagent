import { describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/[[route]]";
import { MockD1, MockKV } from "./chat-test-helpers";

describe("sticker reply API", () => {
  it.each([
    "[小害羞]",
    "[表情包:偷笑]",
    "对方发来 Soul 官方表情「偷笑」",
  ])("lets sticker content reach the model: %s", async (stickerContent) => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      if (!String(url).includes("/chat/completions")) {
        return new Response(JSON.stringify({ location: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          choices: [{
            message: { role: "assistant", content: "这表情 是在偷偷笑什么呢" },
            finish_reason: "stop",
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "sticker-reply-1",
          platform: "soul",
          contact_id: "sticker-contact",
          contact_name: "表情联系人",
          messages: [{ role: "user", content: stickerContent, created_at: 1_700_000_000 }],
        }),
      }),
      env: {
        DB: new MockD1(),
        KV: kv,
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.action).toBe("send");
    expect(body.reason).not.toBe("sticker_state_only");
  });
});
