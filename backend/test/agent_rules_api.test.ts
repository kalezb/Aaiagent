import { describe, expect, it } from "vitest";
import { handleAgentRulesRequest } from "../functions/api/_agent_rules_api";

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
});
