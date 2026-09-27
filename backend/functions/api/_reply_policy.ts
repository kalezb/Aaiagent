export function latestIncomingText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return String(messages[index]?.content || "").trim();
  }
  return "";
}

export function isVoiceCallRequest(value) {
  const text = String(value || "").replace(/\s+/gu, "");
  if (!text) return false;
  return /(?:可以|能不能|要不要|想和你|能和你|跟你|和我)?(?:打|开|发)?(?:个)?(?:语音|电话)(?:聊天|聊|通话|吗|嘛|么|呀|吧)?/u.test(text)
    && !/(?:不方便|不想|不聊|不接|别打|反感|讨厌)/u.test(text);
}

export function localVoiceRequestReply(messages) {
  return isVoiceCallRequest(latestIncomingText(messages)) ? "不语音哈 打字可以" : "";
}

const CONTACT_REQUEST_PATTERN = /(?:加|要|给|发|留|换|互换|交换|有|方便|可以).{0,8}(?:qq|q号|扣扣|企鹅号|联系方式|好友|微信|vx|v信|电话|手机号)|(?:qq|q号|扣扣|企鹅号|联系方式|微信|vx|v信|电话|手机号).{0,8}(?:多少|几号|发我|给我|留|加|互换|交换)|(?:加|发|给|留).{0,3}(?:个)?q(?:号)?(?:给|我)?|(?:你|你的).{0,4}(?:qq|q号|联系方式|微信|电话|手机号).{0,6}(?:是|多少|发|给|留|加)|(?:联系方式|微信|电话|手机号).{0,6}(?:给我|发我|留一个|加一下)/iu;

const CONTACT_NEGATION_PATTERN = /(?:不|别|不想|不方便|不要|反感|讨厌).{0,5}(?:给|发|留|加|交换|互换)?.{0,3}(?:qq|q号|联系方式|微信|电话|手机号)/iu;

export function isContactRequest(value) {
  const text = String(value || "").replace(/\s+/gu, "");
  if (!text || CONTACT_NEGATION_PATTERN.test(text)) return false;
  return CONTACT_REQUEST_PATTERN.test(text);
}

export function countContactRequests(...messageGroups) {
  const seen = new Set();
  let count = 0;
  for (const group of messageGroups) {
    for (const message of Array.isArray(group) ? group : []) {
      if (message?.role !== "user" || !isContactRequest(message?.content)) continue;
      const key = [message.id, message.platform, message.contact_id, message.created_at, message.content].join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      count += 1;
    }
  }
  return count;
}

function normalizeContactQq(value) {
  const text = String(value || "").trim().replace(/[^0-9]/gu, "");
  return /^\d{5,12}$/u.test(text) ? text : "";
}

function contactRefusalReply(requestCount, businessIntent) {
  if (requestCount <= 1) {
    return businessIntent
      ? "有手机的事在这儿说就行 要加Q以后再说"
      : "先不加哈 在这儿聊挺好的";
  }
  if (requestCount === 2) return "你这追得有点急 先聊熟点再说";
  return "加Q这事再缓缓 先说你找我想聊啥";
}

export function resolveContactRequestPolicy({
  requestCount,
  stage,
  activity,
  incomingText,
  historyMessages = [],
  messages = [],
  contactQq = "",
}) {
  const count = Math.max(0, Number(requestCount || 0));
  if (count <= 0) return { isRequest: false, allowed: false, reply: "", requestCount: 0, contactQq: "" };

  const combinedMessages = [...historyMessages, ...messages].filter((message) => message?.role === "user");
  const businessIntent = isExplicitBusinessIntent(incomingText) || combinedMessages.some((message) => isExplicitBusinessIntent(message.content));
  const normalizedQq = normalizeContactQq(contactQq);
  const totalExchanges = Number(activity?.totalExchanges || 0);
  const activeDays = Number(activity?.activeDays || 0);
  const requiredMessages = businessIntent ? 10 : 30;
  const allowed = Boolean(
    normalizedQq &&
    Number(stage || 0) >= 2 &&
    count >= 3 &&
    totalExchanges >= requiredMessages &&
    activeDays >= 2
  );
  const reply = allowed
    ? "可以 我QQ是" + normalizedQq + " 加的时候说下你是谁"
    : contactRefusalReply(count, businessIntent);

  return {
    isRequest: true,
    allowed,
    reply,
    requestCount: count,
    businessIntent,
    contactQq: normalizedQq,
  };
}

