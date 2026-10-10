import { describe, expect, it } from "vitest";
import { handlePersonaManagementRequest } from "../functions/api/_persona_management_api";

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

describe("persona management API", () => {
  it("leaves unrelated requests for the main route", async () => {
    const response = await handlePersonaManagementRequest({
      request: request("/api/chat", "POST", {}),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      url: new URL("https://example.com/api/chat"),
      path: "/api/chat",
      method: "POST",
    });
    expect(response).toBeNull();
  });

  it("keeps persona publishing behind the dashboard password", async () => {
    const response = await handlePersonaManagementRequest({
      request: new Request("https://example.com/api/persona/publish", {
        method: "POST",
      }),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      url: new URL("https://example.com/api/persona/publish"),
      path: "/api/persona/publish",
      method: "POST",
    });
    expect(response?.status).toBe(401);
  });

  it("reports when the protected rule preview is not configured", async () => {
    const response = await handlePersonaManagementRequest({
      request: request("/api/rule-preview", "POST", {}),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      url: new URL("https://example.com/api/rule-preview"),
      path: "/api/rule-preview",
      method: "POST",
    });
    expect(response?.status).toBe(503);
  });
});
