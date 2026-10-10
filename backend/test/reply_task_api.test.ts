import { describe, expect, it } from "vitest";
import { handleReplyTaskRequest } from "../functions/api/_reply_task_api";

describe("reply task API", () => {
  it("leaves unrelated requests for the main route", async () => {
    const response = await handleReplyTaskRequest({
      request: new Request("https://example.com/api/chat"),
      env: {},
      url: new URL("https://example.com/api/chat"),
      path: "/api/chat",
      method: "POST",
    });
    expect(response).toBeNull();
  });

  it("keeps dashboard manual messages behind the dashboard password", async () => {
    const response = await handleReplyTaskRequest({
      request: new Request("https://example.com/api/manual-replies", { method: "POST" }),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      url: new URL("https://example.com/api/manual-replies"),
      path: "/api/manual-replies",
      method: "POST",
    });
    expect(response?.status).toBe(401);
  });

  it("rejects an unsupported platform before querying tasks", async () => {
    const db = {
      prepare: () => ({
        bind: () => ({ first: async () => ({ token: "device-1" }) }),
      }),
    };
    const response = await handleReplyTaskRequest({
      request: new Request("https://example.com/api/reply-tasks/next?platform=bad", {
        headers: { Authorization: "Bearer device-1" },
      }),
      env: { DB: db },
      url: new URL("https://example.com/api/reply-tasks/next?platform=bad"),
      path: "/api/reply-tasks/next",
      method: "GET",
    });
    expect(response?.status).toBe(400);
  });
});
