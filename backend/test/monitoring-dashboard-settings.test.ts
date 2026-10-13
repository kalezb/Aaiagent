import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import { onRequest } from "../functions/api/[[route]]";
import {
  MockD1,
  MockKV,
} from "./chat-test-helpers";
import { readDashboardScript } from "./dashboard-source";

describe("dashboard settings and chat persistence", () => {
  it("creates a gallery group and uploads an image into private storage", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", trigger_keywords: "看照片", is_active: 1 }],
    });
    const kv = new MockKV();
    const env = { DB: db, KV: kv, DASHBOARD_PASSWORD: "secret" };

    const create = await onRequest({
      request: new Request("https://example.com/api/media-library/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          name: "周末生活照",
          trigger_keywords: "想看看周末",
          persona_id: "female_sutang",
          platform: "soul",
        }),
      }),
      env,
    } as never);
    expect(create.status).toBe(200);
    const created = await create.json();
    expect(created.group).toMatchObject({
      name: "周末生活照",
      trigger_keywords: "想看看周末",
      persona_id: "female_sutang",
      platform: "soul",
    });

    const upload = await onRequest({
      request: new Request("https://example.com/api/media-library/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          group_id: "daily",
          file_name: "周末.png",
          content_type: "image/png",
          data_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        }),
      }),
      env,
    } as never);
    expect(upload.status).toBe(201);
    const uploaded = await upload.json();
    expect(uploaded.asset).toMatchObject({ group_id: "daily", content_type: "image/png" });
    const insert = db.runCalls.find((call) => call.sql.includes("INSERT INTO media_assets"));
    expect(insert?.params?.[0]).toBe(uploaded.asset.id);
    expect(insert?.params?.[1]).toBe("daily");
    expect(insert?.params?.[2]).toBe("周末.png");
    expect(insert?.params?.[3]).toBe("image/png");
    expect(String(insert?.params?.[4])).toMatch(/^dashboard-media:/u);
    const stored = await kv.get(String(insert?.params?.[4]), "arrayBuffer");
    expect((stored as ArrayBuffer).byteLength).toBeGreaterThan(0);
  });

  it("deletes a gallery image from both the library and private storage", async () => {
    const storageKey = "dashboard-media:media_old";
    const db = new MockD1().withOptions({
      mediaAssets: [{ id: "media_old", group_id: "daily", storage_key: storageKey }],
    });
    const kv = new MockKV();
    await kv.put(storageKey, new Uint8Array([1, 2, 3]));
    const env = { DB: db, KV: kv, DASHBOARD_PASSWORD: "secret" };

    const response = await onRequest({
      request: new Request("https://example.com/api/media-library/assets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({ id: "media_old" }),
      }),
      env,
    } as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, id: "media_old", group_id: "daily" });
    expect(await kv.get(storageKey)).toBeNull();
    expect(db.runCalls.some((call) => call.sql.includes("DELETE FROM media_assets") && call.params[0] === "media_old")).toBe(true);
  });

  it("saves the dashboard hosting switches and reply settings", async () => {
    const db = new MockD1();
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const response = await onRequest({
      request: new Request("https://example.com/api/hosting-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          token: "test-token",
          platform: "qq",
          hosting_enabled: true,
          monitor_enabled: true,
          weather_enabled: false,
          time_enabled: false,
          reply_pace_sec: 9,
          ai_hours_enabled: true,
          ai_start_hour: 10,
          ai_end_hour: 22,
        }),
      }),
      env,
    } as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      settings: {
        platform: "qq",
        hosting_enabled: true,
        monitor_enabled: true,
        weather_enabled: false,
        time_enabled: false,
        reply_pace_sec: 9,
        ai_hours_enabled: true,
        ai_start_hour: 10,
        ai_end_hour: 22,
      },
    });
  });

  it("shows nav pages for gallery drawers kb and settings", () => {
    const source = readDashboardScript();
    const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
    expect(html).toContain('id="pageNav"');
    expect(html).toContain('id="page-library"');
    expect(html).toContain('id="page-drawers"');
    expect(html).toContain('id="page-kb"');
    expect(html).toContain('id="knowledgePersona"');
    expect(html).toContain("人设知识库");
    expect(html).toContain('id="agentCardReplyMode"');
    expect(html).toContain('id="programSafetyBoundary"');
    expect(source).toContain("safetyBoundary");
    expect(html).toContain('id="page-settings"');
    expect(source).toContain("function showPage(");
    expect(source).toContain("function loadLibrary(");
    expect(source).toContain("function loadDrawers(");
    expect(source).toContain("async function loadKnowledge(");
    expect(source).toContain("function renderKnowledgeCards(");
    expect(source).toContain("function activePersonaId(");
    expect(source).toContain("function toggleDrawer(");
    expect(source).toContain("function saveDrawer(");
    expect(source).toContain("async function uploadLibraryImage(");
    expect(source).toContain("data-drawer-content");
    expect(source).toContain("function loadDrawers(");
    expect(source).toContain("async function saveAgentCard(");
    expect(source).toContain("async function savePersonaPrompt(");
    expect(source).toContain("async function saveSharedFacts(");
    expect(source).toContain("function handleAgentVersionConflict(");
    expect(source).toContain("async function runPersonaAudit(");
    expect(source).not.toContain("async function publishPersona(");
    expect(source).toContain("expected_version");
    expect(source).not.toContain("ensureSettingsMoved");
    expect(html).toContain('id="createLibGroupButton"');
    expect(html).toContain('id="libraryUploadInput"');
    expect(html).toContain('id="settingsDeviceSelect"');
    expect(html).toContain('id="hostingEnabled"');
    expect(html).toContain('id="agentIdentitySummary"');
    expect(html).toContain('id="drawerCards"');
    expect(html).not.toContain('id="lockedAgentRules"');
    expect(html).toContain('id="programSafetyBoundaryEnabled"');
    expect(html).toContain('id="deleteProgramSafetyBoundaryButton"');
    expect(html).toContain('id="createAgentCardButton"');
    expect(html).toContain('id="legacyAgentRules"');
    expect(html).toContain('id="legacyRuleSearch"');
    expect(html).toContain('id="ruleCenterNav"');
    expect(html).toContain('id="ruleSummaryActive"');
    expect(html).toContain('id="agentRuleConflictList"');
    expect(html).toContain('id="ruleConflictLevelFilter"');
    expect(html).toContain('id="ruleRulesCard"');
    expect(html).toContain('id="saveSharedFactsButton"');
    expect(html).toContain('id="runPersonaAuditButton"');
    expect(html).not.toContain('id="publishPersonaButton"');
    expect(html).toContain("规则中心");
    expect(html).toContain("每条规则都标明管什么");
    expect(html).toContain("4 套人设所有设备共用");
    expect(source).toContain("function renderAgentRules(");
    expect(source).toContain("function renderAgentRuleConflicts(");
    expect(source).toContain("function showRuleTab(");
    expect(source).toContain("async function saveAgentRule(");
  });

  it("hides the reply state on the profile panel and lets the operator restore it", () => {
    const source = readDashboardScript();
    const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
    expect(source).toContain("function renderContactFlags(group)");
    expect(source).toContain("已婚不回");
    expect(source).toContain("已停止回复");
    expect(source).toContain("function renderTakeoverAlerts(group)");
    expect(source).toContain("takeoverKindText");
    // 已婚与“停回”分开恢复：只解停回、不动已婚标签
    expect(source).toContain("清除已婚标记");
    expect(source).toContain("function restoreContactFlag(kind, index)");
    expect(source).toContain("已恢复回复（已婚标记保留）");
    expect(html).toContain('id="profileFlags"');
    expect(html).toContain('id="takeoverList"');
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

  it("saves explicit customer facts immediately without spending profile tokens", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1();
    const response = await onRequest({
      request: new Request("https://example.com/api/messages/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "contact-1",
          contact_name: "梦想",
          messages: [
            { role: "user", content: "我在渝北区", message_key: "fact-location", created_at: 100 },
            { role: "user", content: "单身汉", message_key: "fact-marital", created_at: 101 },
            { role: "user", content: "我没孩子", message_key: "fact-children", created_at: 102 },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    const stored = db.profileRows.get("test-token\u0000single:test-token:soul:contact-1");
    const profile = JSON.parse(String(stored?.profile_json || "{}"));
    expect(profile.location?.residence).toBe("渝北区");
    expect(profile.family?.marital_status).toBe("单身");
    expect(profile.family?.children).toBe("没有孩子");
    expect(profile._runtime?.factSources?.["family.marital_status"]?.content).toBe("单身汉");
  });

  it("keeps cloudflare polling inside the free-plan request budget", () => {
    const source = readDashboardScript();
    // 2026-10-08：看板刷新从 10 秒改成 30 秒，并且页面不在前台时不刷（用户实测：托管没开也把 D1 额度吃爆）。
    expect(source).toContain("}, 30000);");
    expect(source).toContain("document.visibilityState");
  });

  it("writes AI history only after the phone confirms a successful send", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "在的 刚忙完" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1();
    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: "confirm-only-reply",
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

    const generated = await response.json();
    expect(response.status).toBe(200);
    expect(generated.reply_id).toBeTruthy();
    expect(db.historyRows).toHaveLength(0);
    expect(db.pendingRows).toHaveLength(1);

    const confirmResponse = await onRequest({
      request: new Request("https://example.com/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ reply_id: generated.reply_id, sent_content: generated.reply }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    expect(confirmResponse.status).toBe(200);
    expect(db.historyRows).toHaveLength(1);
    expect(db.historyRows[0]).toMatchObject({ role: "assistant", source: "ai", content: "在的" });
  });

  it("does not store the same reply twice when the phone resent it", async () => {
    // 2026-10-07 真机（稳重的神盾局特工）：第一次其实发出去了但没验证到，
    // 几秒后待处理回复又发了一遍，云端于是存了两行同样的“她：在家窝着哪无聊了 我巴不得呢”。
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "在家窝着哪无聊了 我巴不得呢" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1();
    db.tokenPersonas.set("test-token", "female_sutang");
    const makeChat = (requestId: string) => new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: requestId,
        platform: "soul",
        contact_id: "dup-contact",
        contact_name: "稳重的神盾局特工",
        messages: [{ role: "user", content: "那得多无聊" }],
      }),
    });
    const confirm = (replyId: string, sent: string) => onRequest({
      request: new Request("https://example.com/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ reply_id: replyId, sent_content: sent }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    const first = await (await onRequest({ request: makeChat("dup-1"), env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" } } as never)).json();
    await confirm(first.reply_id, first.reply);
    expect(db.historyRows.filter((row) => row.role === "assistant")).toHaveLength(1);

    const second = await (await onRequest({ request: makeChat("dup-2"), env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" } } as never)).json();
    expect(second.reply_id).not.toBe(first.reply_id);
    await confirm(second.reply_id, second.reply);
    // 同一句话 10 分钟内不再写第二行。
    expect(db.historyRows.filter((row) => row.role === "assistant")).toHaveLength(1);
  });

  it("returns the same pending reply for a repeated request id without another model call", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "在的" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1();
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const makeRequest = () => new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: "stable-request-id",
        platform: "soul",
        contact_id: "contact-1",
        contact_name: "期待下一步的我们",
        messages: [{ role: "user", content: "在吗" }],
      }),
    });

    const first = await onRequest({
      request: makeRequest(),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const second = await onRequest({
      request: makeRequest(),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.reply_id).toBe(firstBody.reply_id);
    expect(secondBody.reply).toBe("在的");
    expect(db.historyRows).toHaveLength(0);
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
  });

  it("persists device platform and service switches", async () => {
    const db = new MockD1();
    const env = { DB: db, KV: new MockKV() };
    const save = (params: Record<string, string>) => onRequest({
      request: new Request("https://example.com/api/config/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_key: "test-token", ...params }),
      }),
      env,
    } as never);

    expect((await save({ action: "switch_platform", platform: "qq" })).status).toBe(200);
    expect((await save({ action: "toggle_hosting", enabled: "true" })).status).toBe(200);
    expect((await save({ action: "toggle_weather", enabled: "false" })).status).toBe(200);

    const response = await onRequest({
      request: new Request("https://example.com/api/config", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env,
    } as never);
    await expect(response.json()).resolves.toMatchObject({
      platform: "qq",
      hosting_enabled: true,
      monitor_enabled: true,
      weather_enabled: false,
      time_enabled: true,
    });
  });

  it("uses the configured LLM base URL and temperature", async () => {
    const kv = new MockKV();
    await kv.put("llm:base_url", "https://llm.example.com/v1");
    await kv.put("llm:temperature", "0.35");
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "在的" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "contact-1",
          contact_name: "梦想",
          messages: [{ role: "user", content: "在吗" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://llm.example.com/v1/chat/completions");
    expect(JSON.parse(String(init.body)).temperature).toBe(0.35);
  });

  it("blocks chat after the monthly token budget is exhausted", async () => {
    const month = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
    }).format(new Date());
    const db = new MockD1().withOptions({ tokenSpent: 100, tokenSpentMonth: month });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "contact-1",
          contact_name: "梦想",
          messages: [{ role: "user", content: "在吗" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    expect(response.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
