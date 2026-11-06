import {
  SUTANG_CONTACT_POLICY_RULE,
  SUTANG_WECHAT_REFUSAL_RULE,
} from "./_reply_policy";

export function buildSutangContactPrompt(agentRuleState: any): string {
  return [
    agentRuleState.isEnabled("sutang_contact_policy", true)
      ? agentRuleState.textFor("sutang_contact_policy", SUTANG_CONTACT_POLICY_RULE) || SUTANG_CONTACT_POLICY_RULE
      : "",
    agentRuleState.isEnabled("sutang_contact_refusal_wechat", true)
      ? agentRuleState.textFor("sutang_contact_refusal_wechat", SUTANG_WECHAT_REFUSAL_RULE) || SUTANG_WECHAT_REFUSAL_RULE
      : "",
  ].filter(Boolean).join("\n");
}
