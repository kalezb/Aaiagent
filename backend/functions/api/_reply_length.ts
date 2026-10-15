export const REPLY_MAX_SEGMENTS = 3;
export const REPLY_TARGET_CHARS = 20;
export const REPLY_HARD_CHARS = 25;
export const REPLY_TOTAL_CHARS = 60;
export const EMPTY_STRUCTURED_REPLY_FALLBACK = "嗯 你接着说";
const INTERNAL_DIRECTIVE = /\[\[(?:SEND_MEDIA|NO_REPLY|SELF_LEAVE)(?::[^\]]+)?\]\]/giu;

export function replyLengthBudget(_incomingText) {
  return {
    maxSegments: REPLY_MAX_SEGMENTS,
    targetCharsPerSegment: REPLY_TARGET_CHARS,
    maxCharsPerSegment: REPLY_HARD_CHARS,
    maxTotalChars: REPLY_TOTAL_CHARS,
  };
}

function visibleLength(value) {
  return String(value || "")
    .replace(INTERNAL_DIRECTIVE, "")
    .replace(/\s+/gu, "")
    .length;
}

function cleanMessage(value) {
  return String(value || "").replace(/\r?\n+/gu, " ").trim();
}

function extractJson(value) {
  const text = String(value || "").trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
  if (!text) return "";
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) return text.slice(objectStart, objectEnd + 1);
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) return text.slice(arrayStart, arrayEnd + 1);
  return "";
}

export function parseStructuredReply(value) {
  const raw = String(value || "").trim();
  if (!raw) return { ok: false, source: "empty", messages: [], error: "empty" };

  const jsonText = extractJson(raw);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      const messages = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.messages)
          ? parsed.messages
          : Array.isArray(parsed?.reply)
            ? parsed.reply
            : typeof parsed?.reply === "string"
              ? parsed.reply.split("|||")
              : typeof parsed?.message === "string"
                ? [parsed.message]
                : typeof parsed?.content === "string"
                  ? [parsed.content]
                  : typeof parsed?.text === "string"
                    ? [parsed.text]
                    : null;
      if (!Array.isArray(messages)) {
        return {
          ok: false,
          source: "json",
          messages: [],
          error: "messages_missing",
          keys: parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 12) : [],
        };
      }
      const cleaned = messages.map(cleanMessage).filter(Boolean);
      if (!cleaned.length) {
        return { ok: false, source: "json", messages: [], error: "messages_empty" };
      }
      return { ok: true, source: "json", messages: cleaned, error: "" };
    } catch {
      if (/^[\{\[]/u.test(raw) && raw.includes("\"messages\"")) {
        return { ok: false, source: "json", messages: [], error: "json_invalid" };
      }
    }
  }

  // 旧模型没有按新格式返回时，只承认它明确写出的分隔，不在文字里继续猜。
  const legacy = raw.split(/\|\|\|/u).map(cleanMessage).filter(Boolean);
  return legacy.length
    ? { ok: true, source: "legacy", messages: legacy, error: "" }
    : { ok: false, source: "legacy", messages: [], error: "empty" };
}

function splitOnlyAtCompleteSentences(value) {
  const text = cleanMessage(value);
  if (visibleLength(text) <= REPLY_HARD_CHARS) return [text];
  const parts = text
    .split(/(?<=[。！？!?；;…])\s*/u)
    .map(cleanMessage)
    .filter(Boolean);
  return parts.length > 1 ? parts : [text];
}

/**
 * 结构化输出只做格式和长度验收：
 * 1. 只认模型返回的 messages 数组，旧格式只认 ||| 和换行；
 * 2. 不再按字数、逗号、空格或某个字从句子中间切开；
 * 3. 超长兜底只在句号、问号等完整停顿处分开；
 * 4. 完整句子优先保留；只有实在无法整理时才用兜底。
 */
export function capReplyLength(value, _incomingText) {
  const reply = String(value || "").trim();
  if (!reply) return reply;
  if (/sutang2026/iu.test(reply)) return reply;

  const parsed = parseStructuredReply(reply);
  if (!parsed.ok) return EMPTY_STRUCTURED_REPLY_FALLBACK;

  const output = [];
  let totalChars = 0;
  for (const message of parsed.messages) {
    for (const piece of splitOnlyAtCompleteSentences(message)) {
      const length = visibleLength(piece);
      if (output.length >= REPLY_MAX_SEGMENTS) break;
      if (output.length > 0 && totalChars + length > REPLY_TOTAL_CHARS) break;
      output.push(piece);
      totalChars += length;
    }
    if (output.length >= REPLY_MAX_SEGMENTS || totalChars >= REPLY_TOTAL_CHARS) break;
  }

  return output.length ? output.join("|||") : EMPTY_STRUCTURED_REPLY_FALLBACK;
}
