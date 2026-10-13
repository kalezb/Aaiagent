import { compactQuestionText, latestIncomingText } from "./_message_text";
import { hashText, semanticReplySimilarity } from "./_reply_naturalness";

export function isVoiceCallRequest(value) {
  const text = compactQuestionText(value);
  if (!text) return false;
  if (!/(?:语音|电话)/u.test(text)) return false;
  if (/(?:不方便|不想|不聊|不接|别打|不发|不喜欢|不爱|不习惯|(?<!能)不能|反感|讨厌)/u.test(text)) return false;
  const directRequest = /(?:可以|能不能|可不可以|要不要|想|能)(?:和我|和你|跟我|跟你|给我|一起)?(?:打|开|发|接)?(?:个)?(?:语音|电话)/u.test(text);
  const directVerbRequest = /(?:晚点|待会|等会|现在|回头)?(?:打个|开个|发个|接个)(?:语音|电话)/u.test(text);
  const exactRequest = /^(?:语音|电话)(?:聊天|聊|通话)?(?:吗|嘛|么|呢|吧|行吗|行不行|可以吗|好不好)?[？?]?$/u.test(text);
  const questionRequest = /(?:语音|电话).{0,4}(?:吗|嘛|么|行吗|行不行|可以吗|好不好)[？?]?$/u.test(text);
  return directRequest || directVerbRequest || exactRequest || questionRequest;
}

// 2026-10-06 用户要求：语音/视频的拒绝不能每次都说同一句（同一个人连问两次会像机器人），
// 改成 3 句轮换，而且都带钩子——拒绝但不把门关死，符合“给一半留一半”。
export const VOICE_CHAT_DECLINES = [
  "我声音可不随便给人听，你先说说凭啥",
  "打字聊嘛，声音留着以后再说",
  "不语音哦，我一开口就没神秘感了",
  "语音我是不来的，你多聊两句我倒是愿意",
];
export const VIDEO_CHAT_DECLINES = [
  "视频就算啦，我平时不拍的",
  "不视频哦，还没到给你看的时候",
  "想看我，那就多聊两句呀",
];
export const VOICE_CHAT_DECLINE = VOICE_CHAT_DECLINES[0];

/**
 * 从候选里挑一句历史里没说过的，避免同一个人连问两次看到同一句话。
 * 2026-10-06 实测：新联系人在数据库里还没有历史，只按历史挑会每次都落到第一句，
 * 所以再加一个时间种子——没有历史信号时按秒轮换，连着问两次也不会一模一样。
 */
function pickUnusedDecline(lines, historyMessages, seedText = "") {
  const recent = (Array.isArray(historyMessages) ? historyMessages : [])
    .filter((message) => message && message.role === "assistant")
    .slice(-8)
    .map((message) => String(message.content || ""));
  const seed = Math.abs(hashText(seedText + "|" + String(Math.floor(Date.now() / 1000))));
  const unused = lines.filter((line) =>
    !recent.some((previous) => previous.includes(line) || semanticReplySimilarity(previous, line) >= 0.82)
  );
  const pool = unused.length ? unused : lines;
  return pool[seed % pool.length];
}

/**
 * 语音请求走的是本地短路（不经过模型），所以轮换必须在这里做。
 * 2026-10-06 实测：这里原来固定返回第一句，同一个人连问两次看到一模一样的话。
 */
export function localVoiceReply(messages, historyMessages = []) {
  const incoming = latestIncomingText(messages);
  if (!isVoiceCallRequest(incoming)) return "";
  return pickUnusedDecline(VOICE_CHAT_DECLINES, historyMessages, incoming);
}

export function isVideoCallRequest(value) {
  const text = compactQuestionText(value);
  if (!text) return false;
  return /(?:想|要|能|可以|给|发|打|接|开|看).{0,6}(?:视频|视频通话)|(?:视频|视频通话).{0,6}(?:吗|嘛|么|呀|吧|呗|看看|看一下|行不行)/u.test(text)
    && !/(?:不方便|不想|不发|不接|别发|反感|讨厌)/u.test(text);
}

const VOICE_MEDIA_PROMISE = /(?:可以|好呀|好啊|行呀|行啊|没问题).{0,8}(?:语音|电话)|(?:晚点|待会|等会|回头|现在).{0,6}(?:打给你|打电话|语音聊|语音)/u;
const VIDEO_MEDIA_PROMISE = /(?:可以|好呀|好啊|行呀|行啊|没问题).{0,8}视频|(?:晚点|待会|等会|回头|现在).{0,6}(?:发视频|视频聊|视频)/u;
const MEDIA_PROMISE_NEGATION = /(?:不|没|别|不能|不想|不方便|不发|不会|不会发|算了|拒).{0,6}(?:语音|电话|视频)/u;

function replyPromisesMedia(segment, pattern) {
  return pattern.test(segment) && !MEDIA_PROMISE_NEGATION.test(segment);
}

export function sanitizeMediaBoundaryReply(value, incomingText, historyMessages = []) {
  const reply = String(value || "").trim();
  const voiceRequest = isVoiceCallRequest(incomingText);
  const videoRequest = isVideoCallRequest(incomingText);

  if (voiceRequest) return pickUnusedDecline(VOICE_CHAT_DECLINES, historyMessages, incomingText);
  if (!reply || !videoRequest) return reply;

  const kept = reply
    .split(/\|\|\||\r?\n/u)
    .map((part) => part.trim())
    .filter((part) => part && !replyPromisesMedia(part, VIDEO_MEDIA_PROMISE));
  return kept.length ? kept.join("|||") : pickUnusedDecline(VIDEO_CHAT_DECLINES, historyMessages, incomingText);
}

/** 他这轮是不是在说要发自己的照片/身材/视频。 */
export function isSelfMediaOffer(value) {
  const text = String(value || "").replace(/\s+/gu, "");
  if (!text) return false;
  return /(?:(?:我|给你).{0,6}(?:发|看|展示|秀).{0,4}(?:我的|下我的|自己的)?(?:身材|腹肌|胸肌|肌肉|裸照|私密|照片|视频|腿)|想不想看我|给你看看我的|给你看我的)/u.test(text);
}

/** 她自己接了他要发的照片（“那我得看看”“想呀 你先发”）：这种段直接删掉。 */
// 2026-10-06：模型会绕，写成“那我得认真看看呀”“先说说你这照片谁拍的”，所以放宽到“要看/打听照片”。
const SELF_MEDIA_ACCEPT_PATTERN = /(?:那我得|我来|让我|我)?(?:认真|仔细|好好)?(?:看看|看一看|瞅瞅|欣赏|品鉴)|发来看看|你先发|我想看|想呀|值不值得夸|合不合格|照片.{0,6}(?:自拍|谁拍|拍的)|(?:自拍|谁拍|拍的)/u;

export function dropAcceptedSelfMediaSegments(value) {
  const text = String(value || "").trim();
  if (!text) return text;
  const segments = text.split("|||").map((segment) => segment.trim()).filter(Boolean);
  const kept = segments.filter((segment) => !SELF_MEDIA_ACCEPT_PATTERN.test(segment));
  if (!kept.length) return "";
  return kept.length === segments.length ? text : kept.join("|||");
}
