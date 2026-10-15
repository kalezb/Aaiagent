/**
 * 回复段数由回复内容本身决定，正常情况下 1~3 条自然短句。
 *
 * 2026-10-15 用户纠正：不要按“对方发了几行”机械决定回几段，也不要为了像真人
 * 硬凑两段。这里保留最多三条的硬上限，具体一条、两条还是三条由清洗后的内容决定。
 */
export function replyLengthBudget(_incomingText) {
  return { maxSegments: 3, maxCharsPerSegment: 20, softLimit: 20 };
}

const INNER_PRONOUN_BREAK = /(?<=[\u4e00-\u9fa5])(?=[我你他她它])/u;
const AFTER_PARTICLE_BREAK = /(?<=[呀啊呢吧啦嘛哦哟哈])(?=[^呀啊呢吧啦嘛哦哟哈])/u;
const NON_ESSENTIAL_LEAD = /^(?:看这边|看这里|你看|喂+|哎+|听我说|听我讲|我跟你说|跟你说|你先听|先听我说|说真的|等下|等等|先等等)[呀啊呢吧嘛哦哟哈。！!？?…~～\s]*$/u;
const NON_ESSENTIAL_LEAD_PREFIX = /^(?:看这边|看这里|你看|喂+|哎+|听我说|听我讲|我跟你说|跟你说|你先听|先听我说|说真的|等下|等等|先等等)[呀啊呢吧嘛哦哟哈]{0,3}\s*[，,：:；;、.。!！?？…~～-]+\s*/u;
const HANGING_TAIL = /(?:剩|就|还)$/u;
const HANGING_PRONOUN_PHRASE = /^(?:我|你|他|她|它|这|那)$|^[我你他她它](?:的|是|和|跟|把|被|给|让|从|向|对|为|有)$/u;

function plainLength(value) {
  return String(value || "").replace(/\s+/gu, "").length;
}

function isNonEssentialLead(value) {
  return NON_ESSENTIAL_LEAD.test(String(value || "").trim());
}

function isHangingTail(value) {
  const text = String(value || "").trim();
  if (!text || /[。！？!?；;…]$/u.test(text)) return false;
  const plain = text.replace(/\s+/gu, "");
  return HANGING_TAIL.test(plain) || HANGING_PRONOUN_PHRASE.test(plain);
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

function mergeCrossSegmentTail(pieces, limit) {
  const output = [];
  for (const piece of pieces) {
    const value = String(piece || "").trim();
    if (!value) continue;
    if (output.length && isHangingTail(output[output.length - 1])) {
      const combined = output[output.length - 1] + " " + value;
      if (plainLength(combined) <= Math.max(limit, 24)) {
        output[output.length - 1] = combined;
      } else {
        output[output.length - 1] = value;
      }
    } else {
      output.push(value);
    }
  }
  while (output.length && isHangingTail(output[output.length - 1])) {
    output.pop();
  }
  return output;
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

function fixHangingPieces(pieces) {
  const fixed = [];
  for (const piece of pieces) {
    if (fixed.length && isHangingTail(fixed[fixed.length - 1])) {
      fixed[fixed.length - 1] = fixed[fixed.length - 1] + " " + piece;
    } else {
      fixed.push(piece);
    }
  }
  while (fixed.length && isHangingTail(fixed[fixed.length - 1])) fixed.pop();
  return fixed.length ? fixed : pieces;
}

function splitOverlongClause(clause, limit) {
  const plain = String(clause || "").replace(/\s+/gu, "");
  if (plain.length <= limit) return [clause];
  const parts = String(clause)
    .split(INNER_PRONOUN_BREAK)
    .flatMap((part) => part.split(AFTER_PARTICLE_BREAK))
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [clause];
}

/**
 * 把回复收口成自然短句：内容有多少就说多少，最多三条，每条不超过20个字。
 * 超出的只删不换；开头引子单独成段会丢掉；半句会补全或删除。
 */
export function capReplyLength(value, incomingText) {
  const reply = String(value || "").trim();
  if (!reply) return reply;
  if (/sutang2026/iu.test(reply)) return reply;
  const budget = replyLengthBudget(incomingText);
  const normalized = reply.replace(/(?:你说|对方说|我说|我)\s*[：:]\s*/gu, "|||");
  const rawSegments = normalized.split("|||").map((part) => part.trim()).filter(Boolean);
  const queues = rawSegments.map((segment) => {
    if (segment.replace(/\s+/gu, "").length <= budget.softLimit) return [segment];
    let clauses = segment
      .split(/(?<=[，,。！!？?；;、])/u)
      .map((part) => part.trim().replace(/[，,。！!？?；;、]+$/u, "").trim())
      .filter(Boolean);
    if (clauses.length <= 1) {
      clauses = segment
        .split(/\s+/u)
        .map((part) => part.trim().replace(/[，,。！!？?；;、]+$/u, "").trim())
        .filter(Boolean);
    }
    if (clauses.length > 1) return fixHangingPieces(clauses);
    return [splitOverlongClause(segment, budget.maxCharsPerSegment)[0] || segment];
  });
  const flattened = queues.flat();
  const withoutOpeners = dropNonEssentialLeadingPieces(flattened);
  const withoutRepeats = dropRepeatedThoughts(withoutOpeners);
  const completePieces = mergeCrossSegmentTail(withoutRepeats, budget.maxCharsPerSegment);
  const finalPieces = completePieces.length ? completePieces : withoutRepeats;
  const out = finalPieces.slice(0, budget.maxSegments);
  return out.length ? out.join("|||") : reply;
}
