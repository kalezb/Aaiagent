import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/[[route]]";

class MockD1 {
  constructor(historyRows = []) {
    this.historyRows = historyRows;
  }

  prepare(sql: string) {
    return {
      all: async () => ({ results: [] }),
      first: async () => null,
      run: async () => ({ success: true }),
      bind: (...params: unknown[]) => ({
        first: async () => {
          if (sql.includes("FROM tokens")) {
            return {
              token: params[0],
              is_active: 1,
              monthly_limit: 100,
              spent: 0,
            };
          }
          return null;
        },
        all: async () => ({
          results: sql.includes("FROM chat_history") ? this.historyRows : [],
        }),
        run: async () => ({ success: true }),
      }),
    };
  }

  async batch(statements: unknown[]) {
    return statements.map(() => ({ success: true }));
  }
}

class MockKV {
  private store = new Map<string, string>();

  async get(key: string, type?: string): Promise<unknown> {
    const value = this.store.get(key) ?? null;
    return type === "json" && value ? JSON.parse(value) : value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

function visionRequest(imageBase64 = "ZmFrZS1pbWFnZQ==") {
  return new Request("https://example.com/api/vision/describe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify({
      image_base64: imageBase64,
      mime_type: "image/jpeg",
      prompt: "describe image",
    }),
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("chat logic", () => {
  it("detects sensitive words", () => {
    const sensitiveWords = [
      "\u501f\u94b1",
      "\u8d26\u53f7",
      "\u5bc6\u7801",
      "\u94f6\u884c\u5361",
    ];
    const containsSensitive = (text: string) =>
      sensitiveWords.some((word) => text.includes(word));

    expect(containsSensitive("\u6211\u60f3\u501f\u94b1")).toBe(true);
    expect(containsSensitive("\u8d26\u53f7\u5bc6\u7801")).toBe(true);
    expect(containsSensitive("\u4eca\u5929\u5929\u6c14\u771f\u597d")).toBe(false);
  });

  it("limits history to 40 recent messages", () => {
    const messages = Array.from({ length: 50 }, (_, index) => ({
      content: `message-${index}`,
    }));
    expect(messages.slice(-40)[0].content).toBe("message-10");
    expect(messages.slice(-40).at(-1)?.content).toBe("message-49");
  });

  it("asks the model for short natural chat messages", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "在的 刚忙完|||你先忙你的|||晚点聊" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "期待下一步的我们",
        contact_name: "期待下一步的我们",
        messages: [{ role: "user", content: "今天忙不忙" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ action: "send" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.max_tokens).toBe(160);
    expect(payload.messages[0].content).toContain("短句聊天风格");
    expect(payload.messages[0].content).toContain("用 ||| 分隔");
  });
});

  it("treats 3am as a normal person's rest period in Beijing time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T19:44:00.000Z"));
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "睡了 被你消息吵醒了 ||| 这么晚还没睡" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "期待下一步的我们",
        contact_name: "期待下一步的我们",
        messages: [{ role: "user", content: "睡了吗" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const prompt = JSON.parse(String(init.body)).messages[0].content;
    expect(prompt).toContain("2026-09-25 03:44:00");
    expect(prompt).toContain("03:44:00（星期五）");
    expect(prompt).toContain("业务消息可以远程回复");
    expect(prompt).toContain("有正常作息和情绪");
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "睡了 被你消息吵醒了 ||| 这么晚还没睡",
    });
  });

  it("formats historical messages in China time instead of server time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T19:44:00.000Z"));
    const historyRows = [
      { id: 1, role: "user", content: "昨晚在吗", created_at: Math.floor(Date.parse("2026-09-24T19:40:00.000Z") / 1000) },
    ];
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "在的" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "期待下一步的我们",
        contact_name: "期待下一步的我们",
        messages: [{ role: "user", content: "在吗" }],
      }),
    });
    await onRequest({
      request,
      env: { DB: new MockD1(historyRows), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const historyMessage = JSON.parse(String(init.body)).messages.find((message) =>
      String(message.content).includes("昨晚在吗"),
    );
    expect(historyMessage.content).toContain("09/25 03:40");
    expect(historyMessage.content).not.toContain("19:40");
  });
describe("vision API", () => {
  it("rejects an invalid device key", async () => {
    const env = {
      DB: new MockD1(),
      KV: new MockKV(),
      DEEPSEEK_API_KEY: "deepseek-key",
    };
    const request = new Request("https://example.com/api/vision/describe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: "ZmFrZQ==" }),
    });

    const response = await onRequest({ request, env } as never);
    expect(response.status).toBe(401);
  });

  it("returns a clear 503 when DeepSeek vision is not configured", async () => {
    const env = { DB: new MockD1(), KV: new MockKV() };
    const response = await onRequest({
      request: visionRequest(),
      env,
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "vision_not_configured",
    });
  });

  it("verifies the dashboard password on the server", async () => {
    const env = { DB: new MockD1(), KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const request = new Request("https://example.com/api/dashboard/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "secret" }),
    });

    const response = await onRequest({ request, env } as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("rejects dashboard access without the password", async () => {
    const env = { DB: new MockD1(), KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const response = await onRequest({
      request: new Request("https://example.com/api/token"),
      env,
    } as never);

    expect(response.status).toBe(401);
  });

  it("allows dashboard access with the password", async () => {
    const env = { DB: new MockD1(), KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const response = await onRequest({
      request: new Request("https://example.com/api/token", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ tokens: [] });
  });

  it("sends image content to deepseek-flash with thinking disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "a yellow cat sticker" } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = {
      DB: new MockD1(),
      KV: new MockKV(),
      DEEPSEEK_API_KEY: "deepseek-key",
    };
    const response = await onRequest({
      request: visionRequest(),
      env,
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      description: "a yellow cat sticker",
      provider: "deepseek",
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer deepseek-key",
    );

    const payload = JSON.parse(String(init.body));
    expect(payload.model).toBe("deepseek-flash");
    expect(payload.thinking).toEqual({ type: "disabled" });
    expect(payload.max_tokens).toBeGreaterThanOrEqual(240);
    expect(payload.messages[0].content).toEqual([
      { type: "text", text: "describe image" },
      {
        type: "image_url",
        image_url: {
          url: "data:image/jpeg;base64,ZmFrZS1pbWFnZQ==",
        },
      },
    ]);
  });

  it("allows an explicit vision key and model override", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "custom description" } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = {
      DB: new MockD1(),
      KV: new MockKV(),
      VISION_API_KEY: "vision-key",
      VISION_API_BASE: "https://vision.example.com/v1/",
      VISION_MODEL: "custom-flash",
    };
    const response = await onRequest({
      request: visionRequest(),
      env,
    } as never);

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://vision.example.com/v1/chat/completions");
    expect(JSON.parse(String(init.body)).model).toBe("custom-flash");
  });
});
