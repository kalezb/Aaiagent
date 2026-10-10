import { describe, expect, it } from "vitest";
import { handleProgramRulesRequest } from "../functions/api/_program_rules_api";

function request(path: string, body?: unknown) {
  return new Request("https://example.com" + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dashboard-Password": "dashboard-secret",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("program rules API", () => {
  it("leaves unrelated requests for the main route", async () => {
    const response = await handleProgramRulesRequest({
      request: request("/api/chat", {}),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      path: "/api/chat",
      method: "POST",
    });
    expect(response).toBeNull();
  });

  it("tests the supplied rules without saving them", async () => {
    const response = await handleProgramRulesRequest({
      request: request("/api/program-rules/test", {
        content: "平台提示：对方正在输入",
        rules: {
          sticker: {
            enabled: true,
            meanings: { "月亮": "晚安" },
            instruction: "",
          },
        },
      }),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      path: "/api/program-rules/test",
      method: "POST",
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      platform_notice: true,
    });
  });

  it("keeps rule testing behind the dashboard password", async () => {
    const response = await handleProgramRulesRequest({
      request: new Request("https://example.com/api/program-rules/test", {
        method: "POST",
        body: JSON.stringify({ content: "你好" }),
      }),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      path: "/api/program-rules/test",
      method: "POST",
    });
    expect(response?.status).toBe(401);
  });
});
