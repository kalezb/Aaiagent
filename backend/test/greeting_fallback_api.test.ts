import { describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/[[route]]";
import { MockD1, MockKV } from "./chat-test-helpers";

describe("greeting fallback API", () => {
  it("uses a natural local reply when a plain greeting gets empty model output twice", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    const db = new MockD1();
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string | URL | Request) => {
      if (!String(url).includes("/chat/completions")) {
        return new Response(JSON.stringify({ location: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      callCount += 1;
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "" }, finish_reason: "stop" }],
          usage: { completion_tokens: 0 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }));

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "greeting-empty-fallback",
          platform: "soul",
          contact_id: "greeting-contact",
          contact_name: "哈喽联系人",
          messages: [{ role: "user", content: "哈喽另一面的你" }],
        }),
      }),
      env: {
        DB: db,
        KV: kv,
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.action).toBe("send");
    expect(String(body.reply || "")).toMatch(/哈喽呀|嗨/);
    expect(callCount).toBe(2);
  });
});
