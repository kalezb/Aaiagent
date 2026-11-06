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

  it("blocks active Su Tang rules that still contain old persona settings", () => {
    const audit = auditPersonaBundle(
      {
        id: "female_sutang",
        name: "苏棠",
        system_prompt: "苏棠29岁，已婚，和婆婆、3岁女儿住两江新区，在家带娃。",
      },
      { fixed_age: 29, has_children: true, children_age: 3, version: 17 },
      [],
      [{
        id: "legacy_old_rule",
        legacy_rule_id: "old_rule",
        title: "旧苏棠规则",
        detail: "第一次见面要求男方承担房费，按酒店选址推进。",
        enabled: true,
        deleted_at: 0,
      }],
    );
    expect(audit.ok).toBe(false);
    expect(audit.issues.some((issue) => issue.source.includes("规则"))).toBe(true);
  });

  it("blocks stale old knowledge cards even when they are still in the card list", () => {
    const audit = auditPersonaBundle(
      {
        id: "female_sutang",
        name: "苏棠",
        system_prompt: "苏棠29岁，已婚，和婆婆、3岁女儿住两江新区，在家带娃。",
      },
      { fixed_age: 29, has_children: true, children_age: 3, version: 17 },
      [{
        id: "scene_28_body_massage_spa",
        name: "旧卡",
        content: "做电商天天盯电脑，周末去做精油开背。",
        keywords: ["按摩"],
        enabled: false,
      }],
    );
    expect(audit.ok).toBe(false);
    expect(audit.issues.some((issue) => issue.source.includes("知识卡"))).toBe(true);
  });
});
