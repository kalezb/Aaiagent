import {
  describe,
  expect,
  it,
} from "vitest";
import { onRequest } from "../functions/api/[[route]]";
import { matchActiveDrawers } from "../functions/api/_persona_drawers";
import {
  MockD1,
  MockKV,
} from "./chat-test-helpers";

describe("monitoring sync core", () => {
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
      { id: 11, token: "test-token", platform: "soul", contact_id: "contact-1", contact_name: "梦想", role: "assistant", content: "新消息", source: "ai", created_at: 11, time_kind: "ai_generated" },
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
    const dashboardBody = await response.json();
    expect(dashboardBody).toMatchObject({
      latest_id: 11,
      messages: [{ id: 11, source: "ai", content: "新消息" }],
    });
    // 2026-10-07 看板要显示“这时间是怎么来的”，所以消息里必须带 time_kind。
    expect(dashboardBody.messages[0]).toHaveProperty("time_kind");
  });

  it("lists takeover alerts for the dashboard and rejects unauthenticated calls", async () => {
    // 2026-10-07：看板要能看到“谁要过联系方式、系统什么时候停手发的邮件”。
    const db = new MockD1();
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const unauthorized = await onRequest({
      request: new Request("https://example.com/api/takeover-alerts"),
      env,
    } as never);
    expect(unauthorized.status).toBe(401);

    const authorized = await onRequest({
      request: new Request("https://example.com/api/takeover-alerts?token=test-token&contact_name=%E8%80%83%E5%8D%B71", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toMatchObject({ alerts: [] });
  });

  it("serves the Su Tang knowledge page and toggles one card", async () => {
    const kv = new MockKV();
    const env = { DB: new MockD1(), KV: kv, DASHBOARD_PASSWORD: "secret" };
    const unauthorized = await onRequest({
      request: new Request("https://example.com/api/drawers"),
      env,
    } as never);
    expect(unauthorized.status).toBe(401);

    const list = await onRequest({
      request: new Request("https://example.com/api/drawers?persona_id=female_sutang", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody.persona_id).toBe("female_sutang");
    expect(listBody.topics.length).toBeGreaterThan(0);
    expect(listBody.counters).toEqual([]);
    const firstId = "scene_14_rainy_neck";
    expect(listBody.topics.find((item) => item.id === firstId)?.enabled).toBe(true);

    const toggle = await onRequest({
      request: new Request("https://example.com/api/drawers", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          persona_id: "female_sutang",
          id: firstId,
          enabled: false,
          expected_version: listBody.shared_version,
        }),
      }),
      env,
    } as never);
    expect(toggle.status).toBe(200);

    const relist = await onRequest({
      request: new Request("https://example.com/api/drawers?persona_id=female_sutang", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    const relistBody = await relist.json();
    expect(relistBody.topics.find((d) => d.id === firstId).enabled).toBe(false);
  });

  it("lets the dashboard edit drawer name, keywords and content", async () => {
    const kv = new MockKV();
    const env = { DB: new MockD1(), KV: kv, DASHBOARD_PASSWORD: "secret" };
    const list = await onRequest({
      request: new Request("https://example.com/api/drawers?persona_id=female_sutang", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    const listBody = await list.json();
    const firstId = listBody.topics[0].id;

    const update = await onRequest({
      request: new Request("https://example.com/api/drawers", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          persona_id: "female_sutang",
          id: firstId,
          name: "下班歇脚",
          keywords: "累, 加班\n瘫",
          content: "改成我自己的说法：忙完先缓一缓，再顺着他的话说。",
          expected_version: listBody.shared_version,
        }),
      }),
      env,
    } as never);
    expect(update.status).toBe(200);

    const relist = await onRequest({
      request: new Request("https://example.com/api/drawers?persona_id=female_sutang", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    const edited = (await relist.json()).topics.find((drawer) => drawer.id === firstId);
    expect(edited).toMatchObject({
      name: "下班歇脚",
      keywords: ["累", "加班", "瘫"],
      content: "改成我自己的说法：忙完先缓一缓，再顺着他的话说。",
    });
  });

  it("always-on agent cards are available without matching a keyword", () => {
    const matched = matchActiveDrawers({
      custom: [
        {
          id: "child_age",
          name: "孩子年龄",
          keywords: [],
          content: "孩子今年 5 岁，任何时候都不能说成 3 岁。",
          kind: "identity",
          activation: "always",
        },
      ],
    }, "今天天气不错");
    expect(matched.join("\n")).toContain("孩子今年 5 岁");
    expect(matched.join("\n")).toContain("不能说成 3 岁");
  });

  it("creates and deletes a custom agent card", async () => {
    const kv = new MockKV();
    const env = { DB: new MockD1(), KV: kv, DASHBOARD_PASSWORD: "secret" };
    const created = await onRequest({
      request: new Request("https://example.com/api/drawers/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          persona_id: "female_sutang",
          name: "最讨厌的东西",
          kind: "policy",
          activation: "always",
          priority: 90,
          content: "最讨厌别人催她回复，任何模型都不能催。",
          expected_version: 1,
        }),
      }),
      env,
    } as never);
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    const card = createdBody.card;
    expect(card).toMatchObject({
      name: "最讨厌的东西",
      kind: "policy",
      activation: "always",
      priority: 90,
    });

    const listed = await onRequest({
      request: new Request("https://example.com/api/drawers?persona_id=female_sutang", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    const listBody = await listed.json();
    expect(listBody.cards.find((item: any) => item.id === card.id)).toMatchObject({
      content: "最讨厌别人催她回复，任何模型都不能催。",
      source: "custom",
    });

    const removed = await onRequest({
      request: new Request("https://example.com/api/drawers/cards", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          persona_id: "female_sutang",
          id: card.id,
          expected_version: createdBody.shared_version,
        }),
      }),
      env,
    } as never);
    expect(removed.status).toBe(200);
  });

  it("deletes a built-in persona card instead of hiding the delete button", async () => {
    const kv = new MockKV();
    const env = { DB: new MockD1(), KV: kv, DASHBOARD_PASSWORD: "secret" };
    const listed = await onRequest({
      request: new Request("https://example.com/api/drawers?persona_id=female_sutang", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    const listBody = await listed.json();
    const builtIn = listBody.topics[0];
    expect(builtIn.source).toBe("default");

    const removed = await onRequest({
      request: new Request("https://example.com/api/drawers/cards", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          persona_id: "female_sutang",
          id: builtIn.id,
          expected_version: listBody.shared_version,
        }),
      }),
      env,
    } as never);
    expect(removed.status).toBe(200);

    const relisted = await onRequest({
      request: new Request("https://example.com/api/drawers?persona_id=female_sutang", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    const after = await relisted.json();
    expect(after.cards.some((item: any) => item.id === builtIn.id)).toBe(false);
  });

  it("shows persona conflicts and locked rules in the agent overview", async () => {
    const db = new MockD1([], [{
      id: "female_sutang",
      name: "苏棠",
      system_prompt: "你是王雅慧，孩子现在 3 岁。",
      is_active: 1,
    }]);
    db.personaFactRows.set("female_sutang", {
      persona_id: "female_sutang",
      facts_json: JSON.stringify({
        age_mode: "fixed_age",
        fixed_age: 29,
        marital_status: "married",
        has_children: true,
        children_age: 5,
      }),
      version: 2,
    });
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const response = await onRequest({
      request: new Request("https://example.com/api/agent-overview?persona_id=female_sutang", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.cards.length).toBeGreaterThan(0);
    expect(body.legacy_rules.length).toBeGreaterThanOrEqual(40);
    expect(body.legacy_rules.some((item: any) => item.id === "explicit_boundary")).toBe(true);
    expect(body.locked_rules).toBeUndefined();
    expect(body.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "人设身份串了" }),
      expect.objectContaining({ title: "孩子年龄说法不一致" }),
    ]));
  });

  it("audits all four personas and warns without blocking a deliberate edit", async () => {
    const db = new MockD1([], [
      { id: "female", name: "星暮", system_prompt: "你是王雅慧，对外叫星暮。", is_active: 0, created_at: 1 },
      { id: "female_sutang", name: "苏棠", system_prompt: "你是苏棠，29岁，重庆人。", is_active: 1, created_at: 2 },
      { id: "male", name: "阿杰", system_prompt: "你是阿杰，31岁男性。", is_active: 0, created_at: 3 },
      { id: "male_chenyu", name: "陈屿", system_prompt: "你是陈屿，33岁男性。", is_active: 0, created_at: 4 },
    ]);
    db.personaFactRows.set("female", {
      persona_id: "female",
      facts_json: JSON.stringify({ age_mode: "fixed_age", fixed_age: 29, marital_status: "divorced", has_children: false }),
      version: 1,
    });
    db.personaFactRows.set("female_sutang", {
      persona_id: "female_sutang",
      facts_json: JSON.stringify({ age_mode: "fixed_age", fixed_age: 29, marital_status: "married", has_children: true, children_age: 3 }),
      version: 1,
    });
    for (const personaId of ["male", "male_chenyu"]) {
      db.personaFactRows.set(personaId, {
        persona_id: personaId,
        facts_json: JSON.stringify({ age_mode: "fixed_age", fixed_age: 31, marital_status: "married", has_children: false }),
        version: 1,
      });
    }
    const kv = new MockKV();
    await kv.put("persona:drawers:female", JSON.stringify({
      topics: [],
      counters: [],
      custom: [{
        id: "wrong_persona",
        name: "错误卡片",
        content: "你是苏棠，做电商运营，还要带3岁的娃。",
        keywords: [],
        enabled: true,
      }],
    }));
    const env = { DB: db, KV: kv, DASHBOARD_PASSWORD: "secret" };
    const response = await onRequest({
      request: new Request("https://example.com/api/persona-audit", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.warning_count).toBeGreaterThan(0);
    expect(body.personas.find((item: any) => item.persona_id === "female").issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "卡片：错误卡片" }),
      ]),
    );

    const saved = await onRequest({
      request: new Request("https://example.com/api/drawers/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          persona_id: "female",
          expected_version: 1,
          name: "错误卡片",
          content: "你是苏棠，做电商运营，还要带3岁的娃。",
        }),
      }),
      env,
    } as never);
    expect(saved.status).toBe(201);
    await expect(saved.json()).resolves.toMatchObject({
      success: true,
      card: { name: "错误卡片" },
    });
  });
});
