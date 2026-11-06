import { describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/[[route]]";
import { MockD1, MockKV } from "./chat-test-helpers";

describe("model text rescue", () => {
  async function runRescue(content: string) {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      if (!String(url).includes("/chat/completions")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      callCount += 1;
      const resolved = callCount < 3 ? "   " : content;
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: resolved }, finish_reason: "stop" }],
          usage: { completion_tokens: 8 },
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
          request_id: `text-rescue-${callCount}-${Date.now()}`,
          platform: "soul",
          contact_id: "text-rescue",
          contact_name: "text-rescue",
          messages: [{ role: "user", content: "在干嘛" }],
        }),
      }),
      env: { DB: new MockD1(), KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    return { response, callCount };
  }

  it("uses a plain-text rescue call when repeated JSON replies contain only spaces", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).includes("/chat/completions")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      callCount += 1;
      bodies.push(JSON.parse(String(init?.body || "{}")));
      const content = callCount < 3 ? "   " : "在呢";
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { completion_tokens: 3 },
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
          request_id: "space-reply-text-rescue-1",
          platform: "soul",
          contact_id: "space-reply",
          contact_name: "space-reply",
          messages: [{ role: "user", content: "在干嘛" }],
        }),
      }),
      env: { DB: new MockD1(), KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    expect(callCount).toBe(3);
    const body = await response.json();
    expect(body).toMatchObject({
      action: "send",
      reply: "在呢",
    });
    expect(bodies[0].response_format).toEqual({ type: "json_object" });
    expect(bodies[1].response_format).toEqual({ type: "json_object" });
    expect(bodies[2].response_format).toBeUndefined();
  });

  it("turns a JSON-formatted rescue reply back into normal chat bubbles", async () => {
    const { response, callCount } = await runRescue(
      '{"messages":["知道啦","你吃了吗"]}',
    );
    expect(callCount).toBe(3);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reply).toBe("知道啦|||你吃了吗");
    expect(body.reply).not.toMatch(/[{}]|messages|```/u);
  });

  it("strips a code fence from a rescue reply before sending", async () => {
    const { response, callCount } = await runRescue(
      '```json\n{"messages":["在呢","你忙你的"]}\n```',
    );
    expect(callCount).toBe(3);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reply).toBe("在呢|||你忙你的");
    expect(body.reply).not.toMatch(/[{}]|messages|```/u);
  });
});
