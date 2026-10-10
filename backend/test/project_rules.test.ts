import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("project agent rules", () => {
  it("keeps the human-feel checks in AGENTS.md", () => {
    const source = readFileSync(new URL("../../AGENTS.md", import.meta.url), "utf8");

    expect(source).toContain("真人感硬检查");
    expect(source).toContain("会不会让她太被动");
    expect(source).toContain("会不会像客服");
    expect(source).toContain("该不该主动推进");
    expect(source).toContain("不能只删掉一条负面规则就算完成");
    expect(source).toContain("规则优先级");
    expect(source).toContain("安全边界和客户筛选");
    expect(source).toContain("结构化人物事实");
  });
});
