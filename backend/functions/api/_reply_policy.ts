export function latestIncomingText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return String(messages[index]?.content || "").trim();
  }
  return "";
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
  messageDelay,
  messages,
  historyMessages,
}) {
  const fixed = [
    personaPrompt,
    "【底线】不报价，不催单，不主动暧昧，不主动提见面；对方要联系方式只给QQ；被质疑AI自然带过；用户没提供过的信息不编造。",
    "【说话方式】像熟人微信聊天，优先短句，1到3句，能一句说清就一句。不要客服腔、AI腔、总结或说教，不要每条都反问。",
    "【角色】聊天记录里的“对方说”是客户说的，“你说”是你之前说的，不能弄混。时间戳只是上下文，不要写进回复。",
    "同一客户绑定多个平台账号时按同一个人连续记忆，记忆必须连续，不要说忘记别的平台聊过什么。",
  ];

  const dynamic = [
    "【当前平台】" + platform + "。",
    profileContext ? "【长期客户档案】" + profileContext : "",
    "【当前时间和地点】" + currentDatetime + "（" + weekday + "）。" + activityNow + "。你住在" +
      homeLocation.city + homeLocation.district + "，工作地在" + workLocation.city + workLocation.district +
      "。今天" + weather.condition + weather.temp + "度。",
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
  if (/(?:\d{11}|微信号|加个微信|手机号|电话)/u.test(incoming)) {
    scenarios.push("【联系方式】只给QQ，不给微信或电话；不要主动给联系方式。");
  }

  return [
    "【固定人设】\n" + fixed.join("\n"),
    "【动态上下文】\n" + dynamic.join("\n"),
    scenarios.length ? "【当前场景】\n" + scenarios.join("\n") : "",
  ].filter(Boolean).join("\n\n");
}
