export function staleReplyFallback(policy) {
  if (!policy?.hasTimestamp) return "";
  if (policy.pastMode && policy.messageType === "expired_invite") {
    return "你刚说的那件事 现在还方便吗";
  }
  return "";
}

function cleanStaleReplySegment(value, policy) {
  let reply = String(value || "").trim();
  if (!reply || !policy?.hasTimestamp) return reply;
  if (
    policy.pastMode &&
    policy.messageType === "expired_invite" &&
    /(?:明天|今天|晚点|周末|到时候|我有空|可以|好啊)/u.test(reply)
  ) {
    return staleReplyFallback(policy);
  }
  return reply
    .replace(/^[，,。！？!?\s]+|[，,。！？!?\s]+$/gu, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

export function sanitizeStaleAssistantReply(value, policy) {
  const original = String(value || "").trim();
  if (!original || !policy?.hasTimestamp || policy.level === "immediate") return original;
  const segments = original
    .split("|||")
    .map((segment) => cleanStaleReplySegment(segment, policy))
    .filter((segment) => segment.length > 0);
  return segments.length ? segments.join("|||") : staleReplyFallback(policy);
}

const EXPLICIT_WORDS = /(裸照|脱光|做爱|上床|睡你|约炮|包养|奶子|下面湿|勃起|口交|射|淫|鸡巴|逼样)/u;
const EXPLICIT_WORDS_WITH_MEETING = /(裸照|脱光|做爱|上床|开房|睡你|约炮|包养|奶子|下面湿|勃起|口交|射|淫|鸡巴|逼样)/u;
// 2026-10-13 用户要求：进入知己情人阶段后，终极目标探讨私密相处与线下独处共识，
// 允许适当展开私密相处、房型着装与情趣细节描写，只拦截粗俗色情、涉黄交易词。
const EXPLICIT_WORDS_INTIMATE = /(裸照|约炮|包养|奶子|下面湿|勃起|口交|射精|鸡巴|逼样)/u;

export function dropExplicitSegments(
  value,
  options: { allowMeetingReward?: boolean; allowIntimateDetails?: boolean } = {},
) {
  const pattern = options.allowIntimateDetails
    ? EXPLICIT_WORDS_INTIMATE
    : options.allowMeetingReward
      ? EXPLICIT_WORDS
      : EXPLICIT_WORDS_WITH_MEETING;
  const segments = String(value || "").split("|||");
  const kept = segments.filter((segment) => !pattern.test(segment));
  return kept.join("|||").trim();
}

export function sanitizeAssistantReply(
  value,
  options: { allowMeetingReward?: boolean; allowIntimateDetails?: boolean } = {},
) {
  const cleaned = String(value || "")
    .split(/(\r?\n|\|\|\|)/u)
    .map((part) =>
      part === "\n" || part === "\r\n" || part === "|||"
        ? part
        : sanitizeAssistantReplySegment(part)
    )
    .filter((part) => part.length > 0)
    .join("");
  return dropExplicitSegments(cleaned, options);
}

const INTERNAL_INSTRUCTION_LEAK_PATTERN =
  /(?:先答(?:他|她|它|对方|客户|你).{0,12}(?:表现|怎么|问的)|按(?:照)?规则|规则要求|系统要求|系统提示词|内部规则|内部标记|提示词|人设要求|后台规则|执行规则|评估标准|表现标准|考核标准|任务进度|评分标准)/u;
export const INTERNAL_INSTRUCTION_LEAK_FALLBACK = "嗯 我在";

export function sanitizeInternalInstructionLeak(value) {
  const original = String(value || "").trim();
  if (!original) return "";
  const segments = original.split("|||");
  const kept = segments
    .map((segment) => String(segment || "").trim())
    .filter((segment) => segment && !INTERNAL_INSTRUCTION_LEAK_PATTERN.test(segment));
  return kept.length ? kept.join("|||").trim() : INTERNAL_INSTRUCTION_LEAK_FALLBACK;
}

export function sanitizeAssistantReplySegment(value) {
  let reply = String(value || "").replace(/\r?\n+/gu, " ").trim();
  const contextPrefix = /^\[[^\]\r\n]{1,100}\]\s*(?:你说|对方说|我说|对方|我)\s*[：:]\s*/u;
  const speakerPrefix = /^(?:你说|对方说|我说|对方|我)\s*[：:]\s*/u;
  const timestampPrefix = /^\[[^\]\r\n]{0,100}(?::\d{2}|距今约\d+小时)[^\]\r\n]{0,100}\]\s*/u;
  const leakedDatedMarker = /\[[^\]\r\n]{0,40}\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}[^\]\r\n]{0,20}\]\s*/gu;
  const leakedClockMarker = /\[[^\]\r\n]{0,20}\d{1,2}:\d{2}[^\]\r\n]{0,20}\]\s*/gu;
  const leakedCjkDatedMarker = /【[^】\r\n]{0,40}\d{1,2}\/\d{1,2}[^】\r\n]{0,20}】\s*/gu;
  const leakedCjkClockMarker = /【[^】\r\n]{0,20}\d{1,2}:\d{2}[^】\r\n]{0,20}】\s*/gu;
  const leakedCjkMarker = /【[^】\r\n]{0,60}】\s*/gu;
  const leakedIsoTimestamp = /20\d{2}-\d{1,2}-\d{1,2}[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s*/gu;

  while (reply) {
    const before = reply;
    reply = reply
      .replace(contextPrefix, "")
      .replace(speakerPrefix, "")
      .replace(timestampPrefix, "")
      .replace(leakedDatedMarker, "")
      .replace(leakedClockMarker, "")
      .replace(leakedCjkDatedMarker, "")
      .replace(leakedCjkClockMarker, "")
      .replace(leakedCjkMarker, "")
      .replace(leakedIsoTimestamp, "")
      .trimStart();
    if (reply === before) break;
  }
  if (/[【】]/u.test(reply)) return "";
  return reply.trim();
}