const CONTACT_DISCLOSURE_PATTERN = /(?:qq|q号|扣扣|企鹅号|微信号?|vx|v信|手机号|电话|联系方式).{0,24}\d{5,12}|\d{5,12}.{0,24}(?:qq|q号|扣扣|企鹅号|微信号?|vx|v信|手机号|电话|联系方式)|(?:加|联系).{0,12}\d{5,12}/iu;
const CONTACT_CHANNEL_PATTERN = /(?:qq|q号|扣扣|企鹅号|微信号?|vx|v信|手机号|电话)/iu;

export function sanitizeContactDisclosure(value, { allowed = false, contactQq = "" } = {}) {
  const normalizedQq = normalizeContactQq(contactQq);
  const fallback = "联系方式先不发了 在这儿聊就行";
  const segments = String(value || "")
    .split(/(\|\|\||\r?\n)/u)
    .map((segment) => {
      if (segment === "|||" || segment === "\n" || segment === "\r\n" || !segment.trim()) return segment;
      if (!CONTACT_DISCLOSURE_PATTERN.test(segment)) return segment;
      const hasNonQqChannel = /(?:微信号?|vx|v信|手机号|电话)/iu.test(segment);
      if (allowed && normalizedQq && segment.includes(normalizedQq) && !hasNonQqChannel) return segment;
      return fallback;
    })
    .filter((segment) => segment.length > 0);

  const cleaned = segments.join("").trim();
  if (!cleaned) return fallback;
  if (!CONTACT_DISCLOSURE_PATTERN.test(cleaned) && CONTACT_CHANNEL_PATTERN.test(cleaned) && /(?:加|给|发|留|联系).{0,8}(?:我|你)/iu.test(cleaned)) {
    return fallback;
  }
  return cleaned;
}

export function buildRelationshipBoundaryPrompt(stage, incomingText, historyMessages = []) {
  const recentIncoming = [...historyMessages, { role: "user", content: incomingText }]
    .filter((message) => message?.role === "user")
    .slice(-6)
    .map((message) => String(message.content || ""))
    .join(" ");
  const relationshipTopic = /(?:老公|老婆|婚姻|夫妻|感情|异地|分居|离婚|公婆|婆婆|家庭)/u.test(recentIncoming);
  const intimateTopic = /(?:两性|性生活|夫妻生活|做爱|上床|开房|床事|裸|身体|黄腔|胸|腿|下面)/u.test(recentIncoming);
  if (!relationshipTopic && !intimateTopic) return "";

  const level = Number(stage || 0);
  if (level <= 1) {
    if (intimateTopic) return "【两性边界】你们还不熟。不要接两性细节或黄腔，用一句自然收线，例如“这个不聊这么细”或“成年人话点到为止”，不要突然说教。";
    return "【家庭边界】你们还不熟。只可简短确认已婚等基本事实，不展开老公、公婆或夫妻矛盾，不装熟、不抱怨婚姻。";
  }
  if (level === 2) {
    if (intimateTopic) return "【两性边界】可以接一句成年人观点或玩笑，不主动升级，不讲露骨细节；越界时自然收线，例如“成年人话点到为止”，不突然说教。";
    return "【家庭边界】可以自然聊聚少离多、关系一般等感受，但不把家庭矛盾当主要话题，不连续倾诉。";
  }
  if (intimateTopic) return "【两性边界】比较熟可以接成年人观点和分寸内的玩笑，但不主动升级、不讲露骨细节，也不承诺见面、照片、语音或视频。";
  return "【家庭边界】比较熟可以聊一般家庭感受，但仍不主动倒苦水，不用家庭矛盾换取亲近。";
}

