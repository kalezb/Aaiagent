import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import { onRequest } from "../functions/api/[[route]]";
import { buildLayeredSystemPrompt } from "../functions/api/_reply_policy";
import {
  defaultDrawersForPersona,
  matchActiveDrawers,
} from "../functions/api/_persona_drawers";
import { loadAgentRuleState } from "../functions/api/_agent_rule_runtime";
import {
  DEFAULT_PROGRAM_RULES,
  PROGRAM_RULES_KV_KEY,
} from "../functions/api/_program_rules";
import {
  MockD1,
  MockKV,
  mockChatSequence,
} from "./chat-test-helpers";

describe("chat core", () => {
  it("keeps up to 20 recent raw messages for conversational continuity", () => {
    const messages = Array.from({ length: 50 }, (_, index) => ({
      content: `message-${index}`,
    }));
    expect(messages.slice(-20)[0].content).toBe("message-30");
    expect(messages.slice(-20).at(-1)?.content).toBe("message-49");
  });

  it("ships compact persona cards instead of per-turn style manuals", () => {
    const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
    expect(schema).toContain("你是王雅慧，对外叫星暮，熟了叫慧慧");
    expect(schema).toContain("做二手手机和废旧数码回收，主要走线上寄件和同城上门");
    expect(schema).not.toContain("已婚未育");
    expect(schema).not.toContain("公婆");
    expect(schema).toContain('"marital_status":"divorced"');
    expect(schema).not.toContain("每条回复50字以内");
    expect(schema).not.toContain("以后是否给QQ由系统门槛决定");
  });

  it("adds bounded flirting to Xingmu without making it a global task", () => {
    const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
    const migration = readFileSync(
      new URL("../db/migrations/20261002_add_bounded_flirting_to_xingmu.sql", import.meta.url),
      "utf8",
    );
    const rule = "会撩，但必须先看场合、看对方反应、看关系阶段；该收的时候马上收。";

    expect(schema).toContain(rule);
    expect(migration).toContain(rule);
    expect(migration).toContain("WHERE id = 'female'");
  });

  it("passes base persona, platform, location, time and role context to the model", async () => {
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
        request_id: "reply-request-1",
        platform: "soul",
        contact_id: "期待下一步的我们",
        contact_name: "期待下一步的我们",
        self_nickname: "另一面的我",
        location: { home: { city: "重庆", district: "两江新区" }, work: { city: "重庆", district: "两江新区" } },
        messages: [{ role: "user", content: "今天忙不忙" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({
      action: "send",
      reply: "在的",
    });
    expect(responseBody.request_id).toBe("reply-request-1");
    expect(responseBody.timing).toMatchObject({
      llm_budget_ms: 10_000,
      repair_attempted: false,
    });
    expect(responseBody.timing.llm_ms).toBeGreaterThanOrEqual(0);
    expect(responseBody.timing.total_ms).toBeGreaterThanOrEqual(0);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const payload = JSON.parse(String(init.body));
    expect(payload.max_tokens).toBe(96);
    expect(payload.messages[0].content).toContain("【交流方式】");
    expect(payload.messages[0].content).toContain("每段3到20个字，最多三条，必须把意思表达清楚");
    expect(payload.messages[0].content).toContain("每轮最多一个问号；上一轮已经问过，这一轮就不要再问");
    expect(payload.messages[0].content).toContain("不要连续两轮只接不推进");
    expect(payload.messages[0].content).toContain("【真人节奏】");
    expect(payload.messages[0].content).toContain("【语气与漏斗分离】");
    expect(payload.messages[0].content).toContain("【事实与边界】");
    expect(payload.messages[0].content).toContain("【当前平台】soul。");
    expect(payload.messages[0].content).toContain("【当前平台账号昵称】你在soul上的账号昵称是“另一面的我”");
    expect(payload.messages[0].content).toContain("不代表其他平台昵称");
    expect(payload.messages[0].content).toContain("【人物事实｜最高优先级】");
    expect(payload.messages[0].content).toContain("现居地：重庆两江新区");
    expect(payload.messages[0].content).toContain("工作地：重庆江北区");
    expect(payload.messages[0].content).toContain("【关系前提】你们是在 Soul 匹配或附近加上，还没见过面。");
    expect(payload.messages[0].content).toContain("【新客节奏】");
    expect(payload.messages[0].content).not.toContain("【当前天气】");
    expect(payload.messages[0].content).toContain("你们刚在 Soul 匹配上，还没见过。当前只做认识，不要提前推进业务。");
    expect(payload.messages[0].content).toContain("【星暮六段漏斗】认识阶段");
    expect(payload.messages[0].content).toContain("【本轮接话】");
    expect(payload.messages[0].content).toContain("【对方原话事实】今天忙不忙");
    expect(payload.messages[0].content).toContain("不能把“睡醒了、还没睡”改写成“睡得香、睡着了”");
    expect(payload.messages[0].content).not.toContain("最新消息优先");
    expect(payload.messages[0].content).not.toContain("话题锁定");
  });

  it("retries the upstream once with current messages only when history is rejected", async () => {
    const kv = new MockKV();
    const history = Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      token: "test-token",
      platform: "soul",
      contact_id: "墨染清秋",
      contact_name: "墨染清秋",
      role: index % 2 === 0 ? "user" : "assistant",
      content: `历史消息-${index}`,
      created_at: Math.floor(Date.now() / 1000) - 3600 + index,
      source: index % 2 === 0 ? "sync" : "ai",
      message_key: `history-${index}`,
      persona_id: index % 2 === 0 ? "" : "female_sutang",
    }));
    const db = new MockD1(history, [{ id: "female_sutang", name: "苏棠", system_prompt: "你是苏棠。" }]);
    db.tokenPersonas.set("test-token", "female_sutang");

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).includes("/chat/completions")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      callCount += 1;
      if (callCount === 1) {
        const body = JSON.parse(String(init?.body || "{}"));
        const hasHistory = body.messages.some((message) => String(message.content).includes("历史消息-"));
        expect(hasHistory).toBe(true);
        return new Response(
          JSON.stringify({ error: { message: "upstream rejected history" } }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      if (callCount === 2) {
        const body = JSON.parse(String(init?.body || "{}"));
        expect(body.messages.some((message) => String(message.content).includes("历史消息-"))).toBe(false);
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "精简重试成功" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "upstream-history-retry-1",
          platform: "soul",
          contact_id: "墨染清秋",
          contact_name: "墨染清秋",
          messages: [{ role: "user", content: "你是哪里的" }],
        }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "精简重试成功",
    });
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("skips without calling the model when the latest message is ours", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "last-message-from-self-1",
          platform: "soul",
          contact_id: "handled-contact",
          contact_name: "已回过的人",
          messages: [
            { role: "user", content: "在吗" },
            { role: "assistant", content: "在呢" },
          ],
        }),
      }),
      env: { DB: new MockD1(), KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "skip",
      reason: "last_message_from_self",
      request_id: "last-message-from-self-1",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses dashboard markers to drop platform notices before the model call", async () => {
    const kv = new MockKV();
    await kv.put(PROGRAM_RULES_KV_KEY, JSON.stringify({
      ...DEFAULT_PROGRAM_RULES,
      platformNotice: {
        enabled: true,
        markers: ["自定义提醒"],
      },
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "custom-platform-notice-1",
          platform: "soul",
          contact_id: "notice-contact",
          contact_name: "平台提示测试",
          messages: [{ role: "user", content: "【自定义提醒】对方正在输入……" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "skip",
      reason: "platform_notice",
      request_id: "custom-platform-notice-1",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the dashboard fixed reply for an untranscribed voice", async () => {
    const kv = new MockKV();
    await kv.put(PROGRAM_RULES_KV_KEY, JSON.stringify({
      ...DEFAULT_PROGRAM_RULES,
      untranscribedVoice: {
        enabled: true,
        mode: "fixed_reply",
        fixedReply: "在呢 你打字跟我说嘛",
        redirectInstruction: "",
      },
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "custom-voice-reply-1",
          platform: "soul",
          contact_id: "voice-contact",
          contact_name: "语音测试",
          messages: [{ role: "user", content: "[语音]" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "在呢 你打字跟我说嘛",
      reason: "untranscribed_voice_fixed",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends editable sticker meanings to the model", async () => {
    const kv = new MockKV();
    await kv.put(PROGRAM_RULES_KV_KEY, JSON.stringify({
      ...DEFAULT_PROGRAM_RULES,
      sticker: {
        enabled: true,
        meanings: { 月亮: "想找你聊天" },
        instruction: "表情只按程序给出的意思理解。",
      },
    }));
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes("qweather.com")) {
        return new Response(JSON.stringify({ location: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "月亮都替你想我了" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "custom-sticker-meaning-1",
          platform: "soul",
          contact_id: "sticker-contact",
          contact_name: "表情测试",
          messages: [{ role: "user", content: "[月亮]" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "月亮都替你想我了",
    });
    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/chat/completions")) as [string, RequestInit];
    const [, init] = chatCall;
    const payload = JSON.parse(String(init.body));
    const incoming = payload.messages.find((message: Record<string, string>) => message.role === "user");
    expect(incoming.content).toContain("[表情包：月亮（想找你聊天）]");
    expect(payload.messages[0].content).toContain("表情只按程序给出的意思理解。");
  });

  it("uses an edited safety boundary on the next chat request", async () => {
    const env = {
      DB: new MockD1(),
      KV: new MockKV(),
      DEEPSEEK_API_KEY: "deepseek-key",
      DASHBOARD_PASSWORD: "dashboard-secret",
    };
    const saved = await onRequest({
      request: new Request("https://example.com/api/program-rules", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Password": "dashboard-secret",
        },
        body: JSON.stringify({
          rules: {
            safetyBoundary: {
              text: "刚改的安全底线：不许自动提付款。",
            },
          },
        }),
      }),
      env,
    } as never);
    expect(saved.status).toBe(200);

    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "收到" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "edited-safety-boundary-1",
          platform: "soul",
          contact_id: "safety-boundary-contact",
          contact_name: "安全底线测试",
          messages: [{ role: "user", content: "你好" }],
        }),
      }),
      env,
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "收到",
    });
    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/chat/completions")) as [string, RequestInit];
    const [, init] = chatCall;
    const payload = JSON.parse(String(init.body));
    expect(payload.messages[0].content).toContain("刚改的安全底线：不许自动提付款。");
  });

  it("blocks instruction-like internal text from reaching the customer", async () => {
    const env = {
      DB: new MockD1(),
      KV: new MockKV(),
      DEEPSEEK_API_KEY: "deepseek-key",
    };
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "先答他怎么表现：听话 不催 不越界" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "internal-leak-1",
          platform: "soul",
          contact_id: "internal-leak-contact",
          contact_name: "穿帮话测试",
          messages: [
            { role: "user", content: "具体要我怎么表现" },
            { role: "user", content: "姐姐问你个事" },
          ],
        }),
      }),
      env,
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "嗯 我在",
    });
    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/chat/completions")) as [string, RequestInit];
    const [, init] = chatCall;
    const payload = JSON.parse(String(init.body));
    expect(payload.messages[0].content).toContain("【内部内容禁止外泄】");
  });

  it("removes a deleted rule from the next chat request", async () => {
    const env = {
      DB: new MockD1(),
      KV: new MockKV(),
      DEEPSEEK_API_KEY: "deepseek-key",
      DASHBOARD_PASSWORD: "dashboard-secret",
    };
    const listed = await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        headers: { "X-Dashboard-Password": "dashboard-secret" },
      }),
      env,
    } as never);
    const listBody = await listed.json();
    const lateRule = listBody.rules.find((rule: any) => rule.legacy_rule_id === "late_reply_current_only");
    expect(lateRule).toBeTruthy();

    const deleted = await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Password": "dashboard-secret",
        },
        body: JSON.stringify({ id: lateRule.id }),
      }),
      env,
    } as never);
    expect(deleted.status).toBe(200);
    const deletedState = await loadAgentRuleState(env.DB, "female");
    expect(deletedState.isEnabled("late_reply_current_only", true)).toBe(false);
    expect(deletedState.textFor("late_reply_current_only", "fallback")).toBe("");

    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "收到" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "deleted-rule-next-chat-1",
          platform: "soul",
          contact_id: "deleted-rule-contact",
          contact_name: "删除规则测试",
          messages: [{ role: "user", content: "你好" }],
        }),
      }),
      env,
    } as never);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "收到",
    });
    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/chat/completions")) as [string, RequestInit];
    const [, init] = chatCall;
    const payload = JSON.parse(String(init.body));
    expect(payload.messages[0].content).not.toContain("只接对方最新一句；不主动解释");
  });

  it("returns the upstream status when both attempts fail", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "model overloaded" } }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "upstream-both-failed-1",
          platform: "soul",
          contact_id: "墨染清秋",
          contact_name: "墨染清秋",
          messages: [{ role: "user", content: "你是哪里的" }],
        }),
      }),
      env: { DB: new MockD1(), KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: "llm_upstream_error",
      upstream_status: 503,
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/chat/completions"))).toHaveLength(2);
  });

  it("disables reasoning and retries with a larger budget when the model returns empty content", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).includes("/chat/completions")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      callCount += 1;
      bodies.push(JSON.parse(String(init?.body || "{}")));
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            choices: [{
              message: { role: "assistant", content: "", reasoning_content: "想了很多但没写正文" },
              finish_reason: "length",
            }],
            usage: { completion_tokens: 96 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "这次有正文了" }, finish_reason: "stop" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "empty-content-retry-1",
          platform: "soul",
          contact_id: "zy",
          contact_name: "zy",
          messages: [{ role: "user", content: "你老公呢" }],
        }),
      }),
      env: { DB: new MockD1(), KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "这次有正文了",
    });
    expect(callCount).toBe(2);
    expect(bodies[0].thinking).toEqual({ type: "disabled" });
    expect(Number(bodies[1].max_tokens)).toBeGreaterThan(Number(bodies[0].max_tokens));
  });

  it("aborts a slow model call within the configured chat budget", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "clear",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    let capturedSignal: AbortSignal | null = null;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      capturedSignal = init?.signal || null;
      const rejectAborted = () => reject(
        capturedSignal?.reason || Object.assign(new Error("aborted"), { name: "AbortError" })
      );
      if (capturedSignal?.aborted) {
        rejectAborted();
        return;
      }
      capturedSignal?.addEventListener("abort", rejectAborted, { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "slow-model-request",
          platform: "soul",
          contact_id: "contact-1",
          contact_name: "contact",
          location: { home: { city: "Chongqing", district: "Yuzhong" } },
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
      env: {
        DB: new MockD1(),
        KV: kv,
        DEEPSEEK_API_KEY: "deepseek-key",
        CHAT_LLM_TIMEOUT_MS: "30",
      },
    } as never);

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      code: "llm_timeout",
      request_id: "slow-model-request",
      timing: {
        llm_budget_ms: 30,
        main_llm_ms: expect.any(Number),
        total_ms: expect.any(Number),
      },
    });
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("uses the Gemini-compatible request shape when Gemini is selected", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
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
    const fetchMock = mockChatSequence(["对呀"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "gemini-chat-1",
          platform: "soul",
          contact_id: "gemini-contact",
          contact_name: "Gemini 测试",
          messages: [{ role: "user", content: "你好呀" }],
        }),
      }),
      env: {
        DB: db,
        KV: kv,
        GEMINI_API_KEY: "gemini-key",
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "对呀",
    });
  });

  it("keeps line A and line B separate for different device keys", async () => {
    const db = new MockD1();
    const commonSettings = {
      platform: "soul",
      hosting_enabled: 1,
      monitor_enabled: 1,
      weather_enabled: 0,
      time_enabled: 0,
      reply_pace_sec: 0,
      ai_hours_enabled: 0,
      ai_start_hour: 8,
      ai_end_hour: 23,
    };
    db.deviceSettingsRows.set("device-a", { ...commonSettings, model_line: "a" });
    db.deviceSettingsRows.set("device-b", { ...commonSettings, model_line: "b" });
    const fetchMock = mockChatSequence(["A回复", "B回复"]);
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DB: db,
      KV: new MockKV(),
      GEMINI_API_KEY: "gemini-key",
      DEEPSEEK_API_KEY: "deepseek-key",
    };
    const call = (token: string, requestId: string) => onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({
          request_id: requestId,
          platform: "soul",
          contact_id: "contact-" + token,
          contact_name: "同一个客户",
          messages: [{ role: "user", content: "你好呀" }],
        }),
      }),
      env,
    } as never);

    expect((await call("device-a", "line-a-1")).status).toBe(200);
    expect((await call("device-b", "line-b-1")).status).toBe(200);
    const completionCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/chat/completions"));
    expect(String(completionCalls[0][0])).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(String(completionCalls[1][0])).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  });

  it("never leaks one device's chat history into another device using the same persona and contact", async () => {
    const sharedContactId = "same-contact";
    const db = new MockD1([
      {
        id: 1,
        token: "device-a",
        platform: "soul",
        contact_id: sharedContactId,
        contact_name: "同一个客户",
        role: "user",
        content: "设备一的秘密是喜欢喝茶",
        source: "sync",
        created_at: 100,
      },
      {
        id: 2,
        token: "device-b",
        platform: "soul",
        contact_id: sharedContactId,
        contact_name: "同一个客户",
        role: "user",
        content: "设备二的秘密是喜欢跑步",
        source: "sync",
        created_at: 101,
      },
    ]);
    const settings = {
      platform: "soul",
      hosting_enabled: 1,
      monitor_enabled: 1,
      weather_enabled: 0,
      time_enabled: 0,
      reply_pace_sec: 0,
      ai_hours_enabled: 0,
      ai_start_hour: 8,
      ai_end_hour: 23,
      model_line: "a",
    };
    db.deviceSettingsRows.set("device-a", { ...settings });
    db.deviceSettingsRows.set("device-b", { ...settings });
    const fetchMock = mockChatSequence(["记得你喜欢喝茶", "记得你喜欢跑步"]);
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DB: db,
      KV: new MockKV(),
      DEEPSEEK_API_KEY: "deepseek-key",
    };
    const call = async (token: string, requestId: string) => onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({
          request_id: requestId,
          platform: "soul",
          contact_id: sharedContactId,
          contact_name: "同一个客户",
          messages: [{ role: "user", content: "还记得我的秘密吗" }],
          debug_prompt: true,
        }),
      }),
      env,
    } as never);

    expect((await call("device-a", "isolation-a")).status).toBe(200);
    expect((await call("device-b", "isolation-b")).status).toBe(200);
    const completionCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/chat/completions"));
    const prompts = completionCalls.map(([, init]) => {
      const payload = JSON.parse(String((init as RequestInit).body));
      return (payload.messages || []).map((message: { content?: string }) => String(message.content || "")).join("\n");
    });
    expect(prompts[0]).toContain("设备一的秘密是喜欢喝茶");
    expect(prompts[0]).not.toContain("设备二的秘密是喜欢跑步");
    expect(prompts[1]).toContain("设备二的秘密是喜欢跑步");
    expect(prompts[1]).not.toContain("设备一的秘密是喜欢喝茶");
  });

  it("sends the same history to line A and line B when one phone switches manually", async () => {
    const db = new MockD1([
      {
        id: 1,
        token: "test-token",
        platform: "soul",
        contact_id: "contact-line-memory",
        contact_name: "记忆测试",
        role: "user",
        content: "我平时喜欢喝茶",
        source: "sync",
        created_at: 100,
      },
    ]);
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
      model_line: "a",
    });
    const fetchMock = mockChatSequence(["A记住了", "B也记住了"]);
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DB: db,
      KV: new MockKV(),
      GEMINI_API_KEY: "gemini-key",
      DEEPSEEK_API_KEY: "deepseek-key",
    };
    const call = (requestId: string) => onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: requestId,
          platform: "soul",
          contact_id: "contact-line-memory",
          contact_name: "记忆测试",
          messages: [{ role: "user", content: "还记得我喜欢什么吗" }],
        }),
      }),
      env,
    } as never);

    expect((await call("same-memory-a")).status).toBe(200);
    db.deviceSettingsRows.set("test-token", { ...db.deviceSettingsRows.get("test-token"), model_line: "b" });
    expect((await call("same-memory-b")).status).toBe(200);
    const completionCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/chat/completions"));
    for (const [, init] of completionCalls) {
      const payload = JSON.parse(String((init as RequestInit).body));
      const combined = (payload.messages || []).map((message: { content?: string }) => String(message.content || "")).join("\n");
      expect(combined).toContain("我平时喜欢喝茶");
    }
  });

  it("reports line B as healthy only after the provider responds", async () => {
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
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DB: db,
      KV: new MockKV(),
      GEMINI_API_KEY: "gemini-key",
      DEEPSEEK_API_KEY: "deepseek-key",
    };

    const ok = await onRequest({
      request: new Request("https://example.com/api/model-route/health?line=b", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env,
    } as never);
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({ ok: true, line: "b", provider: "gemini" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("generativelanguage.googleapis.com");

    fetchMock.mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
    const failed = await onRequest({
      request: new Request("https://example.com/api/model-route/health?line=a", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env,
    } as never);
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toMatchObject({ ok: false, line: "a" });
  });

  it("does not waste a retry when Gemini safety-blocks an intimate reply", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "WH",
      condition: "clear",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    await kv.put("llm:gemini_model", "gemini-3.8-flash");
    const db = new MockD1();
    db.deviceSettingsRows.set("test-token", {
      platform: "soul",
      hosting_enabled: 1,
      monitor_enabled: 1,
      weather_enabled: 1,
      time_enabled: 1,
      reply_pace_sec: 0,
      ai_hours_enabled: 0,
      ai_start_hour: 8,
      ai_end_hour: 23,
      model_line: "b",
    });
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      if (!String(url).includes("/chat/completions")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      callCount += 1;
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "" }, finish_reason: "content_filter" }],
          usage: { completion_tokens: 2 },
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
          request_id: "gemini-safety-1",
          platform: "soul",
          contact_id: "safety-contact",
          contact_name: "safety-contact",
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
      env: {
        DB: db,
        KV: kv,
        GEMINI_API_KEY: "gemini-key",
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    expect(response.status).toBe(200);
    // No second model call: retrying a safety block with the same prompt never helps.
    expect(callCount).toBe(1);
    const body = await response.json();
    expect(body.action).toBe("send");
    // No timestamp on the incoming message, so the gap is unknown and the
    // cover must be the "was away" variant, never the robotic fallback.
    expect(String(body.reply || "")).toMatch(/走开/);
  });

  it("dynamically injects matched drawer tips into prompt when triggered", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    const fetchMock = mockChatSequence(["瘫在沙发上不想动呢"]);
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1([], [{
      id: "female_sutang",
      name: "苏棠",
      system_prompt: "你是苏棠，29岁，重庆人。",
    }]);
    db.tokenPersonas.set("test-token", "female_sutang");

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "drawer-test-1",
          platform: "soul",
          contact_id: "drawer-contact",
          contact_name: "测试用户",
          messages: [{ role: "user", content: "今晚下雨 后背酸得厉害" }],
        }),
      }),
      env: {
        DB: db,
        KV: kv,
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    const systemMessage = payload.messages.find((m: { role: string }) => m.role === "system");
    expect(systemMessage.content).toContain("【居家放松与颈背酸胀】");
  });

  it("only gives Sutang's default scene cards to Sutang", () => {
    const sutang = defaultDrawersForPersona("female_sutang");
    const oldStockings = sutang.topics?.find((item) => item.id === "scene_01_black_stockings");
    const newRainyNeck = sutang.topics?.find((item) => item.id === "scene_14_rainy_neck");
    expect(oldStockings?.enabled).toBe(false);
    expect(newRainyNeck?.enabled).toBe(true);
    for (const personaId of ["female", "male", "male_chenyu"]) {
      const drawers = defaultDrawersForPersona(personaId);
      expect(drawers.topics || []).toEqual([]);
      expect(drawers.counters || []).toEqual([]);
      expect(JSON.stringify(drawers)).not.toContain("苏棠");
      expect(JSON.stringify(drawers)).not.toContain("借腿");
    }
  });

  it("marks exact knowledge cards as required knowledge and keeps them persona-scoped", () => {
    const cards = {
      custom: [{
        id: "knowledge_black_stockings",
        name: "黑丝触感",
        keywords: ["黑丝", "丝袜"],
        content: "刚把黑丝脱了，脚踝全是印子",
        kind: "scene",
        activation: "keyword",
        replyMode: "exact",
        enabled: true,
      }],
    };
    const matched = matchActiveDrawers(cards, "今天穿黑丝了吗");
    expect(matched.join("\n")).toContain("知识库命中｜优先按原文");
    expect(matchActiveDrawers(cards, "今天吃什么")).toEqual([]);
  });

  it("keeps Xingmu, Sutang and generic male prompts in separate scopes", () => {
    const base = {
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-09 08:00:00",
      weekday: "星期五",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      weather: null,
      weatherEnabled: false,
      timeEnabled: false,
      stageText: "刚认识",
      relationStageLevel: 1,
      messageDelay: null,
      messages: [{ role: "user", content: "今天忙不忙" }],
      historyMessages: [],
      conversationTimeline: "",
      memorySummary: "",
    };
    const xingmu = buildLayeredSystemPrompt({
      ...base,
      personaId: "female",
      personaPrompt: "你是王雅慧，对外叫星暮。",
    });
    const sutang = buildLayeredSystemPrompt({
      ...base,
      personaId: "female_sutang",
      personaPrompt: "你是苏棠，29岁，重庆人。",
    });
    const male = buildLayeredSystemPrompt({
      ...base,
      personaId: "male",
      personaPrompt: "你是阿杰，31岁男性，重庆人。",
    });

    expect(xingmu).not.toContain("电商运营");
    expect(xingmu).not.toContain("带娃");
    expect(xingmu).not.toContain("我老公");
    expect(xingmu).not.toContain("你是来排解寂寞的");
    expect(sutang).not.toContain("王雅慧");
    expect(sutang).not.toContain("宝马X3");
    expect(sutang).not.toContain("星暮六段漏斗");
    expect(male).not.toContain("苏棠");
    expect(male).not.toContain("我老公");
    expect(male).not.toContain("借腿");
    expect(male).not.toContain("你是来排解寂寞的");
    expect(male).not.toContain("星暮六段漏斗");
  });
});
