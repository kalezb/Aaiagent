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

  it("allows setting monthly_limit to -1 for unlimited quota", async () => {
    let executedSql = "";
    let boundParams: any[] = [];
    const db = {
      prepare(sql: string) {
        executedSql = sql;
        return {
          bind(...params: any[]) {
            boundParams = params;
            return {
              run: async () => ({ success: true }),
            };
          },
        };
      },
    };

    const response = await handleAdminCrudRequest({
      request: request("/api/token", "PUT", {
        token: "mykey_test_token_123",
        monthly_limit: -1,
      }),
      env: {
        DASHBOARD_PASSWORD: "dashboard-secret",
        DB: db,
      },
      url: new URL("https://example.com/api/token"),
      path: "/api/token",
      method: "PUT",
    });

    expect(response?.status).toBe(200);
    expect(executedSql).toContain("monthly_limit = ?");
    expect(boundParams).toEqual([-1, "mykey_test_token_123"]);
  });

  it("allows resetting spent quota to zero", async () => {
    let executedSql = "";
    let boundParams: any[] = [];
    const db = {
      prepare(sql: string) {
        executedSql = sql;
        return {
          bind(...params: any[]) {
            boundParams = params;
            return {
              run: async () => ({ success: true }),
            };
          },
        };
      },
    };

    const response = await handleAdminCrudRequest({
      request: request("/api/token", "PUT", {
        token: "mykey_test_token_123",
        reset_spent: true,
      }),
      env: {
        DASHBOARD_PASSWORD: "dashboard-secret",
        DB: db,
      },
      url: new URL("https://example.com/api/token"),
      path: "/api/token",
      method: "PUT",
    });

    expect(response?.status).toBe(200);
    expect(executedSql).toContain("spent = 0");
    expect(boundParams).toEqual(["mykey_test_token_123"]);
  });

  it("rejects invalid monthly_limit values like -2", async () => {
    const response = await handleAdminCrudRequest({
      request: request("/api/token", "PUT", {
        token: "mykey_test_token_123",
        monthly_limit: -2,
      }),
      env: {
        DASHBOARD_PASSWORD: "dashboard-secret",
      },
      url: new URL("https://example.com/api/token"),
      path: "/api/token",
      method: "PUT",
    });

    expect(response?.status).toBe(400);
    const body = await response?.json();
    expect(body.error).toBe("月度上限无效");
  });
});
