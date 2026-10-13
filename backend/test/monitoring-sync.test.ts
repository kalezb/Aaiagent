import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import { onRequest } from "../functions/api/[[route]]";
import {
  buildLayeredSystemPrompt,
  buildRelationshipBoundaryPrompt,
  avoidRepeatedAssistantReply,
  capReplyLength,
  fixSpousePerspective,
  isSelfMediaOffer,
  owesReplyFromHistory,
  isPhotoAuthenticityChallenge,
  detectContactMaritalStatus,
  dropPhotoAdmissionClauses,
  dropBlameSegmentsWhenOwing,
  dropAcceptedSelfMediaSegments,
} from "../functions/api/_reply_policy";
import {
  buildMediaDirectiveInstruction,
  findMatchingMediaGroup,
  hasNonPersonalMediaContext,
  hasContextualMediaRequest,
  isExplicitBodyMediaRequest,
  isExplicitMediaRequest,
  isRealtimeImageRequest,
  normalizePersonalPhotoIntent,
  resolveMediaGroupForDirective,
  shouldClassifyPersonalPhotoIntent,
} from "../functions/api/_media_policy";
import {
  defaultDrawersForPersona,
  matchActiveDrawers,
} from "../functions/api/_persona_drawers";
import {
  DEFAULT_AGENT_RULES,
  LEGACY_AGENT_RULES,
} from "../functions/api/_agent_rule_inventory";
import { DEFAULT_PROGRAM_RULES } from "../functions/api/_program_rules";
import {
  MockD1,
  MockKV,
  mockChatSequence,
} from "./chat-test-helpers";
import { readDashboardScript } from "./dashboard-source";

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

  it("seeds and edits the unified Agent rule catalog used by chat", async () => {
    expect(LEGACY_AGENT_RULES).toHaveLength(41);
    expect(DEFAULT_AGENT_RULES.length).toBeGreaterThan(LEGACY_AGENT_RULES.length);
    expect(new Set(LEGACY_AGENT_RULES.map((rule) => rule.gate))).toEqual(
      new Set(["input", "prompt", "output", "execution"]),
    );
    const db = new MockD1();
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const listed = await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    expect(listed.status).toBe(200);
    const listBody = await listed.json();
    expect(listBody.rules).toHaveLength(DEFAULT_AGENT_RULES.length);
    expect(listBody.conflicts).toEqual(expect.any(Array));
    expect(listBody.summary).toMatchObject({
      total: expect.any(Number),
      errors: expect.any(Number),
      warnings: expect.any(Number),
    });
    expect(new Set(listBody.rules.map((rule: any) => rule.gate))).toEqual(
      new Set(["input", "prompt", "output", "execution"]),
    );
    expect(listBody.rules[0].priority).toBeGreaterThanOrEqual(listBody.rules.at(-1).priority);

    const photoMemoryRule = listBody.rules.find(
      (rule: any) => rule.legacy_rule_id === "his_photo_memory",
    );
    expect(photoMemoryRule).toMatchObject({ title: "他发过照片后不再问长相" });
    const updatePhotoRule = await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({ id: photoMemoryRule.id, enabled: false }),
      }),
      env,
    } as never);
    expect(updatePhotoRule.status).toBe(200);
    expect(db.agentRuleRows.get(photoMemoryRule.id)?.enabled).toBe(0);
    await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({ id: photoMemoryRule.id, enabled: true }),
      }),
      env,
    } as never);
    const deletePhotoRule = await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({ id: photoMemoryRule.id }),
      }),
      env,
    } as never);
    expect(deletePhotoRule.status).toBe(200);
    expect(db.agentRuleRows.get(photoMemoryRule.id)?.enabled).toBe(0);
    expect(Number(db.agentRuleRows.get(photoMemoryRule.id)?.deleted_at || 0)).toBeGreaterThan(0);

    const missingQuestionRule = [...db.agentRuleRows.values()]
      .find((rule: any) => rule.legacy_rule_id === "question_pacing");
    db.agentRuleRows.delete(missingQuestionRule.id);
    db.agentRuleRows.set("dashboard_extra_for_count", {
      id: "dashboard_extra_for_count",
      legacy_rule_id: "",
      persona_id: "",
      title: "补位规则",
      detail: "只把总数补回原样，不能阻止缺失的默认规则恢复。",
      gate: "prompt",
      priority: 50,
      enabled: 1,
      sort_order: 999,
      source: "dashboard",
      created_at: 1,
      updated_at: 1,
      deleted_at: 0,
    });
    const reseeded = await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    const reseededRules = (await reseeded.json()).rules;
    expect(reseededRules.some((rule: any) => rule.legacy_rule_id === "question_pacing"))
      .toBe(true);

    const created = await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          title: "测试规则",
          detail: "这条规则只用于测试规则库。",
          gate: "output",
          priority: 88,
          persona_id: "female_sutang",
          enabled: true,
        }),
      }),
      env,
    } as never);
    expect(created.status).toBe(201);
    const createdId = (await created.json()).id;

    const updated = await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({ id: createdId, enabled: false, priority: 91 }),
      }),
      env,
    } as never);
    expect(updated.status).toBe(200);
    expect(db.agentRuleRows.get(createdId)?.enabled).toBe(0);
  });

  it("saves and tests code-backed program rules from the dashboard", async () => {
    const kv = new MockKV();
    const env = { DB: new MockD1(), KV: kv, DASHBOARD_PASSWORD: "secret" };
    const saved = await onRequest({
      request: new Request("https://example.com/api/program-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          rules: {
            ...DEFAULT_PROGRAM_RULES,
            platformNotice: {
              enabled: true,
              markers: ["新平台提醒"],
            },
            sticker: {
              enabled: true,
              meanings: { 月亮: "想找你聊天" },
              instruction: "表情按程序含义理解。",
            },
          },
        }),
      }),
      env,
    } as never);
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      success: true,
      rules: {
        platformNotice: {
          markers: ["新平台提醒"],
        },
      },
    });

    const loaded = await onRequest({
      request: new Request("https://example.com/api/program-rules", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    expect(loaded.status).toBe(200);
    await expect(loaded.json()).resolves.toMatchObject({
      customized: true,
      rules: {
        platformNotice: {
          markers: ["新平台提醒"],
        },
      },
    });

    const tested = await onRequest({
      request: new Request("https://example.com/api/program-rules/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({ content: "【新平台提醒】对方正在输入……" }),
      }),
      env,
    } as never);
    expect(tested.status).toBe(200);
    await expect(tested.json()).resolves.toMatchObject({
      platform_notice: true,
    });
  });

  it("uploads and lists an Android automation incident", async () => {
    const db = new MockD1();
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const payload = [
      JSON.stringify({
        eventId: "event-1",
        incidentId: "incident-test-1",
        event: "page_observed",
        platform: "soul",
        contactId: "contact-a",
        appVersion: "20261009-1647",
      }),
      JSON.stringify({
        eventId: "event-2",
        incidentId: "incident-test-1",
        event: "anomaly",
        action: "UnexpectedProfilePageAfterReply",
      }),
    ].join("\n");

    const uploaded = await onRequest({
      request: new Request("https://example.com/api/automation-incidents", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-ndjson",
          Authorization: "Bearer test-token",
          "X-Incident-Id": "incident-test-1",
          "X-App-Version": "20261009-1647",
        },
        body: payload,
      }),
      env,
    } as never);
    expect(uploaded.status).toBe(201);
    await expect(uploaded.json()).resolves.toMatchObject({
      success: true,
      id: "incident-test-1",
      event_count: 2,
    });

    const listed = await onRequest({
      request: new Request("https://example.com/api/automation-incidents?limit=10", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      incidents: [{
        id: "incident-test-1",
        event_count: 2,
        app_version: "20261009-1647",
      }],
    });

    const detail = await onRequest({
      request: new Request("https://example.com/api/automation-incidents?id=incident-test-1", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      incident: {
        id: "incident-test-1",
        payload,
      },
    });
  });

  it("records a customer dashboard black-box incident", async () => {
    const db = new MockD1();
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const response = await onRequest({
      request: new Request("https://example.com/api/dashboard-incidents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Password": "secret",
        },
        body: JSON.stringify({
          id: "dashboard-incident-1",
          kind: "api_error",
          reason: "图库上传失败",
          context: {
            app_version: "dashboard-test",
            page: "library",
          },
          events: [
            { type: "request", path: "/media-library/assets" },
            { type: "response", status: 500 },
          ],
        }),
      }),
      env,
    } as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      id: "dashboard-incident-1",
      event_count: 2,
    });
    expect(db.incidentRows.get("dashboard-incident-1")).toMatchObject({
      source: "dashboard",
      kind: "api_error",
      event_count: 2,
    });

    const updated = await onRequest({
      request: new Request("https://example.com/api/automation-incidents", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Password": "secret",
        },
        body: JSON.stringify({
          id: "dashboard-incident-1",
          status: "fixed",
        }),
      }),
      env,
    } as never);
    expect(updated.status).toBe(200);
    expect(db.incidentRows.get("dashboard-incident-1")?.status).toBe("fixed");
  });

  it("ships dashboard black-box feedback and incident details", () => {
    const appSource = readDashboardScript();
    const htmlSource = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
    expect(appSource).toContain('"/dashboard-incidents"');
    expect(appSource).toContain("data-incident-view");
    expect(appSource).toContain("screenshotData");
    expect(htmlSource).toContain('id="dashboardFeedbackButton"');
    expect(htmlSource).toContain('id="dashboardIncidentModal"');
    expect(htmlSource).toContain('id="createDashboardReplayButton"');
    expect(htmlSource).toContain('id="saveDashboardIncidentStatusButton"');
    expect(htmlSource).toContain('id="runReplayCasesButton"');
  });

  it("turns an incident into a permanent replay case", async () => {
    const db = new MockD1();
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const incidentPayload = [
      JSON.stringify({
        timestampMs: 1_000,
        event: "delivery_finished",
        incidentId: "incident-replay-1",
        result: "complete",
      }),
      JSON.stringify({
        timestampMs: 1_500,
        event: "page_observed",
        pageKind: "PROFILE_PAGE",
        incidentId: "incident-replay-1",
      }),
      JSON.stringify({
        event: "anomaly",
        incidentId: "incident-replay-1",
        action: "UnexpectedProfilePageAfterReply",
        result: "anomaly",
      }),
      JSON.stringify({
        event: "screenshot_captured",
        incidentId: "incident-replay-1",
        screenshotRef: "screenshots/profile.jpg",
      }),
    ].join("\n");
    await onRequest({
      request: new Request("https://example.com/api/automation-incidents", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-ndjson",
          Authorization: "Bearer test-token",
          "X-Incident-Id": "incident-replay-1",
          "X-Incident-Source": "android",
        },
        body: incidentPayload,
      }),
      env,
    } as never);

    const created = await onRequest({
      request: new Request("https://example.com/api/replay-cases/from-incident", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Password": "secret",
        },
        body: JSON.stringify({
          incident_id: "incident-replay-1",
          title: "资料页误入回放",
        }),
      }),
      env,
    } as never);
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      success: true,
      replay_case: {
        incident_id: "incident-replay-1",
        title: "资料页误入回放",
        kind: "android_event_sequence",
      },
    });

    const listed = await onRequest({
      request: new Request("https://example.com/api/replay-cases?limit=20", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    await expect(listed.json()).resolves.toMatchObject({
      replay_cases: [{
        incident_id: "incident-replay-1",
        title: "资料页误入回放",
      }],
    });
    expect(db.replayCaseRows.size).toBe(1);

    const replayed = await onRequest({
      request: new Request("https://example.com/api/replay-cases/run", {
        method: "POST",
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    await expect(replayed.json()).resolves.toMatchObject({
      success: true,
      total: 1,
      failed: 0,
    });
  });

  it("cleans old incidents but keeps incidents referenced by replay cases", async () => {
    const db = new MockD1();
    const now = Math.floor(Date.now() / 1000);
    db.incidentRows.set("old-unreferenced", {
      id: "old-unreferenced",
      token: "test-token",
      status: "new",
      created_at: now - 31 * 24 * 3600,
    });
    db.incidentRows.set("old-referenced", {
      id: "old-referenced",
      token: "test-token",
      status: "new",
      created_at: now - 31 * 24 * 3600,
    });
    db.replayCaseRows.set("replay-old", {
      id: "replay-old",
      incident_id: "old-referenced",
    });
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };

    const listed = await onRequest({
      request: new Request("https://example.com/api/automation-incidents", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);

    expect(listed.status).toBe(200);
    expect(db.incidentRows.has("old-unreferenced")).toBe(false);
    expect(db.incidentRows.has("old-referenced")).toBe(true);
  });

  it("tests the same persona and always-on cards on both model lines", async () => {
    const db = new MockD1([], [{
      id: "female_sutang",
      name: "苏棠",
      system_prompt: "你是苏棠，说话自然简短。",
      is_active: 1,
    }]);
    db.personaFactRows.set("female_sutang", {
      persona_id: "female_sutang",
      facts_json: JSON.stringify({ age_mode: "fixed_age", fixed_age: 29, has_children: true, children_age: 5 }),
      version: 2,
    });
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const target = String(url);
      return new Response(JSON.stringify({
        choices: [{ message: { content: target.includes("generativelanguage") ? "孩子5岁" : "孩子今年5岁" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const kv = new MockKV();
    await kv.put("persona:drawers:female_sutang", JSON.stringify({
      custom: [{
        id: "child_age",
        name: "孩子年龄",
        keywords: [],
        content: "孩子今年5岁，任何模型都不能说成3岁。",
        kind: "identity",
        activation: "always",
        priority: 90,
        enabled: true,
      }],
    }));
    const env = {
      DB: db,
      KV: kv,
      DASHBOARD_PASSWORD: "secret",
      GEMINI_API_KEY: "gemini-key",
      DEEPSEEK_API_KEY: "deepseek-key",
    };
    const response = await onRequest({
      request: new Request("https://example.com/api/agent-overview/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          persona_id: "female_sutang",
          questions: ["你孩子几岁？"],
        }),
      }),
      env,
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      results: [{
        question: "你孩子几岁？",
        line_a: { ok: true, reply: "孩子今年5岁" },
        line_b: { ok: true, reply: "孩子5岁" },
      }],
    });
    const bodies = fetchMock.mock.calls.map(([, init]) => String((init as RequestInit).body || ""));
    expect(bodies).toHaveLength(2);
    expect(bodies.every((body) => body.includes("孩子今年5岁"))).toBe(true);
  });

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

  it("records an image only after the phone confirms delivery", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", trigger_keywords: "\u60f3\u770b\u4f60\u7167\u7247", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" }],
      mediaSendRows: [],
    });
    const fetchMock = mockChatSequence(["DAILY"]);
    vi.stubGlobal("fetch", fetchMock);
    const generatedResponse = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "confirm-topic-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "\u60f3\u770b\u4f60\u7167\u7247" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const generated = await generatedResponse.json();
    expect(db.historyRows).toHaveLength(0);

    const confirmResponse = await onRequest({
      request: new Request("https://example.com/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ reply_id: generated.reply_id, sent_content: "ignored" }),
      }),
      env: { DB: db, KV: new MockKV() },
    } as never);
    expect(confirmResponse.status).toBe(200);
    expect(db.historyRows[0].content).toMatch(/^\[\u56fe\u7247:daily_01\]$/u);
    expect(db.options.mediaSendRows).toHaveLength(1);
    expect(db.options.mediaSendRows[0]).toMatchObject({ group_id: "daily", asset_id: "daily_01" });
  });

  it("does not select a topic image in semi-auto mode", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "text reply" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", trigger_keywords: "\u60f3\u770b\u4f60\u7167\u7247", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily" }],
    });
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "semi-topic-image",
          platform: "soul",
          hosting_mode: "semi_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "\u60f3\u770b\u4f60\u7167\u7247" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();
    expect(body.action).toBe("send");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/chat/completions"))).toBe(true);
  });

  it("blocks realtime or weather questions from topic image matching", () => {
    const groups = [
      { id: "daily", trigger_keywords: "\u7167\u7247,\u65e5\u5e38\u7167,\u751f\u6d3b\u7167" },
      { id: "body", trigger_keywords: "\u8eab\u6750,\u8eab\u6750\u7167,\u770b\u817f" },
    ];
    const realtimeQuestions = [
      "\u4f60\u73b0\u5728\u7a7f\u7684\u4ec0\u4e48",
      "\u4f60\u73b0\u5728\u5728\u5e72\u561b",
      "\u53d1\u4e00\u5f20\u73b0\u5728\u7684\u7167\u7247",
      "\u4f60\u90a3\u8fb9\u5929\u6c14\u600e\u4e48\u6837",
      "\u4f60\u73b0\u5728\u8eab\u6750\u600e\u4e48\u6837",
    ];

    for (const question of realtimeQuestions) {
      expect(isRealtimeImageRequest(question), question).toBe(true);
      expect(findMatchingMediaGroup(groups, question)).toBeNull();
    }
    expect(findMatchingMediaGroup(groups, "\u60f3\u770b\u770b\u4f60\u7684\u65e5\u5e38\u7167")?.group.id).toBe("daily");
    expect(findMatchingMediaGroup(groups, "\u770b\u770b\u8eab\u6750\u7167")?.group.id).toBe("body");
  });

  it("requires an explicit request for star-soul topic images", () => {
    const groups = [
      { id: "daily", trigger_keywords: "\u65e5\u5e38\u7167,\u7167\u7247,\u4ee5\u56fe\u6362\u56fe" },
      { id: "body", trigger_keywords: "\u8eab\u6750\u7167,\u8eab\u6750,\u770b\u817f" },
    ];

    expect(isExplicitMediaRequest("\u6211\u559c\u6b22\u770b\u8eab\u6750\u7167")).toBe(false);
    expect(isExplicitMediaRequest("\u4e0d\u60f3\u770b\u8eab\u6750\u7167")).toBe(false);
    expect(isExplicitMediaRequest("\u770b\u770b\u4f60\u7684\u8eab\u6750\u7167")).toBe(true);
    expect(isExplicitMediaRequest("[\u4ee5\u56fe\u6362\u56fe]")).toBe(true);
    expect(findMatchingMediaGroup(groups, "\u6211\u559c\u6b22\u770b\u8eab\u6750\u7167", { requireExplicitRequest: true })).toBeNull();
    expect(findMatchingMediaGroup(groups, "\u770b\u770b\u4f60\u7684\u8eab\u6750\u7167", { requireExplicitRequest: true })?.group.id).toBe("body");
    expect(findMatchingMediaGroup(groups, "[\u4ee5\u56fe\u6362\u56fe]", { requireExplicitRequest: true })?.group.id).toBe("daily");
  });

  it("only treats explicit body language as a body-photo request", () => {
    const groups = [
      { id: "daily", name: "日常照" },
      { id: "body", name: "身材照" },
    ];

    expect(isExplicitBodyMediaRequest("发一下身材照呗")).toBe(true);
    expect(isExplicitBodyMediaRequest("看看你的腿")).toBe(true);
    expect(isExplicitBodyMediaRequest("照片拍得不错")).toBe(false);
    expect(isExplicitBodyMediaRequest("发一下呗")).toBe(false);
    expect(isExplicitMediaRequest("发一下你的照片")).toBe(true);
    expect(isExplicitMediaRequest("给一下你的照片")).toBe(true);
    expect(isExplicitMediaRequest("可以看看你样子吗")).toBe(true);
    expect(isExplicitMediaRequest("看看你可以吗")).toBe(true);
    expect(isExplicitMediaRequest("看一下机器的照片")).toBe(false);
    expect(hasContextualMediaRequest(["看一下"])).toBe(false);
    expect(hasContextualMediaRequest(["发一下"])).toBe(false);
    expect(hasContextualMediaRequest(["给一下"])).toBe(false);
    expect(hasContextualMediaRequest(["看一下照片"])).toBe(true);
    expect(hasContextualMediaRequest(["可以看看你样子吗"])).toBe(true);
    expect(hasContextualMediaRequest(["看看你可以吗"])).toBe(true);
    expect(hasContextualMediaRequest(["想看你照片", "看一下"])).toBe(true);
    expect(hasContextualMediaRequest(["想看你照片", "给一下"])).toBe(true);
    expect(hasContextualMediaRequest(["看一下你现在的机器的样子", "看一下呗"])).toBe(false);
    expect(hasContextualMediaRequest(["看一下机器的照片", "给一下"])).toBe(false);
    expect(hasNonPersonalMediaContext(["看一下你现在的机器的样子", "看一下呗"])).toBe(true);
    expect(hasNonPersonalMediaContext(["想看你照片", "看一下呗"])).toBe(false);
    expect(shouldClassifyPersonalPhotoIntent(["可以看看你样子吗"])).toBe(true);
    expect(shouldClassifyPersonalPhotoIntent(["嗯嗯，好的"])).toBe(false);
    expect(normalizePersonalPhotoIntent("`DAILY`")).toBe("daily");
    expect(normalizePersonalPhotoIntent("BODY\n")).toBe("body");
    expect(normalizePersonalPhotoIntent("NONE，因为是在说机器")).toBe("none");
    expect(normalizePersonalPhotoIntent("[[SEND_MEDIA:daily]]")).toBe("none");
    expect(resolveMediaGroupForDirective(groups, "body", ["想看你照片", "发一下呗"])?.id).toBe("daily");
    expect(resolveMediaGroupForDirective(groups, "body", ["想看身材照", "发一下呗"])?.id).toBe("body");
    expect(resolveMediaGroupForDirective(groups, "unknown", ["想看你照片"])).toBeNull();
    expect(resolveMediaGroupForDirective([{ id: "body", name: "身材照" }], "body", ["发一下呗"])).toBeNull();
    expect(buildMediaDirectiveInstruction(groups)).toContain("给一下");
    expect(buildMediaDirectiveInstruction(groups)).toContain("机器");
  });

  it("lets the model choose a contextual daily photo without an exact keyword", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [
        { id: "daily", name: "日常照", trigger_keywords: "想看你照片", is_active: 1 },
      ],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
      ],
    });
    const fetchMock = mockChatSequence(["DAILY"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "contextual-daily-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [
            { role: "user", content: "想看你照片" },
            { role: "user", content: "看一下呗" },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ action: "send_media", media: { group_id: "daily", asset_id: "daily_01" } });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/chat/completions"))).toBe(true);
  });

  it("lets the model interpret personal appearance wording without a photo keyword", async () => {
    for (const [requestId, incoming] of [
      ["appearance-daily-image", "可以看看你样子吗"],
      ["you-can-image", "看看你可以吗"],
    ]) {
      const db = new MockD1().withOptions({
        mediaGroups: [
          { id: "daily", name: "日常照", trigger_keywords: "想看你照片", is_active: 1 },
        ],
        mediaAssets: [
          { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
        ],
      });
      const fetchMock = mockChatSequence(["DAILY"]);
      vi.stubGlobal("fetch", fetchMock);

      const response = await onRequest({
        request: new Request("https://example.com/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
          body: JSON.stringify({
            request_id: requestId,
            platform: "soul",
            hosting_mode: "full_auto",
            contact_id: "contact-1",
            contact_name: "contact",
            messages: [{ role: "user", content: incoming }],
          }),
        }),
        env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
      } as never);
      const body = await response.json();

      expect(response.status, incoming).toBe(200);
      expect(body, incoming).toMatchObject({
        action: "send_media",
        media: { group_id: "daily", asset_id: "daily_01" },
      });
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/chat/completions")), incoming).toBe(true);
    }
  });

  it("sends a daily photo when the photo intent classifier recognizes a personal appearance request", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [
        { id: "daily", name: "日常照", trigger_keywords: "想看你照片", is_active: 1 },
      ],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
      ],
    });
    const fetchMock = mockChatSequence([
      "DAILY",
      "照片先不发了，聊聊呗",
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "classified-daily-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "可以看看你样子吗" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();
    const chatCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/chat/completions"));
    const classifierBody = JSON.parse(String(chatCalls[0]?.[1]?.body || "{}"));

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      action: "send_media",
      media: { group_id: "daily", asset_id: "daily_01" },
    });
    expect(chatCalls).toHaveLength(1);
    expect(String(classifierBody.messages?.[0]?.content || "")).toContain("照片意图分类器");
  });

  it("does not use photo keywords to veto a semantic media decision when the classifier was not needed", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [
        { id: "daily", name: "日常照", trigger_keywords: "想看你照片", is_active: 1 },
      ],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
      ],
    });
    const fetchMock = mockChatSequence(["[[SEND_MEDIA:daily]]"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "semantic-directive-without-keyword",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "让我认认你" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      action: "send_media",
      media: { group_id: "daily", asset_id: "daily_01" },
    });
    expect(hasContextualMediaRequest(["让我认认你"])).toBe(false);
  });

  it("honours a model media directive even when the classifier said NONE", async () => {
    // 2026-10-05 改动：分类器只当“额外触发器”，不再否决模型已经发出的指令。
    // 旧行为是这里会被否决掉，最后回一句“照片先不发了，聊聊呗”。
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = mockChatSequence([
      "NONE",
      "[[SEND_MEDIA:daily]]",
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "model-directive-with-none-classifier",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "发张照片看看" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send_media");
    expect(body.media.group_id).toBe("daily");
  });

  it("drops a segment the persona already said days ago", () => {
    // 真机原样（你压到我头发了）：模型把两天前说过的“重庆人嘛 你说呢”原句搬出来当新回复。
    const now = Math.floor(Date.now() / 1000);
    const history = [
      { role: "user", content: "你是重庆人吗", created_at: now - 2 * 86400 },
      { role: "assistant", content: "重庆人嘛 你说呢|||不过这两天忙晕了 才顾上回你", created_at: now - 2 * 86400 },
    ];
    const reply = "重庆人嘛 你说呢|||娃睡了 才顾上看手机";
    expect(avoidRepeatedAssistantReply(reply, history, "忙啥呢 这是", now))
      .toBe("娃睡了 才顾上看手机");
  });

  it("uses only the new Su Tang knowledge cards", () => {
    const drawers = defaultDrawersForPersona("female_sutang");
    const ids = (drawers.topics || []).map((item) => item.id);
    expect(ids).toHaveLength(25);
    expect(ids).toContain("scene_01_black_stockings");
    expect(ids).toContain("scene_13_invitation_reward");
    expect(ids).toContain("scene_14_rainy_neck");
    expect(ids).toContain("scene_16_douban_tree_hole");
    expect(ids).toContain("scene_23_sunny_hot_summer");
    expect(ids).toContain("scene_24_cold_wind_winter");
    expect(ids).toContain("scene_25_pleasant_breeze");
    expect(ids).not.toContain("sofa_tired");
    expect(ids).not.toContain("food_hungry");

    const stockings = matchActiveDrawers(drawers, "你今天穿黑丝了吗").join("\n");
    expect(stockings).not.toContain("黑丝与腿部触感");
    expect(stockings).not.toContain("刚把黑丝脱了");

    const invite = matchActiveDrawers(drawers, "想约你开房").join("\n");
    expect(invite).toContain("打压轻浮与纠正姿态");
    expect(invite).toContain("真站我跟前");
    expect(invite).not.toContain("一句硬话回掉");

    const rainyNeck = matchActiveDrawers(drawers, "今晚下雨 后背酸得厉害").join("\n");
    expect(rainyNeck).toContain("居家放松与颈背酸胀");
    expect(rainyNeck).toContain("后背和颈椎酸得要命");

    expect(matchActiveDrawers(drawers, "今天吃什么了")).toEqual([]);
  });

  it("detects photo authenticity challenge and strips admissions", () => {
    // 2026-10-06 真机：他说“这是网图吧”，模型顺手认了（“嗯 网上找的”）——等于当场露馅。
    expect(isPhotoAuthenticityChallenge("这是网图吧")).toBe(true);
    expect(isPhotoAuthenticityChallenge("这不是你吧")).toBe(true);
    expect(isPhotoAuthenticityChallenge("今天天气不错")).toBe(false);
    expect(dropPhotoAdmissionClauses("嗯 网上找的")).toBe("");
    expect(dropPhotoAdmissionClauses("我自己拍的呀 你这话我可记住了")).toBe("我自己拍的呀 你这话我可记住了");
    expect(dropPhotoAdmissionClauses("我自己拍的呀|||其实是网上找的")).toBe("我自己拍的呀");
  });

  it("never sends time markers back to the contact", async () => {
    // 2026-10-07：模型会把喂给它的时间标记原样吐出来（真机漏过“【10/06，21:07，0”）。
    // 三种格式（中文方括号 / 英文方括号 / ISO）都必须清掉。
    for (const content of ["【10/06 01:32，13小时前】对方：睡了", "[2026-10-06 01:32] 对方：睡了", "2026-10-06T01:32:00+08:00 对方：睡了"]) {
      const db = new MockD1([], [
        { id: "female_sutang", name: "苏棠", system_prompt: "你是苏棠，做电商运营。", identity_terms: JSON.stringify(["电商运营"]) },
      ]);
      db.tokenPersonas.set("test-token", "female_sutang");
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )));
      vi.stubGlobal("fetch", fetchMock);
      const response = await onRequest({
        request: new Request("https://example.com/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
          body: JSON.stringify({
            platform: "soul",
            contact_id: "tm",
            contact_name: "时间标记测试",
            messages: [{ role: "user", content: "在吗", created_at: Math.floor(Date.now() / 1000) }],
          }),
        }),
        env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
      } as never);
      const body = await response.json();
      const sent = String(body.reply || "");
      expect(sent).not.toContain("【");
      expect(sent).not.toContain("2026-10-06");
      expect(sent).not.toContain("01:32");
    }
  });

  it("never sends prompt-marker leakage like 【10/06，21:07，0", async () => {
    // 2026-10-06 真机：模型偶发把提示词里的中文方括号标记吐出来，差点当成消息发出去。
    const db = new MockD1([], [
      { id: "female_sutang", name: "苏棠", system_prompt: "你是苏棠，做电商运营。", identity_terms: JSON.stringify(["电商运营"]) },
    ]);
    db.tokenPersonas.set("test-token", "female_sutang");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(
      JSON.stringify({ choices: [{ message: { content: "【10/06，21:07，0" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "xq",
          contact_name: "稀奇",
          messages: [{ role: "user", content: "吃了没", created_at: Math.floor(Date.now() / 1000) }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(String(body.reply || "")).not.toContain("【");
    expect(String(body.reply || "")).not.toContain("21:07");
  });

  it("never blames him when she is the one who owes a reply", () => {
    // 真机（请叫我球⚽️）：昨天凌晨聊完她一句没回，他今天又发来；
    // 她回“昨晚聊着聊着就没影了 我还等着呢”——倒打一耙，被用户当场撤回。
    const heThenHe = [
      { role: "user", content: "梦都能接上呢～" },
      { role: "user", content: "早上好" },
    ];
    expect(owesReplyFromHistory([], heThenHe)).toBe(true);
    const sheThenHe = [
      { role: "assistant", content: "我醒了就得翻半天才迷糊回去" },
      { role: "user", content: "早上好" },
    ];
    expect(owesReplyFromHistory([], sheThenHe)).toBe(false);

    expect(dropBlameSegmentsWhenOwing("昨晚聊着聊着就没影了 我还等着呢")).toBe("");
    expect(dropBlameSegmentsWhenOwing("你怎么不回我")).toBe("");
    // 正常的段不受影响
    expect(dropBlameSegmentsWhenOwing("早呀 昨晚睡挺好")).toBe("早呀 昨晚睡挺好");
    expect(dropBlameSegmentsWhenOwing("早呀|||你怎么不回我")).toBe("早呀");
    // 提示词里也要写明这条
    expect(buildRelationshipBoundaryPrompt(2, "早上好", [])).not.toContain("倒打一耙");
  });

  it("never forces the model to ask about marital status (real case, asked 3 times)", () => {
    // 2026-10-07 用户澄清：要求只有一条——排除已婚的；不是“必须问清婚况”。
    // 之前那句“直接问，别绕：聊上几句之后就问一句他到底单身还是已婚”是连问三遍的源头。
    const prompt = buildLayeredSystemPrompt({
      personaPrompt: "你是苏棠。",
      platform: "soul",
      homeLocation: { city: "重庆", district: "江北区" },
      workLocation: { city: "重庆", district: "江北区" },
      currentDatetime: "2026-10-07 18:00",
      weather: { city: "重庆", condition: "晴", temp: 25 },
      messages: [{ role: "user", content: "搞不来那些弯弯拐拐的" }],
      historyMessages: [],
      contactMaritalStatus: "",
    });
    expect(prompt).not.toContain("直接问，别绕");
    expect(prompt).not.toContain("你是单身还是已婚呀");
    const known = buildLayeredSystemPrompt({
      personaPrompt: "你是苏棠。",
      platform: "soul",
      homeLocation: { city: "重庆", district: "江北区" },
      workLocation: { city: "重庆", district: "江北区" },
      currentDatetime: "2026-10-07 18:00",
      weather: { city: "重庆", condition: "晴", temp: 25 },
      messages: [{ role: "user", content: "在忙吗" }],
      historyMessages: [],
      contactMaritalStatus: "single",
    });
    // 2026-10-07 用户要求：婚况不进提示词（别白烧 token）。已婚的根本走不到这里（引擎层挡掉），
    // 单身/离异照常聊，也不需要任何提醒。
    expect(known).not.toContain("婚况");
    expect(known).not.toContain("单身");
  });

  it("recognizes his marital status even without 我 (real case: 雾琐星河岸)", () => {
    // 2026-10-07 真机：他说“肯定是单身撒”“单身汉”，因为没有“我”字，旧判断认不出来，
    // 于是她连问三遍“你是单身还是已婚呀”，被对方点破“你问了三次了”。
    expect(detectContactMaritalStatus([{ role: "user", content: "肯定是单身撒" }])).toBe("single");
    expect(detectContactMaritalStatus([{ role: "user", content: "单身汉" }])).toBe("single");
    expect(detectContactMaritalStatus([{ role: "user", content: "我离异" }])).toBe("single");
    // 已婚仍要认出来（这类会被直接停回）
    expect(detectContactMaritalStatus([{ role: "user", content: "我结婚了" }])).toBe("married");
    expect(detectContactMaritalStatus([{ role: "user", content: "我有老婆" }])).toBe("married");
    // 说别人单身不算他单身，也不能误判成已婚
    expect(detectContactMaritalStatus([{ role: "user", content: "我朋友单身好多年了" }])).toBe("");
    expect(detectContactMaritalStatus([{ role: "user", content: "结婚了还来这个上面哇" }])).toBe("");
    // 她自己说自己已婚不算他的婚况
    expect(detectContactMaritalStatus([{ role: "assistant", content: "我结婚了我有老公" }])).toBe("");
  });

  it("drops the segment where she accepts his photos", () => {
    // 真机：他说“我给你看我的照片”，她回“真的假的 那我得看看”。只删这段，不换固定句。
    expect(isSelfMediaOffer("想不想看我的身材照")).toBe(true);
    expect(isSelfMediaOffer("我给你看看我的腹肌")).toBe(true);
    expect(isSelfMediaOffer("今天天气不错")).toBe(false);
    expect(dropAcceptedSelfMediaSegments("真的假的 那我得看看")).toBe("");
    expect(dropAcceptedSelfMediaSegments("这么主动呀|||那我得看看")).toBe("这么主动呀");
    expect(dropAcceptedSelfMediaSegments("这么晚了还秀腹肌呀")).toBe("这么晚了还秀腹肌呀");
  });

  it("fixes the spouse perspective in replies", () => {
    // 真机（仙逆）：对方说"你老公"指的是苏棠的老公，模型跟着叫"你老公"却讲自己的事。
    expect(fixSpousePerspective("你老公天天跑渠道 估计没空管我聊什么？"))
      .toBe("我老公天天跑渠道 估计没空管我聊什么？");
    expect(fixSpousePerspective("我老公忙呢|||你老公天天跑渠道 估计没空管我"))
      .toBe("我老公忙呢|||我老公天天跑渠道 估计没空管我");
    // 2026-10-06：同族的“娃/孩子”也要一起管住（真机里对方说“娃娃”指的是苏棠的娃）
    expect(fixSpousePerspective("你娃多大了")).toBe("我娃多大了");
    expect(fixSpousePerspective("你孩子睡了吧")).toBe("我孩子睡了吧");
    // 反问对方的情况不算错
    expect(fixSpousePerspective("你老公呢？")).toBe("你老公呢？");
    expect(fixSpousePerspective("你孩子多大了")).toBe("我孩子多大了");
    expect(fixSpousePerspective("我老公做粮油销售的")).toBe("我老公做粮油销售的");
  });

  it("never sends half a sentence when the model breaks a line mid-sentence", () => {
    // 真机（遇见 2026-10-07 23:10）：她发出去“刚关了电脑 屋里就剩”，对方回“就剩什么”。
    const reply = "刚关了电脑 屋里就剩\n我这盏灯还亮着呢";
    const fixed = capReplyLength(reply, "你在干嘛");
    expect(fixed).not.toBe("刚关了电脑 屋里就剩");
    expect(fixed).not.toMatch(/剩$/u);
    // 他这句只有 4 个字：只回一条完整的短句（不许是“刚关了电脑 屋里就剩”这种半句）。
  });

  it("drops a repeated delay excuse but keeps the substance", () => {
    // 真机原样（一一）：23:59 说过“刚看手机才看到”，00:12 又说“刚没顾上看手机”。
    const now = Math.floor(Date.now() / 1000);
    const history = [
      { role: "user", content: "睡着了吗", created_at: now - 900 },
      { role: "assistant", content: "没睡呢 刚看手机才看到|||啥短剧这么上头 一下就入坑了", created_at: now - 700 },
    ];
    const reply = "没睡着呀 刚没顾上看手机|||傻不拉几的 是说自己看剧看傻了呗";
    expect(avoidRepeatedAssistantReply(reply, history, "傻不拉几的", now))
      .toBe("傻不拉几的 是说自己看剧看傻了呗");
  });

  it("keeps a fresh multi-segment reply untouched", () => {
    const now = Math.floor(Date.now() / 1000);
    const history = [
      { role: "assistant", content: "刚把娃哄睡", created_at: now - 3600 },
    ];
    const reply = "今天单子多 刚忙完|||你也早点歇着呀";
    expect(avoidRepeatedAssistantReply(reply, history, "忙啥呢", now)).toBe(reply);
  });

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
