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
});
