const MEDIA_PLACEHOLDER =
  /^\[(?:图片|语音|闪照|以图换图|对方转发了你本人的动态)(?::[^\]]*)?\]$/u;
const NAMED_STICKER_PREFIX =
  /^(?:\[(?:表情包|互动表情|Soul互动表情|语音互动表情|表情)(?::[^\]]*)?\]|对方发来\s*(?:一个友好互动表情|(?:(?:Soul\s*)?(?:官方|时段问候|互动)?表情)[「“][^」”]{1,20}[」”]))/u;
const SHORT_BRACKET_STICKER = /^\[[^\]\n]{1,12}\](?:\[[^\]\n]{1,12}\])*$/u;

function incomingMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === "user")
    .map((message) => String(message?.content || "").trim())
    .filter(Boolean);
}

export function isStickerStateContent(value) {
  const text = String(value || "").trim();
  if (!text || MEDIA_PLACEHOLDER.test(text)) return false;
  return NAMED_STICKER_PREFIX.test(text) || SHORT_BRACKET_STICKER.test(text);
}

export function isGreetingStickerContent(value) {
  if (!isStickerStateContent(value)) return false;
  const label = String(value || "")
    .replace(/^对方发来\s*(?:Soul\s*)?(?:官方|时段问候|互动)?表情[「“]/u, "")
    .replace(/[\[\]【】「」“”]/gu, "")
    .replace(/^(?:表情包|互动表情|Soul互动表情|语音互动表情|表情)[：:]\s*/u, "")
    .trim();
  return /(?:你好|您好|哈喽|嗨|早上好|早安|上午好|中午好|午安|下午好|晚上好|晚安|月亮|太阳|打招呼|问候)/u
    .test(label);
}

export function isStickerOnlyTurn(messages) {
  const incoming = incomingMessages(messages);
  return incoming.length > 0 && incoming.every(isStickerStateContent);
}

export function latestIncomingText(messages) {
  const incoming = incomingMessages(messages);
  const substantive = [...incoming].reverse().find((content) => !isStickerStateContent(content));
  return substantive || incoming.at(-1) || "";
}

export function compactQuestionText(value) {
  return String(value || "").replace(/\s+/gu, "");
}
