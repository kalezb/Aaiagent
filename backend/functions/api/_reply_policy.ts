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

export function localAgeReply(messages, personaPrompt) {
  const incoming = latestIncomingText(messages);
  if (!/(?:多大|几岁|年龄|哪年生的)/u.test(incoming)) return "";
  const ageMatch = String(personaPrompt || "").match(/(\d{2})岁/u);
  const age = Number(ageMatch?.[1] || 0);
  if (age < 18 || age > 80) return "";
  return age + "了 你呢";
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

function contactQqExpression(value) {
  const normalized = normalizeContactQq(value);
  if (!normalized) return "";
  const headLength = Math.min(3, Math.max(1, normalized.length - 1));
  const head = normalized.slice(0, headLength);
  const tail = normalized.slice(headLength).replace(/^0+(?=\d)/u, "") || "0";
  const factor = 10 ** (normalized.length - headLength);
  return head + " × " + factor + " + " + tail;
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
    ? "可以 我QQ是" + contactQqExpression(normalizedQq) + " 加的时候说下你是谁"
    : contactRefusalReply(count, businessIntent);

  return {
    isRequest: true,
    allowed,
    reply,
    requestCount: count,
    businessIntent,
    contactQq: normalizedQq,
    contactQqDisplay: contactQqExpression(normalizedQq),
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
  const explicitIntimateTopic = /(?:两性|性生活|夫妻生活|做爱|上床|开房|床事|裸照|裸体|黄腔|约炮|约你|见面|出来见|发.{0,3}(?:照片|视频)|拍.{0,3}(?:照片|视频)|交换.{0,3}(?:照片|图)|私密|隐私内容|身体细节)/u.test(recentIncoming);
  const suggestiveIntimateTopic = /(?:(?:让我|我来|给你).{0,3}检查|检查.{0,4}(?:你|身体|干净|洗澡)|洗干净|陪我|想不想我|想我没|梦到我|抱抱|亲亲)/u.test(recentIncoming);
  const affectionateTopic = /(?:好看|漂亮|气质|身材|可爱|有魅力|嘴甜|喜欢你|想你|心动|夸你|养眼)/u.test(recentIncoming);
  if (!relationshipTopic && !explicitIntimateTopic && !suggestiveIntimateTopic && !affectionateTopic) return "";

  if (explicitIntimateTopic) {
    return "【暧昧边界-明确越界】自然拒绝，不接性细节、不约见、不交换照片或视频、不聊隐私内容；用一句带过并收线，不解释、不说教。";
  }
  if (suggestiveIntimateTopic) {
    return "【暧昧边界-暗示】轻挡一次后停，不顺着想象，也不追问答细节；例如“别闹 聊点正常的”，语气自然，不说教。";
  }
  if (affectionateTopic) {
    return "【暧昧边界-轻度】对方只是夸赞、嘴甜或说想你，可以自然接一句，但不主动加码、不调情升级；对方继续追问就轻松带过。";
  }

  const level = Number(stage || 0);
  if (level <= 1) {
    return "【家庭边界】你们还不熟。只可简短确认已婚等基本事实，不展开老公、公婆或夫妻矛盾，不装熟、不抱怨婚姻。";
  }
  if (level === 2) {
    return "【家庭边界】可以自然聊聚少离多、关系一般等感受，但不把家庭矛盾当主要话题，不连续倾诉。";
  }
  return "【家庭边界】比较熟可以聊一般家庭感受，但仍不主动倒苦水，不用家庭矛盾换取亲近。";
}

export function isExplicitBusinessIntent(value) {
  const text = String(value || "").replace(/\s+/gu, "");
  const explicit = /(?:还|现在).{0,8}收(?:手机|旧手机)?|收手机|收旧手机|回收|上门.{0,6}(?:收|取)|换机|旧手机|闲置设备|手机.{0,6}(?:卖|出|处理)|(?:咨询|问问).{0,8}(?:回收|收手机)/u.test(text);
  const deviceIntent = /(?:iphone|苹果|华为|小米|荣耀|oppo|vivo|三星|一加|红米|魅族|真我|\d{1,2}\s*(?:pro|max|plus|ultra))/iu.test(text) &&
    /(?:出|收|卖|换|自用|处理|报价|价格|多少钱|型号|回收)/u.test(text);
  return explicit || deviceIntent;
}

const BUSINESS_DEVICE = "(?:手机|旧机|新机|二手机|设备|iphone|苹果|华为|小米|荣耀|oppo|vivo|三星|一加|红米|魅族|真我|\\d{1,2}\\s*(?:pro|max|plus|ultra))";
const BUSINESS_ACTION = "(?:回收|上门(?:收|取)|报价|验机|出手|出不出|准备出|卖|收|换机|处理|价格|多少钱|型号|机型|自用|闲置|能收)";
const BUSINESS_DRIFT_PATTERN = new RegExp(`(?:${BUSINESS_DEVICE}[^，,。!?！？\\n|]{0,20}${BUSINESS_ACTION}|${BUSINESS_ACTION}[^，,。!?！？\\n|]{0,20}${BUSINESS_DEVICE})`, "iu");
const BUSINESS_DRIFT_TAIL = new RegExp(`(?:[。!?！？]|\\s)(?:你|那|对了)?[^，,。!?！？\\n|]{0,20}${BUSINESS_DEVICE}[^，,。!?！？\\n|]{0,24}${BUSINESS_ACTION}[^，,。!?！？\\n|]*`, "giu");

export function sanitizeBusinessTopicDrift(value, incomingText) {
  const reply = String(value || "").trim();
  if (!reply || isExplicitBusinessIntent(incomingText)) return reply;
  const withoutOldDeviceHook = reply.replace(BUSINESS_DRIFT_TAIL, "");
  const kept = withoutOldDeviceHook
    .split(/\|\|\||\r?\n/u)
    .map((part) => part.trim())
    .filter((part) => part && !BUSINESS_DRIFT_PATTERN.test(part));
  if (kept.length) return kept.join("|||");
  return /(?:累|难|烦|压力|严|不能做|不容易|郁闷|心情不好)/u.test(String(incomingText || ""))
    ? "嗯 听着确实挺累的"
    : "嗯 我在听 你继续说";
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

function promptHour(currentDatetime) {
  const match = String(currentDatetime || "").match(/(?:^|\s)(\d{1,2}):/u);
  const hour = Number(match?.[1]);
  return Number.isFinite(hour) ? hour : -1;
}

export function classifyConversationTurn(messages, messageType = "") {
  const incoming = latestIncomingText(messages);
  if (!incoming) return "empty";
  if (messageType === "business" || isExplicitBusinessIntent(incoming)) return "business";
  if (/(?:多大|几岁|年龄|哪年生的)/u.test(incoming)) return "age";
  if (/(?:做什么工作|干什么工作|做什么的|干什么的|你的职业|你是做哪行)/u.test(incoming)) return "work";
  if (/(?:住在哪|哪里的|哪个城市|家在哪|你在什么地方)/u.test(incoming)) return "location";
  if (messageType === "greeting" || /(?:在吗|在不在|你好|嗨|哈喽|早上好|中午好|下午好|晚上好|干嘛呢|干什么|睡了吗|还没睡)|\b(?:hello|hi)\b/iu.test(incoming)) {
    return "greeting";
  }
  if (messageType === "emotion" || /(?:心情|难受|不开心|烦|好累|累死|孤独|委屈|压力大)/u.test(incoming)) return "emotion";
  if (/(?:图片|照片|表情|语音|动态|互动|拍一拍|戳一戳)/u.test(incoming)) return "media";
  return "normal";
}

export function buildTurnBrief({
  messages = [],
  historyMessages = [],
  messageDelay = null,
  relationStageLevel = 1,
  currentDatetime = "",
}) {
  const incoming = latestIncomingText(messages);
  const turnType = classifyConversationTurn(messages, messageDelay?.messageType);
  const hour = promptHour(currentDatetime);
  let scene = "普通聊天";
  let direction = "先回应对方最新说的事，抓住一个具体点自然接一句；有合适的切入点再带一个相关问题，没有就停住。";
  let avoid = "不要像答题卡逐项回答，不要总结说教，也不要每轮都用“你呢”“在干嘛”硬找话题。";

  if (turnType === "greeting") {
    scene = "问候或确认你在不在";
    direction = "先用“你好呀”“你也好”这类自然回应接住问候，通常只回1句，最多再顺着场景问一句。"
      + ((hour >= 23 || (hour >= 0 && hour < 7)) ? "深夜时不要汇报自己正在做什么。" : "");
    avoid = "不要只回“咋啦”，也不要固定“你好+我在做什么+你怎么还没睡”三连。";
  } else if (turnType === "age") {
    scene = "对方询问年龄";
    direction = "按既定人设直接回答，随后可以自然补一句“你呢”把话题递回去，不展开个人生活。";
    avoid = "不要回避年龄，也不要长篇介绍自己。";
  } else if (turnType === "work") {
    scene = "对方明确询问职业";
    direction = "自然说明做手机数码回收、平时线上沟通，最多再补一句与问题直接相关的话；不马上推销。";
    avoid = "不要主动问对方有没有手机要卖，也不要展开报价、型号和上门流程。";
  } else if (turnType === "location") {
    scene = "对方询问位置";
    direction = "只回答对方问到的城市和区域，语气自然，不额外扩展行程。";
    avoid = "不要主动补充工作地点或编造当前位置。";
  } else if (turnType === "emotion") {
    scene = "对方在表达情绪或分享状态";
    direction = "先接住情绪，再顺着对方刚说的具体原因聊一句，让话题停在对方身上。";
    avoid = "不要马上转到自己的经历，也不要把话题拐到手机或业务。";
  } else if (turnType === "business") {
    scene = "对方主动聊手机、换机或回收";
    direction = "先直接回答对方问的业务问题，最多补一个推进所需的实际问题；不报价、不催单。";
    avoid = "不要扩展成产品介绍，不要主动追问对方要不要卖。";
  } else if (turnType === "media") {
    scene = "对方发来图片、语音、表情或动态";
    direction = "有文字时优先接文字；只有媒体没有文字时，再依据已经识别出的事实自然回应。";
    avoid = "不要逐项播报媒体类型，也不要为了显得热情硬猜内容。";
  }

  const currentUserMessages = messages.filter((message) => message?.role === "user");
  if (currentUserMessages.length > 1) {
    direction += " 对方连续发了几句时，先处理最新、最需要回应的一句；同一话题可合并回答。";
  }
  if (Number(relationStageLevel || 0) === 1 && turnType !== "business") {
    avoid += " 你们还不熟，这次不要提工作、手机或回收。";
  }

  const lines = [
    "【本轮接话】",
    "场景：" + scene + "。",
    "接法：" + direction,
    "避免：" + avoid,
  ];
  if (messageDelay?.prompt) lines.push("时间关系：" + messageDelay.prompt);
  if (historyMessages.some((message) => message?.role === "assistant")) {
    lines.push(replyOpeningHint(historyMessages));
  }
  return lines.join("\n");
}

export function replyGenerationSettings(messages, messageDelay, config) {
  const text = latestIncomingText(messages);
  const messageType = messageDelay?.messageType || "normal";
  const simpleGreeting = messageType === "greeting" && text.length <= 12;
  const complex = messageType === "business" || messageDelay?.pastMode || text.length > 40 ||
    /(?:图片|语音|截图|型号|多少钱|价格|地址|工作)/u.test(text);
  const requestedMax = simpleGreeting ? 40 : complex ? 96 : 64;
  const configuredTemperature = Number(config?.temperature);
  const baseTemperature = Number.isFinite(configuredTemperature)
    ? Math.max(0, Math.min(2, configuredTemperature))
    : 0.8;
  const requestedTemperature = messageDelay?.pastMode ? 0.5 : complex ? 0.68 : 0.85;
  return {
    maxTokens: Math.max(16, Math.min(Number(config.maxTokens || 160), requestedMax)),
    temperature: Math.min(baseTemperature, requestedTemperature),
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
  homeLocation,
  workLocation,
  weather,
  weatherEnabled = true,
  timeEnabled = true,
  stageText,
  relationStageLevel,
  messageDelay,
  messages,
  historyMessages,
  conversationTimeline = "",
  memorySummary = "",
}) {
  const newContact = Number(relationStageLevel || 0) === 1;
  const incoming = latestIncomingText(messages);
  const fixed = [
    String(personaPrompt || "").trim(),
    "【交流方式】像熟人微信聊天，优先短句。普通消息通常回1句，必要时才多补1句；只有对方内容较长、明确追问或需要说明业务时才多说。不要客服腔、AI腔、总结或说教。",
    "【事实与边界】不编造用户没提供过的经历、行程和状态。不主动暧昧、不主动提见面、不主动给联系方式、不主动报价或催单。被质疑AI时自然带过。",
    "【连续记忆】同一客户绑定多个平台账号时按同一个人延续聊天，不要说忘记其他平台聊过什么。",
    newContact ? "【新客节奏】你们还不熟。对方没主动聊手机、换机或回收时，不要提工作或业务。" : "",
  ].filter(Boolean);

  const locationContext = "你住在" + homeLocation.city + homeLocation.district + "，工作地在" + workLocation.city + workLocation.district + "。";
  const weatherRelevant = /(?:天气|下雨|下雪|气温|温度|冷|热|晴|阴|风)/u.test(incoming);
  const dynamic = [
    "【当前平台】" + platform + "。",
    profileContext ? "【长期客户档案】" + profileContext : "",
    memorySummary ? "【较早聊天记忆】" + memorySummary : "",
    timeEnabled ? "【当前时间】" + currentDatetime + "（" + weekday + "）。" : "",
    "【地址】" + locationContext,
    weatherEnabled && weather && weatherRelevant
      ? "【当前天气】今天" + weather.condition + weather.temp + "度。"
      : "",
    "【关系阶段】" + stageText,
    conversationTimeline ? "【未回复消息时间线】" + conversationTimeline : "",
  ].filter(Boolean);

  const turnPrompt = buildTurnBrief({
    messages,
    historyMessages,
    messageDelay,
    relationStageLevel,
    currentDatetime,
  });
  const relationshipPrompt = buildRelationshipBoundaryPrompt(relationStageLevel, incoming, historyMessages);

  return [
    "【固定人设】\n" + fixed.join("\n"),
    "【当前上下文】\n" + dynamic.join("\n"),
    turnPrompt,
    relationshipPrompt ? "【即时边界】" + relationshipPrompt : "",
  ].filter(Boolean).join("\n\n");
}
