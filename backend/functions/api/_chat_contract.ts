export const CHAT_CONTRACT_VERSION = 2;

const MESSAGE_KINDS = new Set([
  "text",
  "voice",
  "voice_emoji",
  "image",
  "snap",
  "sticker",
  "interaction",
  "exchange",
  "video",
  "moment_card",
  "unknown",
]);

export interface ContractChatMessage {
  role: "user" | "assistant";
  content: string;
  type: string;
  kind: string;
  transcript: string;
  transcript_status: "complete" | "missing" | "not_applicable";
  sequence: number;
  client_message_id: string;
  timestamp: string;
  created_at: number;
  timestamp_trusted: boolean;
}

function compact(value: unknown, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeKind(value: unknown) {
  const kind = compact(value, 40).toLowerCase().replace(/[\s-]+/gu, "_");
  if (kind === "photo" || kind === "picture") return "image";
  if (kind === "flash_photo" || kind === "flash") return "snap";
  return MESSAGE_KINDS.has(kind) ? kind : "unknown";
}

export function resolveTranscriptStatus(
  kind: string,
  transcript: string,
  content: string,
): ContractChatMessage["transcript_status"] {
  if (kind !== "voice") return "not_applicable";
  if (transcript.trim()) return "complete";
  if (/(?:语音转文字|转写)[：:]/u.test(content)) return "complete";
  return "missing";
}

export function normalizeContractMessages(rawMessages: unknown): ContractChatMessage[] {
  const list = Array.isArray(rawMessages) ? rawMessages : [];
  return list
    .map((raw, index) => {
      const message = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const content = compact(message.content);
      const kind = normalizeKind(message.type ?? message.kind);
      const transcript = compact(message.transcript);
      return {
        role: String(message.role || "user") === "assistant" ? "assistant" : "user",
        content,
        type: kind,
        kind,
        transcript,
        transcript_status: resolveTranscriptStatus(kind, transcript, content),
        sequence: Number.isFinite(Number(message.sequence))
          ? Math.max(0, Math.floor(Number(message.sequence)))
          : index,
        client_message_id: compact(message.client_message_id, 200),
        timestamp: compact(message.timestamp, 100),
        created_at: Number.isFinite(Number(message.created_at))
          ? Math.max(0, Math.floor(Number(message.created_at)))
          : 0,
        timestamp_trusted: message.timestamp_trusted === true,
      };
    })
    .sort((left, right) => left.sequence - right.sequence);
}

export function canonicalContractMessages(messages: ContractChatMessage[]) {
  return [...messages]
    .sort((left, right) => left.sequence - right.sequence)
    .map((message) => [
      message.sequence,
      message.role,
      message.kind,
      message.content,
      message.transcript,
      message.transcript_status,
      message.client_message_id,
      message.created_at,
    ].join("\u001f"))
    .join("\u001e");
}

export async function contractMessageDigest(messages: ContractChatMessage[]) {
  const bytes = new TextEncoder().encode(canonicalContractMessages(messages));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function buildChatContractEcho({
  requestId,
  turnId,
  inputDigest,
}: {
  requestId: string;
  turnId?: unknown;
  inputDigest?: unknown;
}) {
  return {
    schema_version: CHAT_CONTRACT_VERSION,
    turn_id: compact(turnId || requestId, 160),
    input_digest: compact(inputDigest, 128),
  };
}

export function splitContractReplyParts(value: unknown) {
  return String(value ?? "")
    .split("|||")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function buildContractSendPayload({
  reply,
  extra = {},
  contract = {},
}: {
  reply: unknown;
  extra?: Record<string, unknown>;
  contract?: Record<string, unknown>;
}) {
  const content = String(reply ?? "").trim();
  return {
    action: "send",
    reply: content,
    reply_parts: splitContractReplyParts(content),
    ...extra,
    ...contract,
  };
}
