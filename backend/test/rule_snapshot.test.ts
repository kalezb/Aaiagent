import { describe, expect, it } from "vitest";
import { loadTurnRuleSnapshot } from "../functions/api/_turn_rule_snapshot";
import { MockD1, MockKV } from "./chat-test-helpers";

describe("turn rule snapshot", () => {
  it("reads the latest program rule text on the next snapshot", async () => {
    const db = new MockD1();
    const kv = new MockKV();
    await kv.put("agent:program_rules:v1", JSON.stringify({
      version: 2,
      safetyBoundary: {
        enabled: true,
        text: "这是刚刚从后台保存的新安全底线",
      },
    }));

    const snapshot = await loadTurnRuleSnapshot(db, kv, "female");

    expect(snapshot.programRules.safetyBoundary.text).toContain("刚刚从后台保存");
  });

  it("drops a deleted agent rule on the next snapshot", async () => {
    const db = new MockD1();
    const kv = new MockKV();
    const before = await loadTurnRuleSnapshot(db, kv, "female");
    const rule = before.agentRuleState.rules.find(
      (item: any) => item.legacy_rule_id === "no_repeat",
    );
    expect(rule).toBeTruthy();

    db.agentRuleRows.set(rule.id, {
      ...rule,
      enabled: 0,
      deleted_at: Math.floor(Date.now() / 1000),
    });

    const after = await loadTurnRuleSnapshot(db, kv, "female");
    expect(after.agentRuleState.isEnabled("no_repeat", true)).toBe(false);
  });

  it("reads the latest knowledge cards on the next snapshot", async () => {
    const db = new MockD1();
    const kv = new MockKV();
    await kv.put("persona:drawers:female_sutang", JSON.stringify({
      custom: [{
        id: "custom_snapshot_card",
        name: "刚加的知识卡",
        content: "这条内容应该马上出现在下一轮规则快照里",
        keywords: ["快照测试"],
      }],
    }));

    const snapshot = await loadTurnRuleSnapshot(db, kv, "female_sutang");

    expect(snapshot.drawers.custom.some(
      (item: any) => item.id === "custom_snapshot_card",
    )).toBe(true);
  });
});
