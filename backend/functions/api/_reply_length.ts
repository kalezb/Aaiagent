export const REPLY_MAX_SEGMENTS = 3;
export const REPLY_TARGET_CHARS = 8;
export const REPLY_HARD_CHARS = 10;
export const REPLY_CLARIFY_CHARS = 15;
export const REPLY_TOTAL_CHARS = 25;
export const EMPTY_STRUCTURED_REPLY_FALLBACK = "";
const INTERNAL_DIRECTIVE = /\[\[(?:SEND_MEDIA|NO_REPLY|SELF_LEAVE)(?::[^\]]+)?\]\]/giu;
const SHORT_ACK_TEXT = /^[\p{Script=Han}A-Za-z0-9]+$/u;

export function replyLengthBudget(_incomingText) {
  return {
    maxSegments: REPLY_MAX_SEGMENTS,
    targetCharsPerSegment: REPLY_TARGET_CHARS,
    maxCharsPerSegment: REPLY_HARD_CHARS,
    maxClarifyingCharsPerSegment: REPLY_CLARIFY_CHARS,
    maxTotalChars: REPLY_TOTAL_CHARS,
  };
}

function visibleLength(value) {
  return String(value || "").replace(INTERNAL_DIRECTIVE, "").replace(/\s+/gu, "").length;
}

function cleanMessage(value) {
  return String(value || "").replace(/\r?\n+/gu, " ").trim();
}