export function isExplicitBusinessIntent(value) {
  const text = String(value || "").replace(/\s+/gu, "");
  return /(?:还|现在).{0,8}收(?:手机|旧手机)?|收手机|收旧手机|回收|上门.{0,6}(?:收|取)|换机|旧手机|闲置设备|手机.{0,6}(?:卖|出|处理)|(?:咨询|问问).{0,8}(?:回收|收手机)/u.test(text);
}

const BUSINESS_LEAK_TERMS = /(?:手机回收|数码回收|旧手机|二手机|回收旧|回收手机|上门收|上门取|验机|报价|机型|型号|闲置设备|能收|收的)/u;

export function sanitizeNewContactBusinessReply(value, relationStageLevel, incomingText) {
  const reply = String(value || "").trim();
  if (!reply || Number(relationStageLevel || 0) !== 1 || isExplicitBusinessIntent(incomingText)) return reply;
  const kept = reply
    .split(/\|\|\||\r?\n/u)
    .map((part) => part.trim())
    .filter((part) => part && !BUSINESS_LEAK_TERMS.test(part));
  if (kept.length) return kept.join("|||");
  return /(?:在吗|在不在|你好|嗨|哈喽|hello|hi)/iu.test(String(incomingText || ""))
    ? "在呢 你说"
    : "哈哈 这个先不聊";
}

export function replyOpeningHint(historyMessages) {
  const openings = [];
  for (const message of historyMessages) {
    if (message.role !== "assistant") continue;
    const opening = String(message.content || "").trim().slice(0, 5);
    if (opening && !openings.includes(opening)) openings.push(opening);
  }
  return openings.length
    ? "最近你的回复开头有：" + openings.join("、") + "。这次换一种自然开头，不要连续用哈哈、在的、确实。"
    : "不要每条都用哈哈、在的或确实开头。";
}

export function replyGenerationSettings(messages, messageDelay, config) {
  const text = latestIncomingText(messages);
  const messageType = messageDelay?.messageType || "normal";
  const simpleGreeting = messageType === "greeting" && text.length <= 12;
  const complex = messageType === "business" || messageDelay?.pastMode || text.length > 40 ||
    /(?:图片|语音|截图|型号|多少钱|价格|地址|工作)/u.test(text);
  const requestedMax = simpleGreeting ? 64 : complex ? 120 : 88;
  const requestedTemperature = messageDelay?.pastMode ? 0.4 : complex ? 0.55 : simpleGreeting ? 0.82 : 0.8;
  return {
    maxTokens: Math.max(48, Math.min(Number(config.maxTokens || 160), requestedMax)),
    temperature: requestedTemperature,
  };
}

export async function loadOrCreatePendingReply(db, payload) {
  const existing = await db.prepare(
    "SELECT id, content, status FROM pending_replies WHERE token = ? AND request_id = ? LIMIT 1"
  ).bind(payload.token, payload.requestId).first();
  if (existing) return existing;

  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT OR IGNORE INTO pending_replies (id, token, request_id, platform, contact_id, contact_name, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)"
  ).bind(
    id,
    payload.token,
    payload.requestId,
    payload.platform,
    payload.contactId,
    payload.contactName,
    payload.content,
    payload.createdAt
  ).run();

  return await db.prepare(
    "SELECT id, content, status FROM pending_replies WHERE token = ? AND request_id = ? LIMIT 1"
  ).bind(payload.token, payload.requestId).first();
}

