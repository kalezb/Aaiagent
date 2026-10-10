import { describe, expect, it } from "vitest";
import type { ActiveAgentRule } from "../functions/api/_agent_rule_contract";
import { translateAgentRuleText } from "../functions/api/_agent_rule_translate";

function rule(id: string, title = id): ActiveAgentRule {
  return {
    id: `db-${id}`,
    legacy_rule_id: id,
    persona_id: "",
    title,
    detail: `${title}内容`,
    gate: "execution",
    priority: 80,
    enabled: true,
    sort_order: 1,
    source: "test",
  };
}

describe("plain-language agent rule translation", () => {
  it("turns married-do-not-reply into the existing hard action", () => {
    const result = translateAgentRuleText(
      "已婚的人不要回，只对苏棠生效",
      [rule("married_excluded", "已婚的人不回")],
    );

    expect(result.mode).toBe("existing_rule");
    expect(result.legacy_rule_id).toBe("married_excluded");
    expect(result.rule_id).toBe("db-married_excluded");
    expect(result.patch).toMatchObject({ enabled: true, persona_id: "female_sutang" });
    expect(result.preview).toContain("系统直接跳过");
  });

  it("turns no-contact-disclosure into the existing hard action", () => {
    const result = translateAgentRuleText(
      "不能把微信和手机号给客户",
      [rule("no_contact_leak", "不给联系方式")],
    );

    expect(result.mode).toBe("existing_rule");
    expect(result.legacy_rule_id).toBe("no_contact_leak");
  });

  it("keeps unsupported free text as a prompt rule instead of faking code", () => {
    const result = translateAgentRuleText(
      "说话的时候多一点生活气息",
      [rule("no_customer_service", "不要客服腔")],
    );

    expect(result.mode).toBe("prompt_rule");
    expect(result.prompt_rule?.detail).toContain("生活气息");
    expect(result.note).toContain("不会自动变成系统硬动作");
  });

  it("does not guess which contact should be blacklisted", () => {
    const result = translateAgentRuleText("把这个人拉黑", []);

    expect(result.mode).toBe("manual_contact_action");
    expect(result.preview).toContain("先选中具体客户");
  });
});
