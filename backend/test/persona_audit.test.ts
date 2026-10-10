import { describe, expect, it } from "vitest";
import {
  auditPersonaBundle,
  detectAgentConfigConflicts,
} from "../functions/api/_persona_audit";

describe("persona audit", () => {
  it("reports a hard age conflict instead of silently trusting the prompt", () => {
    const conflicts = detectAgentConfigConflicts(
      { id: "female_sutang", system_prompt: "苏棠今年35岁，做电商运营。" },
      { fixed_age: 29, has_children: true, children_age: 5 },
      [],
    );
    expect(conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "年龄说法不一致", level: "error" }),
    ]));
  });

  it("keeps cross-persona words visible for manual review", () => {
    const audit = auditPersonaBundle(
      { id: "female_sutang", name: "苏棠", system_prompt: "我是王雅慧。" },
      { fixed_age: 29, version: 3 },
      [],
    );
    expect(audit.ok).toBe(false);
    expect(audit.issues.some((issue) => issue.source === "正文")).toBe(true);
  });
});
