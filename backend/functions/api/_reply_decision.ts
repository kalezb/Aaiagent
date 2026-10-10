export type ImmediateReplyDecision = {
  source: string;
  reason: string;
  content: string;
  replyId?: string;
  extra?: Record<string, unknown>;
};

export type ReplyDecisionStep = {
  rule: string;
  reason?: string;
  apply: (value: string) => string;
};

export type ReplyDecisionOverride = {
  rule: string;
  reason: string;
  before: string;
  after: string;
};

const AUDIT_TEXT_LIMIT = 240;

function compactAuditText(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length > AUDIT_TEXT_LIMIT ? text.slice(0, AUDIT_TEXT_LIMIT) + "…" : text;
}

export function createImmediateReplyDecision(
  source: string,
  reason: string,
  content: string,
  extra: Record<string, unknown> = {},
  replyId = "",
): ImmediateReplyDecision {
  return {
    source: String(source || "local_rule"),
    reason: String(reason || "matched_local_rule"),
    content: String(content || "").trim(),
    ...(String(replyId || "").trim() ? { replyId: String(replyId).trim() } : {}),
    extra,
  };
}

/**
 * Applies reply safety rules in one ordered place and records every rule that
 * changed the model output. Keeping this in one pipeline makes it possible to
 * distinguish "the model answered this" from "a hard-coded fallback replaced
 * the model".
 */
export function applyReplyDecisionPipeline(
  value: string,
  steps: ReplyDecisionStep[],
): { reply: string; overrides: ReplyDecisionOverride[] } {
  let current = String(value || "").trim();
  const overrides: ReplyDecisionOverride[] = [];

  for (const step of steps) {
    const before = current;
    const next = String(step.apply(current) || "").trim();
    if (next !== before) {
      overrides.push({
        rule: String(step.rule || "unnamed_rule"),
        reason: String(step.reason || "rule_modified_reply"),
        before: compactAuditText(before),
        after: compactAuditText(next),
      });
    }
    current = next;
  }

  return { reply: current, overrides };
}