export function isMachineCodeOrJson(value: unknown): boolean {
  const text = String(value || "").replace(INTERNAL_DIRECTIVE, "").trim();
  if (!text) return false;
  if (/```(?:json|js|ts|python|javascript|bash|sh)?|^\{/iu.test(text)) return true;
  if (/^\[\s*["\{]/u.test(text) && !text.startsWith("[[")) return true;
  if (/"(?:type|reply|content|messages|text|message|role|reasoning|finish_reason|error|status|code)"\s*:/iu.test(text)) return true;
  if (/\\"(?:type|reply|content|messages|text|message|role|reasoning|finish_reason|error|status|code)\\"\s*:/iu.test(text)) return true;
  if (/(?:function\s*\(|class\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|def\s+\w+\s*\(|import\s+.*from|export\s+(?:default|const|function)|console\.(?:log|error|warn)|return\s+[{["\d])/u.test(text)) return true;
  if (/\{[\s\r\n]*["\\]/u.test(text) || (/\}[\s\r\n]*[,;]?$/u.test(text) && /[:"]/u.test(text))) return true;
  return false;
}

function extractJson(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  if (!text) return "";
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) return text.slice(objectStart, objectEnd + 1);
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const candidate = text.slice(arrayStart, arrayEnd + 1);
    if (!candidate.startsWith("[[") && /^\[\s*["\{\]]/u.test(candidate)) return candidate;
  }
  return "";
}

export function parseStructuredReply(value) {
  const raw = String(value || "").trim();
  if (!raw) return { ok: false, source: "empty", messages: [], error: "empty" };
  const looksLikeCodeOrJson = isMachineCodeOrJson(raw);
  const jsonText = extractJson(raw);
  const isPrimaryJson = /^```/u.test(raw) || /^[\{\[]/u.test(raw) || (Boolean(jsonText) && !raw.includes("|||"));
  if (jsonText && isPrimaryJson) {
    try {
      let parsed = JSON.parse(jsonText);
      if (typeof parsed?.content === "string" && isMachineCodeOrJson(parsed.content)) {
        try {
          const inner = JSON.parse(extractJson(parsed.content) || parsed.content);
          if (inner && typeof inner === "object") parsed = inner;
        } catch {}
      }
      const c = parsed;
      const messages = Array.isArray(c) ? c : Array.isArray(c?.messages) ? c.messages : Array.isArray(c?.reply) ? c.reply : typeof c?.reply === "string" ? c.reply.split("|||") : typeof c?.message === "string" ? [c.message] : typeof c?.content === "string" ? [c.content] : typeof c?.text === "string" ? [c.text] : null;
      if (!Array.isArray(messages)) {
        return { ok: false, source: "json", messages: [], error: "messages_missing", keys: parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 12) : [] };
      }
      const cleaned = messages.map(cleanMessage).filter((msg) => Boolean(msg) && !isMachineCodeOrJson(msg));
      if (!cleaned.length) return { ok: false, source: "json", messages: [], error: "messages_empty_or_code" };
      return { ok: true, source: "json", messages: cleaned, error: "" };
    } catch {
      return { ok: false, source: "json", messages: [], error: "json_invalid" };
    }
  }
  if (looksLikeCodeOrJson && !raw.includes("|||")) {
    return { ok: false, source: "json", messages: [], error: "code_or_truncated_json" };
  }
  const legacy = raw.split(/\|\|\|/u).map(cleanMessage).filter((seg) => Boolean(seg) && !isMachineCodeOrJson(seg));
  return legacy.length ? { ok: true, source: "legacy", messages: legacy, error: "" } : { ok: false, source: "legacy", messages: [], error: "empty_or_code" };
}

function trimEdgePunct(str: string): string {
  return str.replace(/[，,;；：:\s]+([”’"）】》」』]*)$/u, "$1").trim();
}

export function splitNaturalChatBubbles(value: string, target = REPLY_TARGET_CHARS, maxCount = REPLY_MAX_SEGMENTS): string[] {
  const text = cleanMessage(value);
  if (!text) return [];
  if (visibleLength(text) <= REPLY_CLARIFY_CHARS && !/[。！？!?；;…]/u.test(text)) {
    return [trimEdgePunct(text)];
  }

  const strongRe = /.+?(?:[。！？!?；;]+[”’"）】》」』]*|…+[”’"）】》」』]*|$)/gu;
  const strongSentences = text.match(strongRe)?.map((s) => s.trim()).filter(Boolean) || [text];
  const softRe = /.+?(?:[，,;；：:\s]+|$)/gu;
  const rawChunks: string[] = [];

  for (const sentence of strongSentences) {
    if (visibleLength(sentence) <= target) {
      rawChunks.push(sentence);
      continue;
    }
    const softPieces = sentence.match(softRe)?.map((s) => s.trim()).filter(Boolean) || [sentence];
    let current = "";
    for (const piece of softPieces) {
      const isGreeting = /^(?:晚上好|早上好|下午好|你好|哈喽|早呀|晚安|嗨|在吗|哈哈)[，,！!~\s]*$/u.test(current.trim());
      if (current && (isGreeting || visibleLength(current) + visibleLength(piece) > target)) {
        rawChunks.push(current);
        current = piece;
      } else if (current) {
        current = /[，,;；：:]$/u.test(current.trim()) ? current + piece : current + " " + piece;
      } else {
        current = piece;
      }
    }
    if (current) rawChunks.push(current);
  }

  if (maxCount <= 0) return [];
  return rawChunks.map(trimEdgePunct).filter(Boolean);
}

export function capReplyLength(value, _incomingText, scope = "generic") {
  const reply = String(value || "").trim();
  if (!reply) return reply;
  if (/KaLeZiBen/iu.test(reply) && !isMachineCodeOrJson(reply)) return reply;

  const parsed = parseStructuredReply(reply);
  if (!parsed.ok) return "";

  const isLihui = scope === "lihui";
  const maxSegmentChars = isLihui ? 25 : REPLY_CLARIFY_CHARS;
  const maxSegments = isLihui ? 2 : REPLY_MAX_SEGMENTS;
  const maxTotalChars = isLihui ? 40 : REPLY_TOTAL_CHARS;

  const output: string[] = [];
  let totalChars = 0;
  for (const message of parsed.messages) {
    if (isMachineCodeOrJson(message)) continue;
    const bubbles = splitNaturalChatBubbles(message);

    for (const piece of bubbles) {
      if (isMachineCodeOrJson(piece)) continue;
      const length = visibleLength(piece);
      const naturalShortAck = length <= 2 && SHORT_ACK_TEXT.test(piece);
      if (!naturalShortAck && length < 3) return "";
      if (length > maxSegmentChars) return "";
      if (output.length >= maxSegments) return "";
      if (totalChars + length > maxTotalChars) return "";
      output.push(piece);
      totalChars += length;
    }
  }

  const safeOutput = output.filter((seg) => !isMachineCodeOrJson(seg));
  return safeOutput.join("|||");
}

export function needsReplyLengthRewrite(value: unknown, scope = "generic"): boolean {
  const reply = String(value || "").trim();
  if (!reply) return false;
  const parsed = parseStructuredReply(reply);
  if (!parsed.ok) return false;
  return !capReplyLength(reply, "", scope);
}
