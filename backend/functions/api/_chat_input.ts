import {
  isPlatformNoticeContent,
  isUntranscribedVoiceMessage,
  type ProgramRulesConfig,
} from "./_program_rules";

export const SUPPORTED_PLATFORMS = ["soul", "qq", "immomo", "lianxin"];

export function normalizePlatform(value, fallback = "") {
  const platform = String(value || "").trim().toLowerCase();
  return SUPPORTED_PLATFORMS.includes(platform) ? platform : fallback;
}

export function normalizeHostingMode(value) {
  const mode = String(value || "").trim().toLowerCase().replace(/-/g, "_");
  return ["full_auto", "semi_auto", "monitor_only"].includes(mode) ? mode : "monitor_only";
}

export function validateChatMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 40) return false;
  let totalChars = 0;
  for (const message of messages) {
    const role = String(message?.role || "");
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    if (!["user", "assistant"].includes(role) || !content || content.length > 4000) return false;
    totalChars += content.length;
  }
  return totalChars <= 24_000;
}

export interface NormalizedChatRequest {
  platform: string;
  contactId: string;
  contactName: string;
  location: unknown;
  rawMessages: unknown[];
  selfNickname: string;
  hostingMode: string;
  conversationTimeline: string;
  conversationStage: string;
  relationshipOrigin: string;
  requestId: string;
}

const CONVERSATION_STAGES = ["first_contact", "continuing", "familiar", "soulmate", "unknown"];
const RELATIONSHIP_ORIGINS = ["match", "serendipity", "soulmate", "unknown"];

function normalizeConversationStage(value) {
  const stage = String(value || "").trim().toLowerCase();
  return CONVERSATION_STAGES.includes(stage) ? stage : "unknown";
}

function normalizeRelationshipOrigin(value) {
  const origin = String(value || "").trim().toLowerCase();
  return RELATIONSHIP_ORIGINS.includes(origin) ? origin : "unknown";
}

export function normalizeChatRequest(body: Record<string, any>): NormalizedChatRequest {
  return {
    platform: normalizePlatform(body.platform),
    contactId: String(body.contact_id || "").trim().slice(0, 200),
    contactName: String(body.contact_name || "").trim().slice(0, 200),
    location: body.location,
    rawMessages: body.messages,
    selfNickname: String(body.self_nickname || "")
      .replace(/[\r\n]+/gu, " ")
      .trim()
      .slice(0, 80),
    hostingMode: normalizeHostingMode(body.hosting_mode),
    conversationTimeline: String(body.conversation_timeline || "").trim().slice(0, 2400),
    conversationStage: normalizeConversationStage(body.conversation_stage),
    relationshipOrigin: normalizeRelationshipOrigin(body.relationship_origin),
    requestId: String(body.request_id || "").trim().slice(0, 120) || crypto.randomUUID(),
  };
}

export type PreparedChatInput =
  | { kind: "ready"; messages: unknown[] }
  | { kind: "skip"; reason: string }
  | { kind: "fixed_reply"; reason: string; reply: string };

export function prepareChatInput(
  rawMessages: unknown[],
  programRules: ProgramRulesConfig,
): PreparedChatInput {
  const messages = rawMessages.filter((message) =>
    !(
      (message as any)?.role === "user" &&
      isPlatformNoticeContent((message as any)?.content, programRules)
    )
  );
  if (!messages.length) return { kind: "skip", reason: "platform_notice" };

  const last = messages[messages.length - 1] as any;
  if (last?.role !== "user") return { kind: "skip", reason: "last_message_from_self" };

  if (programRules.untranscribedVoice.enabled && isUntranscribedVoiceMessage(last)) {
    if (programRules.untranscribedVoice.mode === "ignore") {
      return { kind: "skip", reason: "untranscribed_voice_ignored" };
    }
    if (
      programRules.untranscribedVoice.mode === "fixed_reply" &&
      programRules.untranscribedVoice.fixedReply
    ) {
      return {
        kind: "fixed_reply",
        reason: "untranscribed_voice_fixed",
        reply: programRules.untranscribedVoice.fixedReply,
      };
    }
  }

  return { kind: "ready", messages };
}
