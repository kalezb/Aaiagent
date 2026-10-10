import {
  capReplyLength,
  loadOrCreatePendingReply,
  normalizeAssistantReplyPresentation,
} from "./_reply_policy";
import { sanitizeAssistantReply } from "./_assistant_output";
import type { ImmediateReplyDecision } from "./_reply_decision";
import { json } from "./_http_runtime";

export async function respondWithImmediateReply({
  env,
  tokenRow,
  requestId,
  platform,
  contactId,
  contactName,
  decision,
  personaId,
  personaVersion,
  personaScope = "generic",
  incomingText = "",
  skipLengthCap = false,
  skipPresentation = false,
}: {
  env: any;
  tokenRow: any;
  requestId: string;
  platform: string;
  contactId: string;
  contactName: string;
  decision: ImmediateReplyDecision;
  personaId?: string;
  personaVersion?: number;
  personaScope?: string;
  incomingText?: string;
  skipLengthCap?: boolean;
  skipPresentation?: boolean;
}) {
  const rawContent = String(decision.content || "").trim();
  const sutang = String(personaScope || "") === "sutang";
  const sanitized = sanitizeAssistantReply(rawContent, { allowMeetingReward: sutang });
  const presented = skipPresentation
    ? sanitized
    : normalizeAssistantReplyPresentation(sanitized, { softParticles: sutang });
  const content = (skipLengthCap ? presented : capReplyLength(presented, incomingText)).trim() || rawContent;
  if (!content) return null;
  const activePersonaId = String(personaId || tokenRow.active_persona_id || "female");
  const activePersonaVersion = Number(personaVersion || 0);
  const existingReplyId = String(decision.replyId || "").trim();
  if (existingReplyId) {
    console.log("reply_decision_audit", JSON.stringify({
      request_id: requestId,
      token: String(tokenRow.token || "").slice(-6),
      platform,
      source: decision.source,
      reason: decision.reason,
      reply_id: existingReplyId,
    }));
    return json({
      action: "send",
      reply: content,
      reply_id: existingReplyId,
      status: "pending",
      local: true,
      request_id: requestId,
      persona_id: activePersonaId,
      persona_version: activePersonaVersion,
      reply_audit: {
        source: decision.source,
        reason: decision.reason,
        overrides: [],
      },
      ...(decision.extra || {}),
    });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const pending = await loadOrCreatePendingReply(env.DB, {
    token: tokenRow.token,
    requestId,
    platform,
    contactId,
    contactName,
    content,
    createdAt: nowSec,
    personaId: activePersonaId,
    personaVersion: activePersonaVersion,
  });
  await env.DB.prepare("UPDATE tokens SET last_used_at = ? WHERE token = ?")
    .bind(nowSec, tokenRow.token).run();
  const replyAudit = {
    source: decision.source,
    reason: decision.reason,
    overrides: [],
  };
  console.log("reply_decision_audit", JSON.stringify({
    request_id: requestId,
    persona_id: activePersonaId,
    persona_version: activePersonaVersion,
    token: String(tokenRow.token || "").slice(-6),
    platform,
    source: decision.source,
    reason: decision.reason,
  }));
  return json({
    action: "send",
    reply: pending.content,
    reply_id: pending.id,
    status: "pending",
    local: true,
    request_id: requestId,
    persona_id: activePersonaId,
    persona_version: activePersonaVersion,
    reply_audit: replyAudit,
    ...(decision.extra || {}),
  });
}
