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

export function semanticReplySimilarity(left, right) {
  const a = normalizedReplyKey(left);
  const b = normalizedReplyKey(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorterLength = Math.min(a.length, b.length);
  if (shorterLength >= 6 && (a.includes(b) || b.includes(a))) return 1;

  const makeBigrams = (value) => {
    const grams = new Set();
    for (let index = 0; index < value.length - 1; index += 1) {
      grams.add(value.slice(index, index + 2));
    }
    return grams;
  };
  const leftGrams = makeBigrams(a);
  const rightGrams = makeBigrams(b);
  if (leftGrams.size === 0 || rightGrams.size === 0) return 0;
  let intersection = 0;
  for (const gram of leftGrams) {
    if (rightGrams.has(gram)) intersection += 1;
  }
  return intersection / (leftGrams.size + rightGrams.size - intersection);
}

/** 整条回复都是以前说过的话时，用这些不重复的短句顶上（避免原样重发）。 */
const REPEAT_NEUTRAL_CONTINUATIONS = ["嗯 你接着说", "那你呢", "我在听呢", "然后呢"];

export function hashText(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return hash;
}

/** 把一段文本按 ||| 拆成句子。 */
function splitSegmentsOf(text) {
  return String(text || "").split("|||").map((part) => part.trim()).filter(Boolean);
}

/** 只删“解释为什么没回”的那种话；单纯说“睡了 被你吵醒了”是正常聊天，不删。 */
export const LATE_REPLY_EXCUSE =
  /(?:(?:我)?刚(?:忙完|在忙|看到|看见|上号)|(?:我)?才(?:看到|看见|上号|回你|回我|顾上)|(?:我)?(?:一直忙|忙到现在|忙晕了|这两天忙晕了|睡过去|没闲着|没看到|没看见|没顾上|没看手机)|(?:我)?(?:昨晚|昨天|前天|这两天|今天).{0,18}(?:看到|看见|上号|顾上|忙晕)(?:了)?|昨晚那条看到了|昨天那条看到了|抱歉|不好意思|别怪我)/u;

/** 这一句是不是“迟到借口”（忙 / 没顾上 / 才看到 / 刚看手机…）。 */
function isDelayExcuse(segment) {
  const text = String(segment || "").replace(/\s+/gu, "");
  if (!text) return false;
  return LATE_REPLY_EXCUSE.test(text);
}

/** 把历史里我方回复按 ||| 拆成一句一句，用于逐句去重。 */
function splitAssistantSegments(historyMessages, limit) {
  return (Array.isArray(historyMessages) ? historyMessages : [])
    .filter((message) => message && message.role === "assistant")
    .slice(-limit)
    .flatMap((message) => String(message.content || "").split("|||"))
    .map((part) => part.trim())
    .filter(Boolean);
}

export function avoidRepeatedAssistantReply(
  value,
  historyMessages = [],
  incomingText = "",
  nowSec = Math.floor(Date.now() / 1000),
  fallbackReply = "",
) {
  const reply = String(value || "").trim();
  const replyKey = normalizedReplyKey(reply);
  if (!reply || !replyKey) return reply;

  // 2026-10-05 真机（你压到我头发了）：模型把自己几天前说过的话原句搬出来当新回复，
  // 旧规则只看最近 6 条 + 30 分钟，而且是整段比对，重复的只是其中一段就拦不住。
  // 现在改成：历史里自己说过的任何一句都不许原句重复，按 ||| 分段逐段比对，重复段直接丢掉。
  // 2026-10-06 真机（一一）：13 分钟内出现了两次迟到理由——23:59“刚看手机才看到”、
  // 00:12“刚没顾上看手机”。换个说法就绕过了原句去重，读起来就是“勉强回复”。
  // 处理顺序：先删掉“以前说过的那一段”，再在还剩多条时删掉迟到借口段（永远保留至少一条）。
  // 2026-10-07 真机（请叫我球⚽️）：她 00:11 说过“我醒了就得翻半天才迷糊回去”，
  // 20 小时后 20:43 又把同一句原样发了一遍——旧窗口只看最近 20 段，隔天的够不着。
  // 现在放宽到整段可取到的历史（最多 60 条自己的消息）。
  const previousSegments = splitAssistantSegments(historyMessages, 60);
  const excuseUsedRecently = splitAssistantSegments(historyMessages, 6).some(isDelayExcuse);
  const currentSegments = splitSegmentsOf(reply);
  let keptSegments = currentSegments.filter((segment) =>
    !previousSegments.some((previous) => semanticReplySimilarity(previous, segment) >= 0.9)
  );
  if (excuseUsedRecently && keptSegments.length > 1) {
    const withoutExcuse = keptSegments.filter((segment) => !isDelayExcuse(segment));
    if (withoutExcuse.length) keptSegments = withoutExcuse;
  }
  if (keptSegments.length && keptSegments.length < currentSegments.length) {
    return keptSegments.join("|||");
  }
  // 2026-10-06 真机（♩讲究郎¶吾先森（89已婚））：他新问了一句“你想拿什么换”，
  // 模型又把两分钟前那条三段消息里的第一段“企鹅我看到了 就是不太方便加呢”单独重发了一遍
  // ——旧逻辑对“整条都是旧话”是放行的。
  // 只在“这条回复是我上一条更长消息里的一截”时才算复读；
  // 完全相等（测试特意保留的语义回复）或在他原话上又加了内容的，都不算。
  const normalizedReply = String(reply).replace(/\s+/gu, "");
  const wholeReplyIsRepeat = normalizedReply.length > 0 && historyMessages
    .filter((message) => message && message.role === "assistant")
    .slice(-20)
    .map((message) => String(message.content || "").replace(/\s+/gu, ""))
    .some((previous) => previous.length > normalizedReply.length && previous.includes(normalizedReply));

  const recentAssistantReplies = historyMessages
    .filter((message) => message?.role === "assistant")
    .slice(-6)
    .filter((message) => {
      const createdAt = Number(message?.created_at || 0);
      // 2026-10-05：同一个人 30 分钟内不许重复说同一句（原来 10 分钟太短，真机出现过 3 分钟里连说两次“刚把娃哄睡”）。
      return !createdAt || (Number(nowSec) - createdAt) <= 30 * 60;
    })
    .map((message) => String(message?.content || "").trim())
    .filter(Boolean);
  const duplicatedRecently = recentAssistantReplies.some((previous) =>
    semanticReplySimilarity(previous, reply) >= 0.82
  );
  if (!duplicatedRecently) {
    return wholeReplyIsRepeat ? neutralRepeatContinuation(reply, incomingText) : reply;
  }
  const fallback = String(fallbackReply || "").trim();
  if (
    fallback &&
    !recentAssistantReplies.some((previous) => semanticReplySimilarity(previous, fallback) >= 0.82)
  ) return fallback;

  const incoming = String(incomingText || "").replace(/\s+/gu, "");
  const candidates = [];
  if (/^(?:嗯+|哦+|好(?:的|吧)?|行(?:吧)?|可以(?:可以)?|收到|ok|okay|中)$/iu.test(incoming)) {
    candidates.push("行，那就先这样。", "行，不催你了。");
  } else if (/(?:在吗|在不在|你好|嗨|哈喽|早上好|中午好|下午好|晚上好)/u.test(incoming)) {
    candidates.push("嗯，我在。", "在呢，你说。");
  }
  const variedReply = candidates.find((candidate) =>
    !recentAssistantReplies.some((previous) => semanticReplySimilarity(previous, candidate) >= 0.82)
  );
  // 不复用泛化问句覆盖模型的完整语义回复；没有等价改写时保留原回复。
  const result = variedReply || reply;
  if (result === reply && wholeReplyIsRepeat) return neutralRepeatContinuation(reply, incomingText);
  return result;
}

/** 对方要走了（睡/忙/出门）时的收尾候选，避免复读兜底句驴唇不对马嘴。 */
const REPEAT_LEAVE_CONTINUATIONS = ["行 那你去忙吧", "好 那明天聊", "去吧 有空再说"];
const REPEAT_LEAVE_HINT = /(?:先睡|要睡|去睡|睡觉去|晚安|明晚|明天再聊|改天聊|不聊了|下线了|先忙|去忙|有事|出门|挂了)/u;

/** 整条回复都是以前说过的话：换一句不重复的短句顶上（不能发空，空回复会被填成结束语）。 */
function neutralRepeatContinuation(seed, incomingText = "") {
  const list = REPEAT_LEAVE_HINT.test(String(incomingText || ""))
    ? REPEAT_LEAVE_CONTINUATIONS
    : REPEAT_NEUTRAL_CONTINUATIONS;
  const index = Math.abs(hashText(String(seed || "") + "|" + String(Date.now()))) % list.length;
  return list[index];
}
