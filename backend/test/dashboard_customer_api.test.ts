import { describe, expect, it } from "vitest";
import { handleDashboardCustomerRequest } from "../functions/api/_dashboard_customer_api";

describe("dashboard customer API", () => {
  it("leaves unrelated requests for the main route", async () => {
    const response = await handleDashboardCustomerRequest({
      request: new Request("https://example.com/api/chat"),
      env: {},
      url: new URL("https://example.com/api/chat"),
      path: "/api/chat",
      method: "POST",
    });
    expect(response).toBeNull();
  });

  it("keeps customer history behind the dashboard password", async () => {
    const response = await handleDashboardCustomerRequest({
      request: new Request("https://example.com/api/chat/history"),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      url: new URL("https://example.com/api/chat/history"),
      path: "/api/chat/history",
      method: "GET",
    });
    expect(response?.status).toBe(401);
  });

  it("rejects an incomplete customer bind", async () => {
    const response = await handleDashboardCustomerRequest({
      request: new Request("https://example.com/api/customer-groups/bind", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Password": "dashboard-secret",
        },
        body: JSON.stringify({ token: "device-1", display_name: "", contacts: [] }),
      }),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      url: new URL("https://example.com/api/customer-groups/bind"),
      path: "/api/customer-groups/bind",
      method: "POST",
    });
    expect(response?.status).toBe(400);
  });

  it("rejects unauthorized profile updates", async () => {
    const response = await handleDashboardCustomerRequest({
      request: new Request("https://example.com/api/customer-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "t1", group_id: "g1", profile: {} }),
      }),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      url: new URL("https://example.com/api/customer-profile"),
      path: "/api/customer-profile",
      method: "POST",
    });
    expect(response?.status).toBe(401);
  });

  it("rejects incomplete customer profile update parameters", async () => {
    const response = await handleDashboardCustomerRequest({
      request: new Request("https://example.com/api/customer-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Password": "dashboard-secret",
        },
        body: JSON.stringify({ token: "", group_id: "" }),
      }),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      url: new URL("https://example.com/api/customer-profile"),
      path: "/api/customer-profile",
      method: "POST",
    });
    expect(response?.status).toBe(400);
  });

  it("enriches customer groups with generosity_status from profiles", async () => {
    const mockDb = {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          all: async () => {
            if (sql.includes("FROM contacts")) return { results: [{ token: "t1", platform: "soul", contact_id: "c1", contact_name: "大方哥" }] };
            if (sql.includes("FROM contact_links")) return { results: [{ token: "t1", platform: "soul", contact_id: "c1", contact_name: "大方哥", group_id: "group:1" }] };
            if (sql.includes("FROM chat_history")) return { results: [] };
            if (sql.includes("FROM customer_groups")) {
              return {
                results: [
                  { id: "group:1", token: "t1", display_name: "大方哥", notes: "", priority_reply: 0 },
                ],
              };
            }
            if (sql.includes("FROM customer_profiles")) {
              return {
                results: [
                  {
                    group_id: "group:1",
                    profile_json: JSON.stringify({ relationship: { generosity_status: "qualified" } }),
                  },
                ],
              };
            }
            return { results: [] };
          },
        }),
        all: async () => ({ results: [] }),
      }),
    };
    const response = await handleDashboardCustomerRequest({
      request: new Request("https://example.com/api/customer-groups?token=t1", {
        headers: { "X-Dashboard-Password": "dashboard-secret" },
      }),
      env: { DB: mockDb, DASHBOARD_PASSWORD: "dashboard-secret" },
      url: new URL("https://example.com/api/customer-groups?token=t1"),
      path: "/api/customer-groups",
      method: "GET",
    });
    expect(response?.status).toBe(200);
    const body = await response?.json();
    expect(body?.groups?.[0]?.generosity_status).toBe("qualified");
  });

  it("handles toggling blacklist for a customer group", async () => {
    let insertedWhitelisted = -1;
    const mockDb = {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          first: async () => {
            if (sql.includes("FROM customer_groups")) {
              return { id: "group:1", token: "t1", display_name: "黑名单候选人", notes: "", priority_reply: 0 };
            }
            if (sql.includes("FROM contacts")) {
              return { contact_name: "黑名单候选人", is_whitelisted: insertedWhitelisted === -1 ? 1 : insertedWhitelisted };
            }
            return null;
          },
          all: async () => {
            if (sql.includes("FROM contact_links")) {
              return { results: [{ platform: "soul", contact_id: "c1", contact_name: "黑名单候选人" }] };
            }
            return { results: [] };
          },
          run: async () => {
            if (sql.includes("INSERT INTO contacts")) {
              insertedWhitelisted = args[4];
            }
            return { success: true };
          },
        }),
      }),
    };
    const response = await handleDashboardCustomerRequest({
      request: new Request("https://example.com/api/customer-groups/blacklist", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Password": "dashboard-secret",
        },
        body: JSON.stringify({ token: "t1", group_id: "group:1", blacklisted: true }),
      }),
      env: { DB: mockDb, DASHBOARD_PASSWORD: "dashboard-secret" },
      url: new URL("https://example.com/api/customer-groups/blacklist"),
      path: "/api/customer-groups/blacklist",
      method: "PUT",
    });
    expect(response?.status).toBe(200);
    const body = await response?.json();
    expect(body?.success).toBe(true);
    expect(body?.blacklisted).toBe(true);
    expect(insertedWhitelisted).toBe(0);
  });

  it("includes contact_blacklist in GET /api/config", async () => {
    const mockDb = {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => ({
          first: async () => {
            if (sql.includes("FROM tokens")) return { token: "t1", active_persona_id: "female" };
            if (sql.includes("FROM personas")) return { id: "female", name: "苏棠" };
            return null;
          },
          all: async () => {
            if (sql.includes("FROM contacts") && sql.includes("is_whitelisted = 0")) {
              return {
                results: [
                  { contact_name: "张三", contact_id: "soul-123", display_name: "张三" },
                  { contact_name: "", contact_id: "qq-456", display_name: "李四" },
                ],
              };
            }
            return { results: [] };
          },
        }),
        first: async () => null,
      }),
      KV: { get: async () => "deepseek" },
    };
    const response = await handleDashboardCustomerRequest({
      request: new Request("https://example.com/api/config", {
        headers: { Authorization: "Bearer t1" },
      }),
      env: { DB: mockDb, KV: mockDb.KV },
      url: new URL("https://example.com/api/config"),
      path: "/api/config",
      method: "GET",
    });
    expect(response?.status).toBe(200);
    const body = await response?.json();
    expect(body?.contact_blacklist).toContain("张三");
    expect(body?.contact_blacklist).toContain("李四");
  });
});