export function buildLayeredSystemPrompt({
  personaPrompt,
  platform,
  profileContext,
  currentDatetime,
  weekday,
  activityNow,
  homeLocation,
  workLocation,
  weather,
  activity,
  stageText,
  relationStageLevel,
  messageDelay,
  contactPolicy,
  messages,
  historyMessages,
}) {
  const newContact = Number(relationStageLevel || 0) === 1;
  const fixed = [
    personaPrompt,
    "【底线】不报价，不催单，不主动暧昧，不主动提见面；不主动给联系方式，对方索要QQ、微信或电话时先自然拒绝，只有系统明确给出可发送的QQ时才能回复，绝不能自己编号码；被质疑AI自然带过；用户没提供过的信息不编造。",
    "【说话方式】像熟人微信聊天，优先短句，1到3句，能一句说清就一句。不要客服腔、AI腔、总结或说教，不要每条都反问。",
    "【角色】聊天记录里的“对方说”是客户说的，“你说”是你之前说的，不能弄混。时间戳只是上下文，不要写进回复。",
    "同一客户绑定多个平台账号时按同一个人连续记忆，记忆必须连续，不要说忘记别的平台聊过什么。",
    newContact ? "【新客边界】你们还不熟，禁止主动提工作、手机、回收、旧设备、上门、型号、报价或任何业务话题；只聊当前消息本身。只有对方明确聊到手机、换机或旧设备时才可以自然接一句。" : "",
  ];

  const locationContext = newContact
    ? "你住在" + homeLocation.city + homeLocation.district + "，但不要主动提工作地点。"
    : "你住在" + homeLocation.city + homeLocation.district + "，工作地在" + workLocation.city + workLocation.district + "。";

  const dynamic = [
    "【当前平台】" + platform + "。",
    profileContext ? "【长期客户档案】" + profileContext : "",
    "【当前时间和地点】" + currentDatetime + "（" + weekday + "）。" + activityNow + "。" + locationContext +
      "今天" + weather.condition + weather.temp + "度。",
    "【关系阶段】" + stageText,
    activity.activeDays >= 2
      ? "这个客户最近7天有" + activity.activeDays + "天主动找过你，别假装你们天天都在聊。"
      : "",
    "【开头去重】" + replyOpeningHint(historyMessages),
  ].filter(Boolean);

  const scenarios = [];
  if (messageDelay?.prompt) scenarios.push("【消息时效】" + messageDelay.prompt);

  const incoming = latestIncomingText(messages);
  if (/(?:做什么工作|干什么工作|做什么的|干什么的|你的职业|你是做哪行)/u.test(incoming)) {
    scenarios.push("【直接问职业】直接回答你做二手手机和数码回收，平时线上沟通、合适就安排当地师傅上门。不要顺着立刻推销，也不要主动问对方有没有手机卖。");
  } else if (messageDelay?.messageType === "business") {
    scenarios.push("【主动聊到回收】先回答对方问的事。可以自然说新旧手机、坏手机、老年机都能收，但不要报价，不要催拍照片，不要马上索取型号。");
  }

  const relationshipPrompt = buildRelationshipBoundaryPrompt(relationStageLevel, incoming, historyMessages);
  if (relationshipPrompt) scenarios.push(relationshipPrompt);
  if (contactPolicy?.isRequest) {
    if (contactPolicy.allowed && contactPolicy.contactQq) {
      scenarios.push("【联系方式】系统已允许回复QQ，只能原样回复" + contactPolicy.contactQq + "，不要附加其他号码，也不要自行修改。");
    } else {
      scenarios.push("【联系方式】对方在索要QQ或联系方式，但现在不能给，也不能编造号码；自然拒绝，停住话题。");
    }
  }

  return [
    "【固定人设】\n" + fixed.join("\n"),
    "【动态上下文】\n" + dynamic.join("\n"),
    scenarios.length ? "【当前场景】\n" + scenarios.join("\n") : "",
  ].filter(Boolean).join("\n\n");
}
