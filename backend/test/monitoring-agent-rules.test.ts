import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import { onRequest } from "../functions/api/[[route]]";
import {
  DEFAULT_AGENT_RULES,
  LEGACY_AGENT_RULES,
} from "../functions/api/_agent_rule_inventory";
import { DEFAULT_PROGRAM_RULES } from "../functions/api/_program_rules";
import {
  MockD1,
  MockKV,
} from "./chat-test-helpers";
import { readDashboardScript } from "./dashboard-source";

describe("dashboard rules, incidents, and replay", () => {
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
});
