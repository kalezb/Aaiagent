import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { onRequest } from "../functions/api/[[route]]";
import {
  MockD1,
  MockKV,
  visionRequest,
} from "./chat-test-helpers";

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

  it("returns all contacts for the dashboard when no device token is selected", async () => {
    const contact = {
      id: 1,
      platform: "soul",
      contact_id: "contact-1",
      contact_name: "期待下一步的我们",
      is_whitelisted: 1,
      notes: "",
      created_at: 1790281839,
    };
    const env = {
      DB: new MockD1([], [{ id: "female", name: "星暮" }], [contact]),
      KV: new MockKV(),
      DASHBOARD_PASSWORD: "secret",
    };

    const response = await onRequest({
      request: new Request("https://example.com/api/contacts?token=", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ contacts: [contact] });
  });

  it("returns all chat history for the dashboard when no device token is selected", async () => {
    const message = {
      id: 1,
      platform: "soul",
      contact_id: "contact-1",
      contact_name: "期待下一步的我们",
      role: "user",
      content: "腿真好看",
      created_at: 1790281839,
    };
    const env = {
      DB: new MockD1([message]),
      KV: new MockKV(),
      DASHBOARD_PASSWORD: "secret",
    };

    const response = await onRequest({
      request: new Request("https://example.com/api/chat/history?token=&limit=50", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ history: [message] });
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

  it("routes image understanding through Gemini when Gemini is selected", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "a red square" } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const kv = new MockKV();
    await kv.put("llm:gemini_model", "gemini-3.8-flash");
    const db = new MockD1();
    db.deviceSettingsRows.set("test-token", {
      platform: "soul",
      hosting_enabled: 1,
      monitor_enabled: 1,
      weather_enabled: 0,
      time_enabled: 0,
      reply_pace_sec: 0,
      ai_hours_enabled: 0,
      ai_start_hour: 8,
      ai_end_hour: 23,
      model_line: "b",
    });
    const env = {
      DB: db,
      KV: kv,
      GEMINI_API_KEY: "gemini-key",
      DEEPSEEK_API_KEY: "deepseek-key",
    };
    const response = await onRequest({
      request: visionRequest(),
      env,
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      description: "a red square",
      provider: "gemini",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer gemini-key");
    expect((init.headers as Record<string, string>)["X-goog-api-key"]).toBe("gemini-key");
    const payload = JSON.parse(String(init.body));
    expect(payload.model).toBe("gemini-3.8-flash");
    expect(payload.reasoning_effort).toBe("low");
    expect(payload.thinking).toBeUndefined();
  });
});
