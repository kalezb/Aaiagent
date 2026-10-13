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
  mockChatSequence,
} from "./chat-test-helpers";

describe("media semantics", () => {
  it("keeps a visible text reply when the classifier returns NONE", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = mockChatSequence([
      "NONE",
      "照片这事先不聊了，聊点别的",
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "classified-none-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "没照片呀" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send");
    expect(body.media).toBeUndefined();
  });

  it("does not send a personal photo for a machine follow-up even if the classifier is wrong", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = mockChatSequence([
      "DAILY",
      "机器的照片我回头拍给你看",
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "machine-follow-up-not-personal",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [
            { role: "user", content: "看一下你现在的机器的样子" },
            { role: "user", content: "看一下呗" },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send");
    expect(body.media).toBeUndefined();
  });

  it("uses a BODY classification only when the recent context explicitly asks for body media", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [
        { id: "daily", name: "日常照", is_active: 1 },
        { id: "body", name: "身材照", is_active: 1 },
      ],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" },
        { id: "body_01", group_id: "body", file_name: "body_01.jpg" },
      ],
    });
    const fetchMock = mockChatSequence(["BODY"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "classified-body-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [
            { role: "user", content: "想看你的身材照" },
            { role: "user", content: "发一下呗" },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      action: "send_media",
      media: { group_id: "body", asset_id: "body_01" },
    });
  });

  it("rejects a model image action for an isolated look request without photo context", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = mockChatSequence(["NONE", "[[SEND_MEDIA:daily]]"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "isolated-look-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "看一下" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send");
    expect(body.media).toBeUndefined();
    expect(body.reply).toBe("看什么？");
  });

  it("does not treat a machine look request as a personal photo request", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = mockChatSequence(["NONE", "[[SEND_MEDIA:daily]]"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "machine-look-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [
            { role: "user", content: "看一下你现在的机器的样子" },
            { role: "user", content: "看一下呗" },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send");
    expect(body.media).toBeUndefined();
    expect(body.reply).toBe("看什么？");
  });

  it("uses persisted history when a personal photo follow-up omits the keyword", async () => {
    const db = new MockD1([
      {
        id: 1,
        token: "test-token",
        platform: "soul",
        contact_id: "contact-1",
        role: "user",
        content: "想看你照片",
        created_at: 1,
      },
    ]).withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = mockChatSequence(["DAILY"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "history-follow-up-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "给一下" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ action: "send_media", media: { group_id: "daily", asset_id: "daily_01" } });
  });

  it("does not inherit a machine photo request from history as a personal photo", async () => {
    const db = new MockD1([
      {
        id: 1,
        token: "test-token",
        platform: "soul",
        contact_id: "contact-1",
        role: "user",
        content: "看一下机器的照片",
        created_at: 1,
      },
    ]).withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "[[SEND_MEDIA:daily]]" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "history-machine-follow-up-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "给一下" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send");
    expect(body.media).toBeUndefined();
  });

  it("downgrades a model-selected body photo to daily unless body is explicit", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [
        { id: "daily", name: "日常照", trigger_keywords: "想看你照片", is_active: 1 },
        { id: "body", name: "身材照", trigger_keywords: "想看身材照", is_active: 1 },
      ],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
        { id: "body_01", group_id: "body", file_name: "body_01.jpg", content_type: "image/jpeg" },
      ],
    });
    const fetchMock = mockChatSequence(["BODY"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "downgrade-body-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [
            { role: "user", content: "想看你照片" },
            { role: "user", content: "发一下呗" },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ action: "send_media", media: { group_id: "daily", asset_id: "daily_01" } });
  });

  it("allows a model-selected body photo when body is explicitly requested", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [
        { id: "daily", name: "日常照", trigger_keywords: "想看你照片", is_active: 1 },
        { id: "body", name: "身材照", trigger_keywords: "想看身材照", is_active: 1 },
      ],
      mediaAssets: [
        { id: "body_01", group_id: "body", file_name: "body_01.jpg", content_type: "image/jpeg" },
      ],
    });
    const fetchMock = mockChatSequence(["BODY"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "explicit-body-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "发一下身材照呗" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ action: "send_media", media: { group_id: "body", asset_id: "body_01" } });
  });

  it("rejects a model media directive for a realtime photo request", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "[[SEND_MEDIA:daily]]" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "realtime-model-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "现在拍张照片" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send");
    expect(body.media).toBeUndefined();
    expect(body.reply).toContain("不方便拍");
  });

  it("rejects a model media directive for an unknown group", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "[[SEND_MEDIA:unknown]]" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "unknown-model-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "看一下照片" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send");
    expect(body.media).toBeUndefined();
    // 2026-10-05：兜底话术不再张口拒绝
    expect(body.reply).toContain("急啥呀");
  });

  it("still sends the photo when the model asks for one but the intent classifier says none", async () => {
    // 真机原样：对方说“可以看看你照片吗”，分类器返回 NONE，
    // 模型却已经判定要发日常照；旧逻辑会否决掉，最后回一句“照片先不发了”。
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = mockChatSequence(["NONE", "[[SEND_MEDIA:daily]]"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "classifier-none-but-model-sends",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "可以看看你照片吗" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send_media");
    expect(body.media.group_id).toBe("daily");
  });

  it("prevents the chat route from sending media for realtime requests", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "text reply" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", trigger_keywords: "\u65e5\u5e38\u7167", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily" }],
    });
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "realtime-topic-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "\u73b0\u5728\u65e5\u5e38\u7167" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();
    expect(body.action).toBe("send");
    expect(body.media).toBeUndefined();
    expect(fetchMock).toHaveBeenCalled();
  });
});
