import { describe, expect, it, vi } from "vitest";
import { handleAdminCrudRequest } from "../functions/api/_admin_crud_api";

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

describe("admin CRUD API", () => {
  it("leaves unrelated requests for the main route", async () => {
    const response = await handleAdminCrudRequest({
      request: request("/api/chat", "POST", {}),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      url: new URL("https://example.com/api/chat"),
      path: "/api/chat",
      method: "POST",
    });
    expect(response).toBeNull();
  });

  it("keeps persona metadata behind dashboard login when prompts are requested", async () => {
    const response = await handleAdminCrudRequest({
      request: new Request("https://example.com/api/persona?include_prompt=1"),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      url: new URL("https://example.com/api/persona?include_prompt=1"),
      path: "/api/persona",
      method: "GET",
    });
    expect(response?.status).toBe(401);
  });

  it("saves model config without hitting an undeclared cache variable", async () => {
    const put = vi.fn(async () => undefined);
    const response = await handleAdminCrudRequest({
      request: request("/api/config", "PUT", { temperature: 0.7 }),
      env: {
        DASHBOARD_PASSWORD: "dashboard-secret",
        KV: { put },
      },
      url: new URL("https://example.com/api/config"),
      path: "/api/config",
      method: "PUT",
    });

    expect(response?.status).toBe(200);
    expect(put).toHaveBeenCalledWith("llm:temperature", "0.7");
  });
});
