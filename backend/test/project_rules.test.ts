import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("project agent rules", () => {
  it("keeps core agent discipline in AGENTS.md", () => {
    const source = readFileSync(new URL("../../AGENTS.md", import.meta.url), "utf8");

    expect(source).toContain("后台看板拥有最高权力");
    expect(source).toContain("后台看板里的所有规则优先级绝对最高");
    expect(source).toContain("下一条聊天必须立即生效");
    expect(source).toContain("动手前必须先查影响");
    expect(source).toContain("一律用大白话讲");
    expect(source).toContain("测试必须全过");
    expect(source).toContain("每次改动必须留记录");
  });
});
