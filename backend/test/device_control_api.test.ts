import { describe, expect, it } from "vitest";
import { handleDeviceControlRequest } from "../functions/api/_device_control_api";

describe("device control API", () => {
  it("leaves unrelated requests for the main route", async () => {
    const response = await handleDeviceControlRequest({
      request: new Request("https://example.com/api/chat"),
      env: {},
      url: new URL("https://example.com/api/chat"),
      path: "/api/chat",
      method: "POST",
    });
    expect(response).toBeNull();
  });

  it("keeps device settings behind the dashboard password", async () => {
    const response = await handleDeviceControlRequest({
      request: new Request("https://example.com/api/hosting-config?token=device-1"),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      url: new URL("https://example.com/api/hosting-config?token=device-1"),
      path: "/api/hosting-config",
      method: "GET",
    });
    expect(response?.status).toBe(401);
  });

  it("rejects an invalid model line before touching storage", async () => {
    const response = await handleDeviceControlRequest({
      request: new Request("https://example.com/api/model-route", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Password": "dashboard-secret",
        },
        body: JSON.stringify({ token: "device-1", line: "c" }),
      }),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      url: new URL("https://example.com/api/model-route"),
      path: "/api/model-route",
      method: "PUT",
    });
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({ error: "line 无效" });
  });
});
