import { describe, expect, it } from "vitest";
import { handleIncidentRequest } from "../functions/api/_incident_api";

describe("incident API", () => {
  it("leaves unrelated requests for the main route", async () => {
    const response = await handleIncidentRequest({
      request: new Request("https://example.com/api/chat"),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      url: new URL("https://example.com/api/chat"),
      path: "/api/chat",
      method: "POST",
    });
    expect(response).toBeNull();
  });

  it("keeps incident details behind the dashboard password", async () => {
    const response = await handleIncidentRequest({
      request: new Request("https://example.com/api/automation-incidents"),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      url: new URL("https://example.com/api/automation-incidents"),
      path: "/api/automation-incidents",
      method: "GET",
    });
    expect(response?.status).toBe(401);
  });

  it("rejects an empty Android incident upload", async () => {
    const db = {
      prepare: () => ({
        bind: () => ({ first: async () => ({ token: "device-1" }) }),
      }),
    };
    const response = await handleIncidentRequest({
      request: new Request("https://example.com/api/automation-incidents", {
        method: "POST",
        headers: { Authorization: "Bearer device-1" },
        body: "",
      }),
      env: {
        DB: db,
        KV: { get: async () => null, delete: async () => undefined },
      },
      url: new URL("https://example.com/api/automation-incidents"),
      path: "/api/automation-incidents",
      method: "POST",
    });
    expect(response?.status).toBe(400);
  });
});
