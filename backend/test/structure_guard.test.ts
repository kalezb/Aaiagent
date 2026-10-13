import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("structure size guard", () => {
  it("keeps the largest backend files from growing again", () => {
    const limits = [
      ["../functions/api/_reply_policy.ts", 3250],
      ["../functions/api/_chat_api.ts", 1850],
      ["../src/app.js", 3000],
      ["chat.test.ts", 8200],
    ] as const;

    for (const [relative, limit] of limits) {
      const source = readFileSync(new URL(relative, import.meta.url), "utf8");
      const lineCount = source.split(/\r?\n/u).length;
      expect(lineCount, `${relative} should stay at or below ${limit} lines`).toBeLessThanOrEqual(limit);
    }
  });

  it("keeps backend dependency direction clear", () => {
    const replyPolicy = readFileSync(new URL("../functions/api/_reply_policy.ts", import.meta.url), "utf8");
    const chatConfirm = readFileSync(new URL("../functions/api/_chat_confirm_api.ts", import.meta.url), "utf8");
    const dashboardHtml = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");

    expect(replyPolicy).not.toMatch(/from "\.\/(?:_chat_api|_chat_confirm_api|route)"/u);
    expect(chatConfirm).not.toMatch(/from "\.\/(?:_chat_api|route)"/u);
    expect(dashboardHtml.indexOf("dashboard-utils.js")).toBeLessThan(dashboardHtml.indexOf("app.js"));
  });
});
