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
});
