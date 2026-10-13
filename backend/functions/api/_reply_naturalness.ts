export function replyOpeningHint(historyMessages) {
  const openings = [];
  for (const message of historyMessages) {
    if (message.role !== "assistant") continue;
    const opening = String(message.content || "").trim().slice(0, 5);
    if (opening && !openings.includes(opening)) openings.push(opening);
  }
  const openingHint = openings.length
    ? "最近你的回复开头有：" + openings.join("、") + "。这次换一种自然开头，不要连续用哈哈、在的、确实。"
    : "不要每条都用哈哈、在的或确实开头。";
  return openingHint;
}

export function normalizedReplyKey(value) {
  return String(value || "")
    .replace(/(?:\|\|\||\r?\n)/gu, "")
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .trim();
}

function visibleReplyLength(value) {
  return String(value || "").replace(/[\s\p{P}\p{S}]/gu, "").length;
}

function expandSingleCharacterReply(value) {
  const text = String(value || "").trim();
  if (text === "嗯") return "嗯，知道了。";
  if (text === "哦") return "哦，明白了。";
  if (text === "对") return "对，是这样。";
  if (text === "行") return "行，没问题。";
  if (text === "好") return "好，知道了。";
  if (text === "哈") return "哈哈，好。";
  return text;
}

function normalizeReplySegment(value, options = {}) {
  let reply = String(value || "").trim();
  if (!reply) return "";
  if (/^(?:\[[^\]]+\]|评估报价，?\s*搜\s*shanhs668)$/iu.test(reply)) return reply;

  const visibleLength = visibleReplyLength(reply);
  if (visibleLength <= 1) reply = expandSingleCharacterReply(reply);
  if (/[。！？!?…~～]$/u.test(reply)) return reply;
  // 2026-10-06：真人打字很少句句带标点。软语气人设（苏棠）保留模型原本的写法，
  // 不再自动补“？”——补出来的工整感正是“像 AI”的来源之一。星暮维持原样。
  if (options.softParticles) return reply;

  const choiceQuestion =
    /还是/u.test(reply) &&
    !/(?:不管|无论|不论).{0,12}还是/u.test(reply) &&
    /(?:是|想|要|选|去|喜欢|喊|叫|说|觉得|你|我).{0,20}还是/u.test(reply);
  // 苏棠这种软语气人设爱用“呢/呀”收尾，句尾的呢不算疑问；星暮保持原样。
  const trailingQuestionParticle = options.softParticles
    ? /(?:吗|嘛|么|不|没|没有|能不能|可不可以|是不是|好不好|行不行|对不对|怎么样|咋样|多少|几岁|多大|哪里|哪儿|什么|怎么|为什么|多久|高不高|忙不忙)$/u
    : /(?:吗|嘛|么|呢|不|没|没有|能不能|可不可以|是不是|好不好|行不行|对不对|怎么样|咋样|多少|几岁|多大|哪里|哪儿|什么|怎么|为什么|多久|高不高|忙不忙)$/u;
  const looksLikeQuestion =
    trailingQuestionParticle.test(reply) ||
    /(?:什么|怎么|为什么|哪里|哪儿|哪边|哪块|多少|多久|几岁|多大)(?:了|呢|吗|嘛|啊|呀|吧)?$/u.test(reply) ||
    /(?:是不是|要不要|有没有|能不能|可不可以|行不行|对不对|好不好)/u.test(reply) ||
    /(?:是谁|哪(?:儿|里)来的|从哪(?:儿|里)来|谁.{0,8}(?:的|了))/u.test(reply) ||
    /^(?:这|那|你|他|她|它|到底|究竟)?为什么.{0,16}$/u.test(reply) ||
    /^(?:这|那|你|他|她|它|到底|究竟)?(?:怎么会|怎么这样|怎么这么|怎么办|怎么弄|怎么说|怎么看|怎么想|怎么回事|咋办|咋整)/u.test(reply) ||
    /^你(?:也|是不是|有没有|要不要|能不能|可不可以)?.{0,12}的$/u.test(reply) ||
    /^你也在[\p{Script=Han}A-Za-z0-9]{1,12}$/u.test(reply) ||
    /^(?:你|你那边).{0,12}(?:哪|哪里|哪儿|哪边|哪块|什么|怎么|多少|几岁|多大)/u.test(reply);
  return looksLikeQuestion || choiceQuestion ? reply + "？" : reply;
}

export function normalizeAssistantReplyPresentation(value, options = {}) {
  const original = splitPresentationSegments(value);
  if (!original) return "";
  return original
    .split(/(\|\|\||\r?\n)/u)
    .map((part) => part === "|||" || part === "\n" || part === "\r\n" ? part : normalizeReplySegment(part, options))
    .filter((part) => part.length > 0)
    .join("")
    .replace(/(?:\|\|\||\r?\n)+$/u, "")
    .trim();
}

function splitPresentationSegments(value) {
  const text = String(value || "").trim();
  if (!text || /(?:\|\|\||\r?\n)/u.test(text)) return text;

  const sentenceParts = text
    .split(/(?<=[。！？!?；;…])/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentenceParts.length >= 2 && sentenceParts.every((part) => visibleReplyLength(part) >= 2)) {
    return sentenceParts.join("|||");
  }

  const spaceParts = text.split(/\s+/u).map((part) => part.trim()).filter(Boolean);
  const visibleLength = visibleReplyLength(text);
  if (
    visibleLength >= 30 &&
    spaceParts.length >= 2 &&
    spaceParts.length <= 3 &&
    spaceParts.every((part) => visibleReplyLength(part) >= 4)
  ) {
    return spaceParts.join("|||");
  }
  return text;
}
