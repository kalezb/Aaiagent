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
    this.conversationStatsRows = [];
    this.profileRows = new Map();
    this.runCalls = [];
    this.options = {};
  }

  withOptions(options) {
    this.options = options || {};
    return this;
  }

  historyKey(statement) {
    const params = statement.params || [];
    return `${params[0]}\u0000${params[8] || ""}`;
  }

  applyHistoryInsert(statement) {
    const params = statement.params || [];
    const key = this.historyKey(statement);
    if (params[8] && this.historyRows.some((row) => `${row.token}\u0000${row.message_key || ""}` === key)) {
      return 0;
    }
    const id = Math.max(0, ...this.historyRows.map((row) => Number(row.id || 0))) + 1;
    this.historyRows.push({
      id,
      token: params[0],
      platform: params[1],
      contact_id: params[2],
      contact_name: params[3],
      role: params[4],
      content: params[5],
      created_at: params[6],
      source: params[7],
      message_key: params[8],
    });
    return 1;
  }

  applyConversationStats(statement) {
    const p = statement.params || [];
    const key = `${p[0]}\u0000${p[1]}\u0000${p[2]}`;
    let row = this.conversationStatsRows.find((item) => `${item.token}\u0000${item.platform}\u0000${item.contact_id}` === key);
    if (!row) {
      row = { token: p[0], platform: p[1], contact_id: p[2], message_count: 0, latest_at: 0 };
      this.conversationStatsRows.push(row);
    }
    row.contact_name = p[3];
    row.message_count += Number(p[4] || 0);
    if (Number(p[9] || 0) >= Number(row.latest_at || 0)) {
      row.latest_role = p[6];
      row.latest_content = p[7];
      row.latest_source = p[8];
      row.latest_at = p[9];
    }
    row.updated_at = p[10];
  }

  applyStatement(statement) {
    const sql = statement.sql || "";
    if (sql.includes("INSERT OR IGNORE INTO chat_history") || sql.includes("INSERT INTO chat_history")) {
      return this.applyHistoryInsert(statement);
    }
    if (sql.includes("INSERT INTO conversation_stats")) {
      this.applyConversationStats(statement);
      return 1;
    }
    if (sql.includes("INSERT INTO customer_profiles")) {
      const p = statement.params || [];
      this.profileRows.set(`${p[0]}\u0000${p[1]}`, {
        token: p[0], group_id: p[1], profile_json: p[2], last_processed_message_id: p[3], extracted_at: p[4], updated_at: p[5],
      });
      return 1;
    }
    return 1;
  }

  prepare(sql: string) {
    return {
      all: async () => ({ results: [] }),
      first: async () => null,
      run: async () => ({ success: true }),
      bind: (...params: unknown[]) => ({
        sql,
        params,
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
          if (sql.includes("COUNT(*) AS user_count")) {
            return this.options.profileState ?? { user_count: 0, max_id: 0 };
          }
          if (sql.includes("FROM conversation_stats")) {
            return this.conversationStatsRows.find((row) =>
              row.token === params[0] && row.platform === params[1] && row.contact_id === params[2]
            ) ?? null;
          }
          if (sql.includes("FROM customer_profiles")) {
            return this.profileRows.get(`${params[0]}\u0000${params[1]}`) ?? null;
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
          if (sql.includes("FROM conversation_stats")) return { results: this.conversationStatsRows };
          if (sql.includes("FROM chat_history")) {
            const sinceId = sql.includes("id > ?")
              ? Number(params[sql.includes("LIMIT ?") ? params.length - 2 : params.length - 1] || 0)
              : 0;
            return { results: this.historyRows.filter((row) => Number(row.id || 0) > sinceId) };
          }
          return { results: [] };
        },
        run: async () => {
          this.runCalls.push({ sql, params });
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
          const changes = this.applyStatement({ sql, params });
          return { success: true, meta: { changes } };
        },
      }),
    };
  }

  async batch(statements: unknown[]) {
    this.batchCalls.push(statements);
    return statements.map((statement) => ({
      success: true,
      meta: { changes: this.applyStatement(statement) },
    }));
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
  it("limits raw history to 10 recent messages", () => {
    const messages = Array.from({ length: 50 }, (_, index) => ({
      content: `message-${index}`,
    }));
    expect(messages.slice(-10)[0].content).toBe("message-40");
    expect(messages.slice(-10).at(-1)?.content).toBe("message-49");
  });

  it("passes base persona, platform, location, time and role context to the model", async () => {
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
        location: { home: { city: "重庆", district: "两江新区" }, work: { city: "重庆", district: "两江新区" } },
        messages: [{ role: "user", content: "今天忙不忙" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "在的 刚忙完|||你先忙你的|||晚点聊",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.max_tokens).toBe(160);
    expect(payload.messages[0].content).toContain("当前平台：soul");
    expect(payload.messages[0].content).not.toContain("语气：");
    expect(payload.messages[0].content).not.toContain("偏文艺");
    expect(payload.messages[0].content).toContain("你住在重庆两江新区");
    expect(payload.messages[0].content).toContain("在重庆两江新区上班");
    expect(payload.messages[0].content).toContain("你说\"是你之前发的话");
    expect(payload.messages[0].content).not.toContain("短句聊天风格");
    expect(payload.messages[0].content).not.toContain("直接自然接住夸奖");
  });

  it("uses a compact profile and only ten recent unique history messages", async () => {
    const history = [{
      id: 16,
      token: "test-token",
      platform: "soul",
      contact_id: "contact-1",
      contact_name: "梦想",
      role: "user",
      content: "刚发的问题",
      created_at: 115,
    }, ...Array.from({ length: 15 }, (_, index) => {
      const number = 15 - index;
      return {
        id: number,
        token: "test-token",
        platform: "soul",
        contact_id: "contact-1",
        contact_name: "梦想",
        role: number % 2 === 0 ? "user" : "assistant",
        content: `历史-${number}`,
        created_at: 100 + number,
      };
    })];
    const db = new MockD1(history).withOptions({
      contactLinks: [{ group_id: "group:shared", token: "test-token", platform: "soul", contact_id: "contact-1", contact_name: "梦想" }],
    });
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    db.profileRows.set("test-token\u0000group:shared", {
      profile_json: JSON.stringify({ basic: { name: "张先生", gender: "男" }, preferences: { hobbies: ["羽毛球"], likes: ["爬山"] }, notes: [""] }),
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "周末有空" } }] }), {
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
          contact_id: "contact-1",
          contact_name: "梦想",
          messages: [
            { role: "user", content: "刚发的问题", created_at: 115 },
            { role: "user", content: "明天的安排呢" },
          ],
        }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const promptMessages = JSON.parse(String(init.body)).messages;
    expect(promptMessages[0].content).toContain("【长期客户档案】");
    expect(promptMessages[0].content).toContain('"name":"张先生"');
    expect(promptMessages[0].content).not.toContain('"notes"');
    const rawHistoryLines = promptMessages.filter((message) => String(message.content).startsWith("[soul "));
    expect(rawHistoryLines.length).toBeLessThanOrEqual(10);
    expect(rawHistoryLines.some((message) => String(message.content).includes("刚发的问题"))).toBe(false);
    expect(promptMessages.filter((message) => String(message.content).includes("刚发的问题"))).toHaveLength(1);
    expect(promptMessages.some((message) => String(message.content).includes("明天的安排呢"))).toBe(true);
  });

  it("keeps real message time as context without applying a stale reply policy", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T00:59:00.000Z"));
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "刚忙完 隔了几天才看到 ||| 中秋快乐 吃月饼没" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "桃子幺幺",
        contact_name: "桃子幺幺",
        messages: [{
          role: "user",
          content: "中秋来了",
          timestamp: "9月22日 06:59",
          created_at: Math.floor(Date.parse("2026-09-21T22:59:00.000Z") / 1000),
        }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    expect(await response.json()).toMatchObject({
      action: "send",
      reply: "刚忙完 隔了几天才看到|||中秋快乐 吃月饼没",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.messages[0].content).not.toContain("不要假装刚刚看到");
    expect(payload.messages[0].content).not.toContain("不提刚忙完");
    expect(payload.messages.at(-1).content).toBe("[9月22日 06:59，距今约74小时] 对方说：中秋来了");
  });

  it("does not infer staleness from unrelated database history", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T00:59:00.000Z"));
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "在的" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const historyRows = [
      { id: 1, role: "user", content: "旧消息", created_at: Math.floor(Date.parse("2026-09-21T00:00:00.000Z") / 1000) },
    ];
    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "contact-1",
        contact_name: "测试联系人",
        messages: [{ role: "user", content: "在吗" }],
      }),
    });
    await onRequest({
      request,
      env: { DB: new MockD1(historyRows), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const prompt = JSON.parse(String(init.body)).messages[0].content;
    expect(prompt).not.toMatch(/对方最后一条消息是 \d+ 小时前发的/);
  });

  it("removes leaked time and speaker prefixes from the model reply", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "\u91cd\u5e86", condition: "\u6674", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "[22:15] \u4f60\u8bf4\uff1a\u4e0d\u5c31\u90a3\u4e2ayyds\u561b \u6211\u770b\u5230\u4e86" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "contact-1",
        contact_name: "contact-1",
        messages: [{ role: "user", content: "\u77e5\u9053\u6211\u53d1\u7684\u4ec0\u4e48\u8868\u60c5\u4e0d\uff1f" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "\u4e0d\u5c31\u90a3\u4e2ayyds\u561b \u6211\u770b\u5230\u4e86",
    });
  });

  it("removes leaked prefixes from later reply lines and pipe segments", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "给谁 你对象啊|||你说：我眯了啊 明天还一堆单子|||[09/25 03:40] 明天还得跑单子" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "contact-3",
        contact_name: "contact-3",
        messages: [{ role: "user", content: "在吗" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "给谁 你对象啊|||我眯了啊 明天还一堆单子|||明天还得跑单子",
    });
  });

  it("does not remove speaker words that are part of normal reply text", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "\u91cd\u5e86", condition: "\u6674", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "\u4f60\u8bf4\u5462 \u6211\u8fd8\u5728\u770b\u6d88\u606f" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "contact-2",
        contact_name: "contact-2",
        messages: [{ role: "user", content: "\u5728\u5417" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "\u4f60\u8bf4\u5462 \u6211\u8fd8\u5728\u770b\u6d88\u606f",
    });
  });

  it("returns the model reply without post-processing", async () => {
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
      reply: "谢谢 你眼光不错|||你怎么这个点还醒着",
    });
  });
});

  it("passes Beijing time to the model without injecting a rest-period policy", async () => {
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
    expect(prompt).toContain("星期五");
    expect(prompt).not.toContain("业务消息可以远程回复");
    expect(prompt).not.toContain("有正常作息和情绪");
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "睡了 被你消息吵醒了|||这么晚还没睡",
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

  it("does not return platform style restrictions in app config", async () => {
    const response = await onRequest({
      request: new Request("https://example.com/api/config", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env: { DB: new MockD1(), KV: new MockKV() },
    } as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).not.toHaveProperty("platform_style_hints");
  });

  it("removes the voice and sticker repulsion rule from persona seed data", () => {
    const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
    const legacyMigration = readFileSync(new URL("../db/migrations/20260925_four_personas.sql", import.meta.url), "utf8");
    const removalMigration = readFileSync(new URL("../db/migrations/20260926_remove_media_repulsion_rule.sql", import.meta.url), "utf8");
    const builtFunctions = readFileSync(new URL("../dist-func/index.js", import.meta.url), "utf8");

    expect(schema).not.toContain("对方发语音或表情后告知以后别发，你反感");
    expect(legacyMigration).not.toContain("对方发语音或表情后告知以后别发，你反感");
    expect(removalMigration).toContain("UPDATE personas");
    expect(removalMigration).toContain("REPLACE(");
    expect(builtFunctions).not.toContain("PLATFORM_STYLE_HINTS");
    expect(builtFunctions).not.toContain("platform_style_hints");
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
    db.conversationStatsRows = [
      { token: "test-token", platform: "soul", contact_id: "soul-a", contact_name: "梦想", message_count: 3, latest_role: "user", latest_content: "高跟鞋那张很有气质", latest_at: 10 },
      { token: "test-token", platform: "qq", contact_id: "qq-a", contact_name: "积极", message_count: 4, latest_role: "assistant", latest_content: "谢谢 你眼光不错", latest_at: 11 },
    ];
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
      message_count: 7,
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

  it("ships the sky-blue customer dashboard layout and profile panel", () => {
    const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
    const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
    expect(html).toContain("grid-template-columns: 360px minmax(0, 1fr) 310px");
    expect(html).toContain("--sky: #42a5f5");
    expect(html).toContain('id="profilePlatformLinks"');
    expect(html).toContain('id="mobileSidebarButton"');
    expect(html).toContain("同一客户在 Soul、QQ、陌陌、连信上的聊天会合并为同一段记忆");
    expect(source).toContain("function renderProfilePanel(group)");
    expect(source).toContain('class="pf ${active.has(platform.id)');
  });
});

describe("monitoring sync and customer profile batching", () => {
  it("deduplicates synced messages and preserves the original source", async () => {
    const db = new MockD1();
    const env = { DB: db, KV: new MockKV() };
    const body = {
      platform: "soul",
      contact_id: "contact-1",
      contact_name: "梦想",
      messages: [{
        message_key: "sync:soul:contact-1:one",
        role: "assistant",
        content: "我在呢",
        source: "human_phone",
        created_at: 100,
      }],
    };
    const send = () => onRequest({
      request: new Request("https://example.com/api/messages/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify(body),
      }),
      env,
    } as never);

    const first = await send();
    const second = await send();
    await expect(first.json()).resolves.toMatchObject({ ok: true, accepted: 1, inserted: 1 });
    await expect(second.json()).resolves.toMatchObject({ ok: true, accepted: 1, inserted: 0 });
    expect(db.historyRows).toHaveLength(1);
    expect(db.historyRows[0]).toMatchObject({ source: "human_phone", message_key: "sync:soul:contact-1:one" });
    expect(db.conversationStatsRows[0]).toMatchObject({ message_count: 1, latest_source: "human_phone" });
  });

  it("returns only messages newer than the dashboard cursor", async () => {
    const history = [
      { id: 10, token: "test-token", platform: "soul", contact_id: "contact-1", contact_name: "梦想", role: "user", content: "旧消息", source: "sync", created_at: 10 },
      { id: 11, token: "test-token", platform: "soul", contact_id: "contact-1", contact_name: "梦想", role: "assistant", content: "新消息", source: "ai", created_at: 11 },
    ];
    const db = new MockD1(history).withOptions({
      groups: [{ id: "group:shared", token: "test-token", display_name: "梦想", notes: "", priority_reply: 0 }],
      contactLinks: [{ group_id: "group:shared", token: "test-token", platform: "soul", contact_id: "contact-1", contact_name: "梦想" }],
    });
    const response = await onRequest({
      request: new Request("https://example.com/api/customer-messages?token=test-token&group_id=group%3Ashared&since_id=10", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env: { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      latest_id: 11,
      messages: [{ id: 11, source: "ai", content: "新消息" }],
    });
  });

  it("does not spend profile tokens before 40 new user messages", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1().withOptions({ profileState: { user_count: 39, max_id: 39 } });
    const response = await onRequest({
      request: new Request("https://example.com/api/messages/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ platform: "soul", contact_id: "contact-1", contact_name: "梦想", messages: [{ role: "user", content: "我喜欢打球", created_at: 100 }] }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps cloudflare polling inside the free-plan request budget", () => {
    const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
    expect(source).toContain("window.setInterval(refreshVisibleData, 10000)");
  });

  it("does not rewrite the visible user transcript on every AI reply", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "在的 刚忙完" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1();
    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "contact-1",
        contact_name: "期待下一步的我们",
        messages: [{ role: "user", content: "在吗" }],
      }),
    });

    const response = await onRequest({
      request,
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    expect(db.historyRows).toHaveLength(1);
    expect(db.historyRows[0]).toMatchObject({ role: "assistant", source: "ai", content: "在的 刚忙完" });
  });

  it("uses deepseek-flash JSON output once the 40-message profile batch is ready", async () => {
    const history = Array.from({ length: 40 }, (_, index) => ({
      id: index + 1,
      token: "test-token",
      platform: "soul",
      contact_id: "contact-1",
      contact_name: "梦想",
      role: "user",
      content: index === 39 ? "我喜欢羽毛球" : `普通聊天${index + 1}`,
      source: "sync",
      created_at: 100 + index,
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ basic: { name: "张先生" }, preferences: { hobbies: ["羽毛球"] } }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1(history).withOptions({ profileState: { user_count: 40, max_id: 40 } });
    const response = await onRequest({
      request: new Request("https://example.com/api/messages/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ platform: "soul", contact_id: "contact-1", contact_name: "梦想", messages: [{ role: "user", content: "最近好吗", created_at: 140 }] }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    const payload = JSON.parse(String(init.body));
    expect(payload.model).toBe("deepseek-flash");
    expect(payload.thinking).toEqual({ type: "disabled" });
    expect(payload.response_format).toEqual({ type: "json_object" });
    expect(payload.messages[1].content).toContain("我喜欢羽毛球");
  });
});
