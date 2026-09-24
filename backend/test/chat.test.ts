import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { onRequest } from "../functions/api/[[route]]";

class MockD1 {
  constructor(
    historyRows = [],
    personas = [{ id: "female", name: "星暮" }],
    contactsRows = [],
  ) {
    this.historyRows = historyRows;
    this.personas = personas;
    this.contactsRows = contactsRows;
    this.batchCalls = [];
    this.locationRows = new Map();
    this.options = {};
  }

  withOptions(options) {
    this.options = options || {};
    return this;
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
          if (sql.includes("FROM personas")) {
            return this.personas.find((persona) => persona.id === params[0]) ?? null;
          }
          if (sql.includes("FROM user_locations")) {
            return this.locationRows.get(params[0]) ?? null;
          }
          if (sql.includes("FROM customer_groups g JOIN contact_links")) {
            return this.options.priorityTask ?? null;
          }
          if (sql.includes("FROM manual_replies")) {
            const task = this.options.manualTask ?? null;
            if (!task) return null;
            return sql.includes("WHERE id = ?") && params[0] !== task.id ? null : task;
          }
          if (sql.includes("FROM customer_summaries")) {
            return this.options.customerSummary ?? null;
          }
          if (sql.includes("FROM session_summary")) {
            return this.options.sessionSummary ?? null;
          }
          if (sql.includes("FROM customer_groups")) {
            return (this.options.groups ?? []).find((group) => group.id === params[0]) ?? null;
          }
          if (sql.includes("FROM contact_links")) {
            const links = this.options.contactLinks ?? [];
            if (params.length === 3) {
              return links.find((link) =>
                link.token === params[0] && link.platform === params[1] && link.contact_id === params[2]
              ) ?? null;
            }
            return links[0] ?? null;
          }
          return null;
        },
        all: async () => {
          if (sql.includes("FROM customer_groups g JOIN contact_links")) {
            return { results: this.options.priorityTask ? [this.options.priorityTask] : [] };
          }
          if (sql.includes("FROM customer_groups")) return { results: this.options.groups ?? [] };
          if (sql.includes("FROM contact_links")) return { results: this.options.contactLinks ?? [] };
          if (sql.includes("FROM customer_summaries")) return { results: this.options.customerSummaries ?? [] };
          if (sql.includes("FROM session_summary")) return { results: this.options.sessionSummaries ?? [] };
          if (sql.includes("FROM contacts")) return { results: this.contactsRows };
          if (sql.includes("FROM chat_history")) return { results: this.historyRows };
          return { results: [] };
        },
        run: async () => {
          if (sql.includes("INSERT INTO user_locations")) {
            const [token, homeCity, homeDistrict, workCity, workDistrict, updatedAt] = params;
            this.locationRows.set(token, {
              home_city: homeCity,
              home_district: homeDistrict,
              work_city: workCity,
              work_district: workDistrict,
              updated_at: updatedAt,
            });
          }
          return { success: true };
        },
      }),
    };
  }

  async batch(statements: unknown[]) {
    this.batchCalls.push(statements);
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
    expect(payload.messages[0].content).toContain("对方夸奖外貌、穿搭、身材、照片或动态时");
    expect(payload.messages[0].content).toContain("直接自然接住夸奖");
  });

  it("removes time and sleep comments when the other person did not mention time", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "谢谢 你眼光不错 ||| 你怎么这个点还醒着" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "测试联系人",
        contact_name: "测试联系人",
        messages: [{ role: "user", content: "你这高跟鞋真好看" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "谢谢 你眼光不错",
    });
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
  it("activates the selected persona with a valid device key", async () => {
    const db = new MockD1([], [
      { id: "female", name: "星暮" },
      { id: "male_chenyu", name: "陈屿" },
    ]);
    const request = new Request("https://example.com/api/config/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_key: "test-token",
        action: "activate_persona",
        persona_id: "male_chenyu",
      }),
    });

    const response = await onRequest({
      request,
      env: { DB: db, KV: new MockKV() },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      active_persona_id: "male_chenyu",
      active_persona_name: "陈屿",
    });
    expect(db.batchCalls).toHaveLength(1);
    expect(db.batchCalls[0]).toHaveLength(2);
  });

  it("persists multiple device locations and returns the latest one from config", async () => {
    const db = new MockD1();
    const saveLocation = (homeCity: string, homeDistrict: string, workCity: string, workDistrict: string) =>
      onRequest({
        request: new Request("https://example.com/api/config/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device_key: "test-token",
            action: "save_location",
            home_city: homeCity,
            home_district: homeDistrict,
            work_city: workCity,
            work_district: workDistrict,
          }),
        }),
        env: { DB: db, KV: new MockKV() },
      } as never);

    const firstResponse = await saveLocation("重庆", "渝北区", "成都", "高新区");
    await expect(firstResponse.json()).resolves.toMatchObject({
      success: true,
      location: {
        home: { city: "重庆", district: "渝北区" },
        work: { city: "成都", district: "高新区" },
      },
    });

    const secondResponse = await saveLocation("北京", "朝阳区", "上海", "浦东新区");
    await expect(secondResponse.json()).resolves.toMatchObject({
      success: true,
      location: {
        home: { city: "北京", district: "朝阳区" },
        work: { city: "上海", district: "浦东新区" },
      },
    });

    const configResponse = await onRequest({
      request: new Request("https://example.com/api/config", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env: { DB: db, KV: new MockKV() },
    } as never);

    await expect(configResponse.json()).resolves.toMatchObject({
      location: {
        home: { city: "北京", district: "朝阳区" },
        work: { city: "上海", district: "浦东新区" },
      },
    });
  });

  it("rejects incomplete location updates", async () => {
    const response = await onRequest({
      request: new Request("https://example.com/api/config/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_key: "test-token",
          action: "save_location",
          home_city: "重庆",
          home_district: "",
          work_city: "重庆",
          work_district: "两江新区",
        }),
      }),
      env: { DB: new MockD1(), KV: new MockKV() },
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ success: false });
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
});

