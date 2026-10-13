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
import { readDashboardScript, readDashboardStyles } from "./dashboard-source";

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

  it("opens a unified customer when the contact link and contact tables both have a created_at column", async () => {
    const history = [
      {
        id: 21,
        token: "test-token",
        platform: "soul",
        contact_id: "期待下一步的我们",
        contact_name: "期待下一步的我们",
        role: "user",
        content: "算了我睡了",
        source: "sync",
        created_at: 1791484919,
      },
    ];
    const db = new MockD1(history).withOptions({
      groups: [{
        id: "group:bf8e87ed-a28f-4dbb-a8af-bd0aef39125d",
        token: "test-token",
        display_name: "期待下一步的我们",
        notes: "",
        priority_reply: 1,
      }],
      contactLinks: [{
        group_id: "group:bf8e87ed-a28f-4dbb-a8af-bd0aef39125d",
        token: "test-token",
        platform: "soul",
        contact_id: "期待下一步的我们",
        contact_name: "期待下一步的我们",
        created_at: 1791486939,
      }],
    });
    const response = await onRequest({
      request: new Request("https://example.com/api/customer-messages?token=test-token&group_id=group%3Abf8e87ed-a28f-4dbb-a8af-bd0aef39125d", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env: { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      messages: [{ id: 21, content: "算了我睡了" }],
      latest_id: 21,
    });
  });

  it("changes only the selected device's model line from the dashboard", async () => {
    const db = new MockD1();
    const settings = (modelLine: string) => ({
      platform: "soul",
      hosting_enabled: 1,
      monitor_enabled: 1,
      weather_enabled: 0,
      time_enabled: 0,
      reply_pace_sec: 0,
      ai_hours_enabled: 0,
      ai_start_hour: 8,
      ai_end_hour: 23,
      model_line: modelLine,
    });
    db.deviceSettingsRows.set("device-a", settings("a"));
    db.deviceSettingsRows.set("device-b", settings("a"));
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };

    const update = await onRequest({
      request: new Request("https://example.com/api/model-route", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({ token: "device-a", line: "b" }),
      }),
      env,
    } as never);
    expect(update.status).toBe(200);

    const read = async (token: string) => onRequest({
      request: new Request("https://example.com/api/model-route?token=" + token, {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    await expect((await read("device-a")).json()).resolves.toMatchObject({ line: "b" });
    await expect((await read("device-b")).json()).resolves.toMatchObject({ line: "a" });
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
    expect(promptMessages[0].content).toContain("【连续记忆】");
    expect(promptMessages[0].content).toContain("按同一个人延续聊天");
    // Cross-platform history keeps flowing, but as a labelled transcript line
    // instead of a "[platform time] content" prefix.
    expect(promptMessages.some((message) => String(message.content).includes("对方：我周末有空"))).toBe(true);
    expect(promptMessages.some((message) => message.role === "assistant" && String(message.content).includes("我：那就周六见"))).toBe(true);
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
    const source = readDashboardScript();
    expect(source).not.toContain("data-bind-index");
    expect(source).toContain("data-contact-id");
    expect(source).toContain("replace_aliases: true");
  });

  it("ships the clean customer dashboard layout and profile panel", () => {
    const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
    const source = readDashboardScript();
    const styles = readDashboardStyles();
    const utils = readFileSync(new URL("../src/dashboard-utils.js", import.meta.url), "utf8");
    expect(styles).toMatch(/grid-template-columns: (?:320px minmax\(420px, 1fr\) 300px|280px 1fr 280px)/);
    expect(styles).toMatch(/--(?:green|blue): #(?:22c55e|0ea5e9)/);
    expect(html).toContain('id="profilePlatformLinks"');
    expect(html).toContain('id="mobileSidebarButton"');
    expect(html).toContain('id="mobileProfileButton"');
    expect(html).toContain("不同平台的同一个人会合在一起");
    expect(source).toContain("function renderProfilePanel(group)");
    expect(utils).toContain('class="pf ${active.has(platform.id)');
    // 2026-10-07 学 LinkPilot 的两样：时间来源标签 + 非文字消息语义标签。
    expect(utils).toContain("function kindLabel(timeKind)");
    expect(source).toContain("function messageBody(message)");
    expect(utils).toContain("first_observed: \"读到\"");
    expect(source).toContain("content-chip");
    expect(styles).toContain(".kind-label");
    expect(styles).toContain(".content-chip");
  });
});
