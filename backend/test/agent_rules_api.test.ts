import { describe, expect, it } from "vitest";
import { handleAgentRulesRequest } from "../functions/api/_agent_rules_api";
import { MockD1, MockKV } from "./chat-test-helpers";

function request(path: string, method: string, body?: unknown) {
  return new Request("https://example.com" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Dashboard-Password": "dashboard-secret",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("agent rules API", () => {
  it("leaves unrelated requests for the main route", async () => {
    const response = await handleAgentRulesRequest({
      request: request("/api/chat", "POST", {}),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      path: "/api/chat",
      method: "POST",
    });
    expect(response).toBeNull();
  });

  it("keeps the rule library behind the dashboard password", async () => {
    const response = await handleAgentRulesRequest({
      request: new Request("https://example.com/api/agent-rules"),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      path: "/api/agent-rules",
      method: "GET",
    });
    expect(response?.status).toBe(401);
  });

  it("rejects a delete without a rule id", async () => {
    const response = await handleAgentRulesRequest({
      request: request("/api/agent-rules", "DELETE", {}),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      path: "/api/agent-rules",
      method: "DELETE",
    });
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({ error: "缺少 id" });
  });

  it("marks edited defaults as user-visible rules on the next dashboard load", async () => {
    const db = new MockD1();
    const env = { DB: db, KV: {} as never, DASHBOARD_PASSWORD: "dashboard-secret" };
    const listed = await handleAgentRulesRequest({
      request: request("/api/agent-rules", "GET"),
      env,
      path: "/api/agent-rules",
      method: "GET",
    });
    const rules = (await listed!.json()).rules;
    const target = rules.find((item: any) => item.legacy_rule_id === "question_pacing");
    expect(target.visible_by_default).toBe(false);

    const updated = await handleAgentRulesRequest({
      request: request("/api/agent-rules", "PUT", {
        id: target.id,
        detail: "用户改过的提问节奏",
      }),
      env,
      path: "/api/agent-rules",
      method: "PUT",
    });
    expect(updated?.status).toBe(200);
    expect(db.agentRuleRows.get(target.id)?.source).toBe("dashboard");
  });

  it("removes retired Su Tang cards from stored dashboard data", async () => {
    const db = new MockD1();
    const kv = new MockKV();
    await kv.put("persona:drawers:female_sutang", JSON.stringify({
      topics: [
        {
          id: "scene_18_meeting_arrangement",
          name: "旧见面卡",
          keywords: ["酒店"],
          content: "第一次就白天找个公开地方",
          enabled: true,
        },
      ],
      custom: [],
    }));
    const env = { DB: db, KV: kv, DASHBOARD_PASSWORD: "dashboard-secret" };
    const listed = await handleAgentRulesRequest({
      request: request("/api/agent-rules", "GET"),
      env,
      path: "/api/agent-rules",
      method: "GET",
    });
    const body = await listed!.json();
    const stored = await kv.get("persona:drawers:female_sutang", "json");

    expect(body.sutang_health.summary).toMatchObject({
      retired_cards_total: 40,
      retired_cards_removed: 40,
    });
    expect(stored.topics.some((card: any) => card.id === "scene_18_meeting_arrangement")).toBe(false);
  });
});
