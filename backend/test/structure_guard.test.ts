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
});
