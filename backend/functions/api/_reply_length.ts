/**
 * 回复段数只由模型已经给出的分隔决定，正常情况下 1~3 条自然短句。
 *
 * 2026-10-15 用户纠正：禁止按字数、逗号、空格或某个字把完整句子从中间切开，
 * 也禁止把碎片重新用空格拼成一句。这里保留最多三条的硬上限，超出只丢掉整段，
 * 绝不改变已有段的内部文字。
 */
export function replyLengthBudget(_incomingText) {
  return { maxSegments: 3, maxCharsPerSegment: Number.POSITIVE_INFINITY, softLimit: Number.POSITIVE_INFINITY };
}

const NON_ESSENTIAL_LEAD = /^(?:看这边|看这里|你看|喂+|哎+|听我说|听我讲|我跟你说|跟你说|你先听|先听我说|说真的|等下|等等|先等等)[呀啊呢吧嘛哦哟哈。！!？?…~～\s]*$/u;
const NON_ESSENTIAL_LEAD_PREFIX = /^(?:看这边|看这里|你看|喂+|哎+|听我说|听我讲|我跟你说|跟你说|你先听|先听我说|说真的|等下|等等|先等等)[呀啊呢吧嘛哦哟哈]{0,3}\s*[，,：:；;、.。!！?？…~～-]+\s*/u;
const GREETING_TOKENS = /(?:早上好|晚上好|下午好|中午好|早安|晚安|你好)/gu;
const QUESTION_PARTICLE_NEW_CLAUSE = /(?<=吗)\s*(?=(?:我|你|他|她|它|这|那|今天|明天|晚上|刚才|这会儿|现在|在|有|要|能|会|想|别|先|还是|是不是|要不要))/gu;

function isNonEssentialLead(value) {
  return NON_ESSENTIAL_LEAD.test(String(value || "").trim());
}

function dropNonEssentialLeadingPieces(pieces) {
  const output = [];
  for (const piece of pieces) {
    const value = String(piece || "").trim();
    if (!value) continue;
    if (isNonEssentialLead(value)) continue;
    const withoutLead = value.replace(NON_ESSENTIAL_LEAD_PREFIX, "").trim();
    if (withoutLead) output.push(withoutLead);
  }
  return output.length ? output : pieces;
}

function comparableText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s，,。！!？?；;、…~～"'“”‘’（）()【】[\]]+/gu, "");
}

function bigrams(value) {
  const text = comparableText(value);
  const output = new Set();
  for (let index = 0; index < text.length - 1; index += 1) {
    output.add(text.slice(index, index + 2));
  }
  return output;
}

function looksLikeRepeatedThought(left, right) {
  const a = comparableText(left);
  const b = comparableText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return true;
  if (a.length < 6 || b.length < 6) return false;
  const leftPairs = bigrams(a);
  const rightPairs = bigrams(b);
  if (leftPairs.size === 0 || rightPairs.size === 0) return false;
  let overlap = 0;
  for (const pair of leftPairs) {
    if (rightPairs.has(pair)) overlap += 1;
  }
  const union = leftPairs.size + rightPairs.size - overlap;
  return overlap >= 3 && union > 0 && overlap / union >= 0.2;
}

function dropRepeatedThoughts(pieces) {
  const output = [];
  for (const piece of pieces) {
    if (output.some((existing) => looksLikeRepeatedThought(existing, piece))) continue;
    output.push(piece);
  }
  return output;
}

function splitSafeLineBreaks(value) {
  return String(value || "")
    // 句号、问号等完整停顿后的换行是安全分段；句中的换行只补成空格。
    .replace(/(?<=[。！？!?；;…])\r?\n\s*/gu, "|||")
    .replace(/\r?\n+/gu, " ");
}

function splitBeforeGreeting(value) {
  const text = String(value || "");
  const matches = Array.from(text.matchAll(GREETING_TOKENS));
  let output = text;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const start = match.index ?? -1;
    const token = match[0];
    if (start < 4) continue;
    const previous = text[start - 1] || "";
    const next = text[start + token.length] || "";
    if (/\s/u.test(previous)) continue;
    if (next && !/[\s，,。！？!?]/u.test(next)) continue;
    output = output.slice(0, start).trimEnd() + "|||" + output.slice(start).trimStart();
  }
  return output;
}

function splitNaturalBoundaries(value) {
  return splitBeforeGreeting(
    String(value || "")
      .replace(QUESTION_PARTICLE_NEW_CLAUSE, "？|||"),
  );
}

/**
 * 只整理模型已经分好的消息段：去引子、去重复、最多三条。
 * 不再从段内切字，也不把段与段重新粘起来。
 */
export function capReplyLength(value, incomingText) {
  const reply = String(value || "").trim();
  if (!reply) return reply;
  if (/sutang2026/iu.test(reply)) return reply;
  const budget = replyLengthBudget(incomingText);
  const normalized = reply.replace(/(?:你说|对方说|我说|我)\s*[：:]\s*/gu, "|||");
  const rawSegments = normalized
    .split("|||")
    .map(splitSafeLineBreaks)
    .map(splitNaturalBoundaries)
    .flatMap((part) => part.split("|||"))
    .map((part) => part.trim())
    .filter(Boolean);
  const withoutOpeners = dropNonEssentialLeadingPieces(rawSegments);
  const withoutRepeats = dropRepeatedThoughts(withoutOpeners);
  const out = withoutRepeats.slice(0, budget.maxSegments);
  return out.length ? out.join("|||") : reply;
}