describe("customer dashboard and cross-platform memory", () => {
  it("returns unified customers and marks every bound platform", async () => {
    const contacts = [
      { token: "test-token", platform: "soul", contact_id: "soul-a", contact_name: "梦想", is_whitelisted: 1, notes: "", created_at: 1 },
      { token: "test-token", platform: "qq", contact_id: "qq-a", contact_name: "积极", is_whitelisted: 1, notes: "", created_at: 2 },
    ];
    const history = [
      { id: 1, token: "test-token", platform: "soul", contact_id: "soul-a", contact_name: "梦想", role: "user", content: "高跟鞋那张很有气质", created_at: 10 },
      { id: 2, token: "test-token", platform: "qq", contact_id: "qq-a", contact_name: "积极", role: "assistant", content: "谢谢 你眼光不错", created_at: 11 },
    ];
    const db = new MockD1(history, [], contacts).withOptions({
      groups: [{ id: "group:1", token: "test-token", display_name: "王先生", notes: "", priority_reply: 1, created_at: 1 }],
      contactLinks: [
        { group_id: "group:1", token: "test-token", platform: "soul", contact_id: "soul-a", contact_name: "梦想" },
        { group_id: "group:1", token: "test-token", platform: "qq", contact_id: "qq-a", contact_name: "积极" },
      ],
    });
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };

    const response = await onRequest({
      request: new Request("https://example.com/api/customer-groups?q=%E9%AB%98%E8%B7%9F%E9%9E%8B&token=test-token", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]).toMatchObject({
      id: "group:1",
      display_name: "王先生",
      priority_reply: true,
      platforms: ["soul", "qq"],
    });
  });

  it("uses bound platform history in the reply prompt", async () => {
    const history = [
      { id: 10, token: "test-token", platform: "soul", contact_id: "soul-a", contact_name: "梦想", role: "user", content: "我周末有空", created_at: 100 },
      { id: 11, token: "test-token", platform: "qq", contact_id: "qq-a", contact_name: "积极", role: "assistant", content: "那就周六见", created_at: 101 },
    ];
    const db = new MockD1(history).withOptions({
      contactLinks: [
        { group_id: "group:shared", token: "test-token", platform: "soul", contact_id: "soul-a", contact_name: "梦想" },
        { group_id: "group:shared", token: "test-token", platform: "qq", contact_id: "qq-a", contact_name: "积极" },
      ],
    });
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "周末见" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "soul-a",
          contact_name: "梦想",
          messages: [{ role: "user", content: "周六有空吗" }],
        }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const promptMessages = JSON.parse(String(init.body)).messages;
    expect(promptMessages[0].content).toContain("记忆必须连续");
    expect(promptMessages.some((message) => String(message.content).includes("[qq"))).toBe(true);
    expect(promptMessages.some((message) => String(message.content).includes("那就周六见"))).toBe(true);
  });

  it("pulls and completes dashboard manual replies", async () => {
    const task = {
      id: "manual-1",
      platform: "soul",
      contact_id: "soul-a",
      contact_name: "梦想",
      group_id: "group:1",
      content: "我晚点联系你",
      status: "pending",
      created_at: 100,
    };
    const db = new MockD1().withOptions({ manualTask: task });
    const env = { DB: db, KV: new MockKV() };
    const nextResponse = await onRequest({
      request: new Request("https://example.com/api/reply-tasks/next?platform=soul", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env,
    } as never);
    await expect(nextResponse.json()).resolves.toMatchObject({
      task: { id: "manual-1", type: "manual", content: "我晚点联系你" },
    });

    const resultResponse = await onRequest({
      request: new Request("https://example.com/api/reply-tasks/result", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ task_id: "manual-1", status: "sent" }),
      }),
      env,
    } as never);
    expect(resultResponse.status).toBe(200);
    await expect(resultResponse.json()).resolves.toMatchObject({ success: true, status: "sent" });
  });

  it("does not bind filtered dashboard rows by list index", () => {
    const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
    expect(source).not.toContain("data-bind-index");
    expect(source).toContain("data-contact-id");
    expect(source).toContain("replace_aliases: true");
  });
});
