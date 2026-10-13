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
});
