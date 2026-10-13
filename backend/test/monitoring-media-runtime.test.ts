import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { onRequest } from "../functions/api/[[route]]";
import { buildLayeredSystemPrompt } from "../functions/api/_reply_policy";
import {
  MockD1,
  MockKV,
} from "./chat-test-helpers";

describe("media runtime", () => {
  it("serves topic images from private KV storage", async () => {
    const imageBytes = new Uint8Array([7, 8, 9, 10]);
    const db = new MockD1().withOptions({
      mediaAssets: [{
        id: "daily_01",
        group_id: "daily",
        file_name: "daily_01.jpg",
        content_type: "image/jpeg",
        source_url: "",
        storage_key: "media/image/daily_01",
      }],
    });
    const kv = new MockKV();
    await kv.put("media/image/daily_01", imageBytes);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const unauthorized = await onRequest({
      request: new Request("https://example.com/api/media/daily_01"),
      env: { DB: db, KV: kv },
    } as never);
    expect(unauthorized.status).toBe(401);

    const response = await onRequest({
      request: new Request("https://example.com/api/media/daily_01", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env: { DB: db, KV: kv },
    } as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(imageBytes));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies topic images only for an authenticated device", async () => {
    const db = new MockD1().withOptions({
      mediaAssets: [{
        id: "outfit_01",
        group_id: "outfit",
        file_name: "outfit_01.jpg",
        content_type: "image/jpeg",
        source_url: "https://cdn.example.com/outfit_01.jpg",
      }],
    });
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(imageBytes, {
      status: 200,
      headers: { "Content-Type": "image/jpeg", "Content-Length": String(imageBytes.length) },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const unauthorized = await onRequest({
      request: new Request("https://example.com/api/media/outfit_01"),
      env: { DB: db, KV: new MockKV() },
    } as never);
    expect(unauthorized.status).toBe(401);

    const response = await onRequest({
      request: new Request("https://example.com/api/media/outfit_01", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env: { DB: db, KV: new MockKV() },
    } as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect((await response.arrayBuffer()).byteLength).toBe(4);
  });

  it("returns a deterministic topic image without calling the LLM", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", trigger_keywords: "想看你照片", is_active: 1 }],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
        { id: "daily_02", group_id: "daily", file_name: "daily_02.jpg", content_type: "image/jpeg" },
        { id: "daily_03", group_id: "daily", file_name: "daily_03.jpg", content_type: "image/jpeg" },
      ],
    });
    db.tokenPersonas.set("test-token", "assistant");
    // 2026-10-06：图片请求现在先叫一次模型写“欲拒还迎”那句话，图片本身仍按关键词兜底发。
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "你这人倒是挺直接的呀|||行吧 就给你看一眼" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const makeRequest = () => new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: "topic-image-request",
        platform: "soul",
        hosting_mode: "full_auto",
        contact_id: "contact-1",
        contact_name: "contact",
        messages: [{ role: "user", content: "想看你照片" }],
      }),
    });

    const first = await onRequest({
      request: makeRequest(),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const second = await onRequest({
      request: makeRequest(),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(firstBody.action).toBe("send_media");
    expect(firstBody.media.asset_id).toBe("daily_01");
    // 先把那句“欲拒还迎”的话发给对方，再发图
    expect(typeof firstBody.reply).toBe("string");
    expect(firstBody.reply.length).toBeGreaterThan(0);
    expect(secondBody.media.asset_id).toBe(firstBody.media.asset_id);
    expect(secondBody.reply_id).toBe(firstBody.reply_id);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stages a daily photo for Soul exchange without calling the LLM", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", trigger_keywords: "\u4ee5\u56fe\u6362\u56fe", is_active: 1 }],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
      ],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/media/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "exchange-test",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.action).toBe("send_media");
    expect(body.media.group_id).toBe("daily");
    expect(body.media.asset_id).toBe("daily_01");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never stages a Soul exchange photo outside full-auto mode", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", trigger_keywords: "\u4ee5\u56fe\u6362\u56fe", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/media/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "exchange-semi-auto",
          platform: "soul",
          hosting_mode: "semi_auto",
          contact_id: "contact-1",
          contact_name: "contact",
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ action: "skip" });
    expect(db.pendingRows).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails safe to monitor-only when hosting mode is missing", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", trigger_keywords: "\u4ee5\u56fe\u6362\u56fe", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/media/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "exchange-missing-mode",
          platform: "soul",
          contact_id: "contact-1",
          contact_name: "contact",
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ action: "skip" });
    expect(db.pendingRows).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never exposes full persona prompts through the public API", async () => {
    const db = new MockD1([], [{ id: "female", name: "星暮", system_prompt: "私有系统提示词", is_active: 1, created_at: 1 }]);
    const publicResponse = await onRequest({
      request: new Request("https://example.com/api/persona"),
      env: { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" },
    } as never);
    const publicBody = await publicResponse.json();
    expect(publicBody.personas[0]).not.toHaveProperty("system_prompt");

    const publicPromptAttempt = await onRequest({
      request: new Request("https://example.com/api/persona?include_prompt=1"),
      env: { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" },
    } as never);
    expect(publicPromptAttempt.status).toBe(401);

    const dashboardResponse = await onRequest({
      request: new Request("https://example.com/api/persona", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env: { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" },
    } as never);
    await expect(dashboardResponse.json()).resolves.toMatchObject({
      personas: [{ id: "female", system_prompt: "私有系统提示词" }],
    });
  });

  it("includes the compact unanswered-message timeline in the prompt", () => {
    const prompt = buildLayeredSystemPrompt({
      personaPrompt: "你是星暮。",
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026年9月28日 19:00",
      weekday: "周一",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "两江新区" },
      weather: "",
      stageText: "刚认识",
      relationStageLevel: 1,
      messageDelay: null,
      messages: [{ role: "user", content: "在干嘛" }],
      historyMessages: [],
      conversationTimeline: "客户连续三天发来文字、动态和互动表情。",
    });

    expect(prompt).toContain("【未回复消息时间线】客户连续三天发来文字、动态和互动表情。");
  });
});
