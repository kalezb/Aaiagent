import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("structure size guard", () => {
  it("keeps the largest backend files from growing again", () => {
    const limits = [
      ["../functions/api/_reply_policy.ts", 2900],
      ["../functions/api/_chat_api.ts", 1820],
      ["../functions/api/_emoji_pragmatics_data.ts", 700],
      ["../functions/api/_persona_drawers_data.ts", 850],
      ["../functions/api/_agent_rule_inventory_data.ts", 750],
      ["../src/app.js", 1200],
      ["../src/index.html", 1050],
      ["../src/dashboard.css", 950],
      ["../src/dashboard-library.js", 320],
      ["../src/dashboard-rules.js", 1150],
      ["../src/dashboard-init.js", 400],
      ["chat-core.test.ts", 1200],
      ["chat-boundaries.test.ts", 1550],
      ["chat-history-reply.test.ts", 1550],
      ["monitoring-sync-core.test.ts", 500],
      ["monitoring-agent-rules.test.ts", 650],
      ["monitoring-dashboard-settings.test.ts", 650],
      ["monitoring-media-selection.test.ts", 750],
      ["monitoring-media-semantics.test.ts", 600],
      ["monitoring-media-runtime.test.ts", 400],
      ["chat-test-helpers.ts", 900],
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
    const utilsIndex = dashboardHtml.indexOf("dashboard-utils.js");
    const cssIndex = dashboardHtml.indexOf("dashboard.css");
    const appIndex = dashboardHtml.indexOf("app.js");
    const libraryIndex = dashboardHtml.indexOf("dashboard-library.js");
    const rulesIndex = dashboardHtml.indexOf("dashboard-rules.js");
    const initIndex = dashboardHtml.indexOf("dashboard-init.js");
    expect(cssIndex).toBeGreaterThan(0);
    expect(cssIndex).toBeLessThan(utilsIndex);
    expect(utilsIndex).toBeLessThan(appIndex);
    expect(appIndex).toBeLessThan(libraryIndex);
    expect(libraryIndex).toBeLessThan(rulesIndex);
    expect(rulesIndex).toBeLessThan(initIndex);
  });
});
