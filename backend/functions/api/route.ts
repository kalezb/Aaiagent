import {
  buildLayeredSystemPrompt,
  countContactRequests,
  latestIncomingText,
  loadOrCreatePendingReply,
  localVoiceRequestReply,
  replyGenerationSettings,
  resolveContactRequestPolicy,
  sanitizeContactDisclosure,
  sanitizeNewContactBusinessReply,
} from "./_reply_policy";

const SUPPORTED_PLATFORMS = ["soul", "qq", "immomo", "lianxin"];
const DEFAULT_LLM_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_DEVICE_SETTINGS = Object.freeze({
  platform: "soul",
  hosting_enabled: false,
  monitor_enabled: true,
  weather_enabled: true,
  time_enabled: true,
});

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

function isDashboardAuthorized(request, env) {
  const expected = env.DASHBOARD_PASSWORD || "";
  const supplied = request.headers.get("X-Dashboard-Password") || "";
  return Boolean(expected) && supplied === expected;
}

async function validateToken(db, authHeader) {
  const token = (authHeader || "").replace("Bearer ", "");
  if (!token) return null;
  const row = await db.prepare("SELECT token, is_active, monthly_limit, spent, spent_month, active_persona_id FROM tokens WHERE token = ?").bind(token).first();
  return (row && row.is_active !== 0) ? row : null;
}

function normalizePlatform(value, fallback = "") {
  const platform = String(value || "").trim().toLowerCase();
  return SUPPORTED_PLATFORMS.includes(platform) ? platform : fallback;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

function currentMonthKey(epochSeconds = Math.floor(Date.now() / 1000)) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CHINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).format(new Date(epochSeconds * 1000));
}

async function enforceTokenBudget(db, tokenRow) {
  const nowSec = Math.floor(Date.now() / 1000);
  const month = currentMonthKey(nowSec);
  let spent = Number(tokenRow?.spent || 0);
  if (String(tokenRow?.spent_month || "") !== month) {
    spent = 0;
    await db.prepare("UPDATE tokens SET spent = 0, spent_month = ? WHERE token = ?")
      .bind(month, tokenRow.token).run();
  }
  const limit = Number(tokenRow?.monthly_limit ?? 30);
  return {
    allowed: !Number.isFinite(limit) || limit < 0 || spent < limit,
    spent,
    limit,
    month,
  };
}

function estimateLlmCost({ usage, inputChars = 0, outputChars = 0 }, env) {
  const inputRate = Math.max(0, Number(env?.LLM_INPUT_COST_PER_MILLION ?? 2) || 0);
  const outputRate = Math.max(0, Number(env?.LLM_OUTPUT_COST_PER_MILLION ?? 8) || 0);
  const promptTokens = Math.max(0, Number(usage?.prompt_tokens || usage?.input_tokens || inputChars / 1.8));
  const completionTokens = Math.max(0, Number(usage?.completion_tokens || usage?.output_tokens || outputChars / 1.8));
  const cost = (promptTokens * inputRate + completionTokens * outputRate) / 1_000_000;
  return Math.max(0.001, Number(cost.toFixed(6)));
}

async function recordTokenUsage(db, token, cost) {
  const nowSec = Math.floor(Date.now() / 1000);
  const month = currentMonthKey(nowSec);
  const amount = Math.max(0, Number(cost || 0));
  await db.prepare(
    "UPDATE tokens SET last_used_at = ?, " +
    "spent = CASE WHEN spent_month = ? THEN spent + ? ELSE ? END, " +
    "spent_month = ? WHERE token = ?"
  ).bind(nowSec, month, amount, amount, month, token).run();
}

async function parseJsonBody(request, maxBytes = 64 * 1024) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { error: "request_too_large", status: 413 };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { error: "request_too_large", status: 413 };
  }
  try {
    return { body: text ? JSON.parse(text) : {} };
  } catch (_) {
    return { error: "invalid_json", status: 400 };
  }
}

function validateChatMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 40) return false;
  let totalChars = 0;
  for (const message of messages) {
    const role = String(message?.role || "");
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    if (!["user", "assistant"].includes(role) || !content || content.length > 4000) return false;
    totalChars += content.length;
  }
  return totalChars <= 24_000;
}

async function enforceChatRateLimit(db, token, limitPerMinute = 30) {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSec / 60) * 60;
  const row = await db.prepare(
    "SELECT window_start, request_count FROM request_limits WHERE token = ? AND scope = 'chat' LIMIT 1"
  ).bind(token).first();
  if (row && Number(row.window_start || 0) === windowStart && Number(row.request_count || 0) >= limitPerMinute) {
    return { allowed: false, windowStart, requestCount: Number(row.request_count || 0) };
  }
  if (row && Number(row.window_start || 0) === windowStart) {
    await db.prepare("UPDATE request_limits SET request_count = request_count + 1 WHERE token = ? AND scope = 'chat'")
      .bind(token).run();
  } else {
    await db.prepare(
      "INSERT INTO request_limits (token, scope, window_start, request_count) VALUES (?, 'chat', ?, 1) " +
      "ON CONFLICT(token, scope) DO UPDATE SET window_start = excluded.window_start, request_count = 1"
    ).bind(token, windowStart).run();
  }
  const requestCount = row && Number(row.window_start || 0) === windowStart ? Number(row.request_count || 0) + 1 : 1;
  return { allowed: true, windowStart, requestCount };
}

const LLM_CONFIG_CACHE_MS = 5 * 60 * 1000;
const llmConfigCache = new WeakMap();

function normalizeLlmBaseUrl(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^\s]+$/iu.test(text)) return "";
  return text;
}

async function loadLlmConfig(kv, env) {
  const cached = llmConfigCache.get(kv);
  const now = Date.now();
  if (cached && now - cached.cachedAt < LLM_CONFIG_CACHE_MS) return cached.value;
  const [temperatureValue, maxTokensValue, modelNameValue, baseUrlValue] = await Promise.all([
    kv.get("llm:temperature"),
    kv.get("llm:max_tokens"),
    kv.get("llm:model"),
    kv.get("llm:base_url"),
  ]);
  const parsedTemperature = parseFloat(temperatureValue);
  const parsedMaxTokens = parseInt(maxTokensValue, 10);
  const value = {
    temperature: Number.isFinite(parsedTemperature) ? parsedTemperature : 0.8,
    maxTokens: Number.isFinite(parsedMaxTokens) ? parsedMaxTokens : 160,
    modelName: modelNameValue || "deepseek-chat",
    baseUrl: normalizeLlmBaseUrl(baseUrlValue) || normalizeLlmBaseUrl(env?.DEEPSEEK_API_BASE) || DEFAULT_LLM_BASE_URL,
  };
  llmConfigCache.set(kv, { cachedAt: now, value });
  return value;
}

function latestIncomingText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return String(messages[index]?.content || "").trim();
  }
  return "";
}

function localAiChallengeReply(messages, requestId) {
  const text = latestIncomingText(messages);
  if (!/(?:你是不是|你是|不会真是|该不会是)?\s*(?:ai|AI|机器人|人工智能|真人吗|真人么)/u.test(text)) return "";
  const replies = [
    "啊 我像机器人吗",
    "哈哈 你是不是被AI客服坑多了",
    "你这话问得我都不好接了",
  ];
  let hash = 0;
  for (const char of requestId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return replies[hash % replies.length];
}

async function getWeather(city, kv, apiKey) {
  try {
    const cached = await kv.get("weather:cache", "json");
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.city === city && cached.updated_at && now - cached.updated_at < 1800) {
      return { condition: cached.condition || "晴", temp: cached.temp || 20 };
    }
    const geoUrl = "https://geoapi.qweather.com/v2/city/lookup?location=" + encodeURIComponent(city) + "&key=" + apiKey;
    const geoResp = await fetch(geoUrl);
    const geoData = await geoResp.json();
    if (!geoData.location || geoData.location.length === 0) return { condition: "晴", temp: 20 };
    const locationId = geoData.location[0].id;
    const weatherUrl = "https://devapi.qweather.com/v7/weather/now?location=" + locationId + "&key=" + apiKey;
    const weatherResp = await fetch(weatherUrl);
    const weatherData = await weatherResp.json();
    const condition = weatherData.now?.text || "晴";
    const temp = parseInt(weatherData.now?.temp || "20");
    await kv.put("weather:cache", JSON.stringify({ city, temp, condition, updated_at: now }));
    return { condition, temp };
  } catch (e) { return { condition: "晴", temp: 20 }; }
}

const CHINA_TIME_ZONE = "Asia/Shanghai";

function getChinaTimeContext(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: CHINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    currentDatetime: value("year") + "-" + value("month") + "-" + value("day") + " " +
      value("hour") + ":" + value("minute") + ":" + value("second"),
    weekday: value("weekday"),
  };
}

function formatChinaMessageTime(epochSeconds) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: CHINA_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(epochSeconds * 1000));
}

function requestMessageEpochSeconds(message) {
  const raw = Number(message?.created_at || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 1_000_000_000_000 ? Math.floor(raw / 1000) : Math.floor(raw);
}

function formatChinaClock(epochSeconds) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: CHINA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(epochSeconds * 1000));
}

function formatChineseDuration(seconds) {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  if (totalMinutes < 60) return totalMinutes + " 分钟";
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) return totalHours + " 小时" + (minutes ? " " + minutes + " 分" : "");
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days + " 天" + (hours ? " " + hours + " 小时" : "");
}

function classifyIncomingMessage(value) {
  const text = String(value || "");
  if (/(?:还|现在)收(?:手机|旧手机)?|收手机|收旧手机|回收|上门|换机|旧手机|手机.*(?:卖|出)/u.test(text)) return "business";
  if (/(?:(?:明天|今天|今晚|下午|晚上|周末|晚点).*(?:有空|见|约|来|吃饭)|有空吗|见个面)/u.test(text)) return "expired_invite";
  if (/(?:晚安|睡了|睡不着)/u.test(text)) return "night";
  if (/(?:在吗|在不在|你好|嗨|哈喽|早上好|中午好|下午好|晚上好|干嘛呢|干什么)|\b(?:hello|hi)\b/iu.test(text)) return "greeting";
  if (/(?:心情|难受|不开心|烦|好累|孤独|想你)/u.test(text)) return "emotion";
  return "normal";
}

export function getMessageDelayPolicy(message, nowSec = Math.floor(Date.now() / 1000)) {
  const epoch = requestMessageEpochSeconds(message);
  const messageType = classifyIncomingMessage(message?.content);
  if (!epoch) return {
    hasTimestamp: false,
    ageSeconds: null,
    level: "unknown",
    messageType,
    pastMode: false,
    prompt: "对方消息没有可靠发送时间。不要默认说刚刚、刚看到、这个点或刚忙完，只根据消息内容回复。",
  };

  const ageSeconds = Math.max(0, nowSec - epoch);
  let level = "immediate";
  if (ageSeconds > 5 * 60 && ageSeconds <= 30 * 60) level = "short_wait";
  else if (ageSeconds > 30 * 60 && ageSeconds <= 2 * 3600) level = "acknowledge";
  else if (ageSeconds > 2 * 3600 && ageSeconds <= 6 * 3600) level = "explicit_delay";
  else if (ageSeconds > 6 * 3600 && ageSeconds <= 24 * 3600) level = "dayparted";
  else if (ageSeconds > 24 * 3600 && ageSeconds <= 3 * 86400) level = "past_1_3d";
  else if (ageSeconds > 3 * 86400 && ageSeconds <= 7 * 86400) level = "past_4_7d";
  else if (ageSeconds > 7 * 86400 && ageSeconds <= 30 * 86400) level = "past_7_30d";
  else if (ageSeconds > 30 * 86400) level = "past_over_30d";

  const timing = "对方发：" + formatChinaClock(epoch) + "，现在：" + formatChinaClock(nowSec) + "，已隔 " + formatChineseDuration(ageSeconds) + "。";
  const pastMode = ageSeconds > 24 * 3600;
  if (level === "immediate") return { hasTimestamp: true, ageSeconds, level, messageType, pastMode, prompt: "" };
  if (level === "short_wait") return {
    hasTimestamp: true,
    ageSeconds,
    level,
    messageType,
    pastMode,
    prompt: timing + "自然接话，不强调等待。",
  };
  if (level === "acknowledge") return {
    hasTimestamp: true,
    ageSeconds,
    level,
    messageType,
    pastMode,
    prompt: timing + "必要时可以自然说刚看到，不要解释具体忙什么。",
  };
  if (level === "explicit_delay") return {
    hasTimestamp: true,
    ageSeconds,
    level,
    messageType,
    pastMode,
    prompt: timing + "必须承认已经隔了一段时间，禁止问“这个点还没睡”或暗示消息刚收到。",
  };
  if (level === "dayparted") return {
    hasTimestamp: true,
    ageSeconds,
    level,
    messageType,
    pastMode,
    prompt: timing + "说明时可以说刚看到你早上、下午或昨晚发的，不要虚构刚忙完，也不要说刚起床、刚睡醒、刚醒。",
  };

  let typeRule = "这是旧消息，只回应原话中现在仍成立的内容，不逐条补答，也不编造这几天在做什么。";
  if (messageType === "business") {
    typeRule = "这是仍可能有效的回收问题，可以简短回答；先承认看过旧消息，例如“刚看到你前几天问的”，再回答当前是否还能处理。";
  } else if (messageType === "expired_invite") {
    typeRule = "这是已经失效的邀约，不能回答明天可以、有空、到时候或好啊；改成“那会儿没看到 你现在还有事吗”。";
  } else if (messageType === "night") {
    typeRule = "不要隔几天补一句晚安、早点睡或追问当时状态，只简短回应对方现在是否还好。";
  } else if (messageType === "emotion") {
    typeRule = "不要假装当时就在陪聊，只简短问问对方现在是否还好。";
  } else if (messageType === "greeting") {
    typeRule = "可以简短回“在的 刚看到你前几天发的”，不要装作刚刚收到。";
  }
  if (level === "past_4_7d") typeRule = "只说隔了几天才看到，不编造这几天做了什么。" + typeRule;
  if (level === "past_7_30d" || level === "past_over_30d") typeRule = "消息已经过去较久，谨慎回复，不追问已经失效的话题。" + typeRule;
  if (level === "past_over_30d" && messageType !== "business" && messageType !== "normal") typeRule = "这更像一条已经失效的旧消息，优先跳过式处理，只做最简单的回应。" + typeRule;
  return {
    hasTimestamp: true,
    ageSeconds,
    level,
    messageType,
    pastMode,
    prompt: timing + "已进入过去模式。禁止说刚起床、刚睡醒、刚醒。" + typeRule,
  };
}

function resolveIncomingDelayPolicy(messages, historyMessages, nowSec) {
  let incomingIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      incomingIndex = index;
      break;
    }
  }
  if (incomingIndex < 0) return null;
  const incoming = messages[incomingIndex];
  const direct = getMessageDelayPolicy(incoming, nowSec);
  if (direct.hasTimestamp) return { ...direct, inferredTimestamp: false };

  let visibleTime = 0;
  for (let index = incomingIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "user") continue;
    visibleTime = requestMessageEpochSeconds(messages[index]);
    if (visibleTime) break;
  }
  if (!visibleTime) {
    for (let index = historyMessages.length - 1; index >= 0; index -= 1) {
      if (historyMessages[index]?.role !== "user") continue;
      visibleTime = requestMessageEpochSeconds(historyMessages[index]);
      if (visibleTime) break;
    }
  }
  if (!visibleTime) return { ...direct, inferredTimestamp: false };
  const inferred = getMessageDelayPolicy({ ...incoming, created_at: visibleTime }, nowSec);
  return {
    ...inferred,
    inferredTimestamp: true,
    prompt: "当前消息没有显示时间，按最近可见的对方发送时间判断。" + inferred.prompt,
  };
}

function staleReplyFallback(policy) {
  if (!policy?.hasTimestamp) return "";
  if (policy.pastMode) {
    if (policy.messageType === "business") return "刚看到你前几天问的 还收的 你现在要处理吗";
    if (policy.messageType === "expired_invite") return "那会儿没看到 你现在还有事吗";
    if (policy.messageType === "night" || policy.messageType === "emotion") return "刚看到你前几天发的 最近还好吧";
    return "刚看到你前几天发的";
  }
  return "在的 刚看到";
}

function cleanStaleReplySegment(value, policy) {
  let reply = String(value || "").trim();
  if (!reply || !policy?.hasTimestamp) return reply;
  if (policy.pastMode && policy.messageType === "expired_invite" && /(?:明天|今天|晚点|周末|到时候|我有空|可以|好啊)/u.test(reply)) {
    return staleReplyFallback(policy);
  }
  if (policy.pastMode && (policy.messageType === "night" || policy.messageType === "emotion") && /^(?:晚安|早点休息|睡吧|我睡了)[啊呀吧。！!]*$/u.test(reply)) {
    return staleReplyFallback(policy);
  }
  if (Number(policy.ageSeconds || 0) >= 2 * 3600) {
    reply = reply
      .replace(/(?:你|你这边)?(?:怎么|还|这么晚)?这个点(?:还)?(?:没睡|不睡|醒着)(?:吗)?/gu, "")
      .replace(/(?:大)?半夜(?:还)?(?:不睡|没睡|醒着)(?:吗)?/gu, "")
      .replace(/这么晚(?:还)?(?:没睡|不睡|醒着)(?:吗)?/gu, "");
  }
  if (policy.pastMode) {
    reply = reply
      .replace(/(?:我)?刚忙完/gu, "")
      .replace(/(?:我)?刚到家/gu, "")
      .replace(/(?:我)?刚看到(?:你)?(?:的)?消息/gu, "")
      .replace(/(?:我)?刚刚看到/gu, "")
      .replace(/(?:你)?现在还在外面吗/gu, "")
      .replace(/(?:我)?这几天(?:一直)?在忙/gu, "");
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

function formatCurrentChatMessage(message, nowSec = Math.floor(Date.now() / 1000)) {
  const epoch = requestMessageEpochSeconds(message);
  const speaker = message?.role === "assistant" ? "你说" : "对方说";
  let timeLabel = String(message?.timestamp || "").trim() || (epoch ? formatChinaMessageTime(epoch) : "");
  if (epoch > 0 && message?.role === "user") {
    const ageHours = Math.max(0, Math.floor((nowSec - epoch) / 3600));
    if (ageHours >= 24) timeLabel += "，距今约" + ageHours + "小时";
  }
  return (timeLabel ? "[" + timeLabel + "] " : "") + speaker + "：" + String(message?.content || "");
}

function sanitizeAssistantReply(value) {
  return String(value || "")
    .split(/(\r?\n|\|\|\|)/u)
    .map((part) => part === "\n" || part === "\r\n" || part === "|||" ? part : sanitizeAssistantReplySegment(part))
    .filter((part) => part.length > 0)
    .join("");
}

function sanitizeAssistantReplySegment(value) {
  let reply = String(value || "").trim();
  const contextPrefix = /^\[[^\]\r\n]{1,100}\]\s*(?:你说|对方说|我说|对方|我)\s*[：:]\s*/u;
  const speakerPrefix = /^(?:你说|对方说|我说|对方|我)\s*[：:]\s*/u;
  // The bracket only needs a clock-like token to be treated as leaked context.
  const timestampPrefix = /^\[[^\]\r\n]{0,100}(?::\d{2}|距今约\d+小时)[^\]\r\n]{0,100}\]\s*/u;

  // Only strip labels at a segment start. Normal phrases such as “你说呢” stay intact.
  while (reply) {
    const before = reply;
    reply = reply
      .replace(contextPrefix, "")
      .replace(speakerPrefix, "")
      .replace(timestampPrefix, "")
      .trimStart();
    if (reply === before) break;
  }
  return reply.trim();
}

// 根据当前小时给出"我此刻在干嘛"，让回复场景跟时间对得上（凌晨不说在跑客户）
function currentActivityByHour(hour) {
  if (hour >= 0 && hour < 7) return "现在是深夜，你在家休息，偶尔看下手机";
  if (hour >= 7 && hour < 9) return "你早上在家，刚收拾好，手机放旁边";
  if (hour >= 9 && hour < 12) return "你在忙自己的事，间隙会看下手机";
  if (hour >= 12 && hour < 14) return "你中午刚吃完饭，在休息";
  if (hour >= 14 && hour < 18) return "你下午在忙，不一定随时看手机";
  if (hour >= 18 && hour < 21) return "你晚上回到家，吃完饭在休息";
  return "你在家休息，准备洗漱";
}

// 统计这个联系人最近7天主动找过你几次、几天都来了，以及总对话轮数
async function loadActivityStats(db, token, aliases, nowSec) {
  const clauses = aliases.map(() => "(platform = ? AND contact_id = ?)");
  const flat = aliases.flatMap((a) => [a.platform, a.contact_id]);
  const since = nowSec - 7 * 86400;
  const recent = await db.prepare(
    "SELECT COUNT(*) AS total, COUNT(DISTINCT DATE(created_at, 'unixepoch', 'localtime')) AS active_days FROM chat_history WHERE token = ? AND role = 'user' AND (" + clauses.join(" OR ") + ") AND created_at > ?"
  ).bind(token, ...flat, since).first();
  const total = await db.prepare(
    "SELECT COUNT(*) AS n FROM chat_history WHERE token = ? AND (" + clauses.join(" OR ") + ")"
  ).bind(token, ...flat).first();
  return {
    activeDays: Number(recent?.active_days || 0),
    userMsgs7d: Number(recent?.total || 0),
    totalExchanges: Number(total?.n || 0),
  };
}

// 关系阶段：1=刚加上 2=聊过几次 3=高频互动可谈业务
function relationStage(totalExchanges, userMsgs7d) {
  if (totalExchanges < 6) return 1;
  if (totalExchanges < 25) return 2;
  if (userMsgs7d >= 4) return 3;
  return 2;
}

async function maybeExtractCustomerProfile(env, tokenRow, platform, contactId) {
  if (!env.DEEPSEEK_API_KEY) return;
  const token = tokenRow.token;
  const budget = await enforceTokenBudget(env.DB, tokenRow);
  if (!budget.allowed) return;
  const groupId = await resolveProfileGroup(env.DB, token, platform, contactId);
  const existing = await loadCustomerProfile(env.DB, token, groupId);
  const aliases = [{ platform, contact_id: contactId }];
  if (!groupId.startsWith("single:")) {
    const { results } = await env.DB.prepare(
      "SELECT platform, contact_id FROM contact_links WHERE token = ? AND group_id = ? ORDER BY created_at"
    ).bind(token, groupId).all();
    if (results?.length) aliases.splice(0, aliases.length, ...results);
  }
  const clauses = aliases.map(() => "(platform = ? AND contact_id = ?)");
  const aliasParams = aliases.flatMap((alias) => [alias.platform, alias.contact_id]);
  const state = await env.DB.prepare(
    "SELECT COUNT(*) AS user_count, MAX(id) AS max_id FROM chat_history WHERE token = ? AND role = 'user' AND (" + clauses.join(" OR ") + ") AND id > ?"
  ).bind(token, ...aliasParams, existing.last_processed_message_id).first();
  if (Number(state?.user_count || 0) < 40) return;
  const { results } = await env.DB.prepare(
    "SELECT id, content, created_at FROM chat_history WHERE token = ? AND role = 'user' AND (" + clauses.join(" OR ") + ") AND id > ? ORDER BY id ASC LIMIT 240"
  ).bind(token, ...aliasParams, existing.last_processed_message_id).all();
  const candidates = (results || [])
    .map((row) => ({ id: Number(row.id || 0), content: String(row.content || "").trim(), created_at: Number(row.created_at || 0) }))
    .filter((row) => profileCandidateText(row.content))
    .slice(-80);
  const processedMaxId = (results || []).reduce(
    (max, row) => Math.max(max, Number(row?.id || 0)),
    existing.last_processed_message_id
  );
  const now = Math.floor(Date.now() / 1000);
  if (!candidates.length) {
    await env.DB.prepare(
      "INSERT INTO customer_profiles (token, group_id, profile_json, last_processed_message_id, extracted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token, group_id) DO UPDATE SET last_processed_message_id = excluded.last_processed_message_id, extracted_at = excluded.extracted_at, updated_at = excluded.updated_at"
    ).bind(token, groupId, JSON.stringify(existing.profile), processedMaxId, now, now).run();
    return;
  }
  const schema = JSON.stringify(emptyCustomerProfile());
  const candidateLines = candidates.map((row) => `[${formatChinaMessageTime(row.created_at)}] ${row.content.slice(0, 180)}`).join("\n");
  const response = await fetch(((env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1").replace(/\/+$/, "")) + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.DEEPSEEK_API_KEY },
    body: JSON.stringify({
      model: env.PROFILE_MODEL || "deepseek-flash",
      temperature: 0,
      max_tokens: 900,
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "你只负责从客户聊天里提取长期有效的客户资料。不要总结普通聊天，不要猜测。只输出 JSON，不确定的字段留空。数组去重，最多保留 12 项。只按给定结构输出：" + schema },
        { role: "user", content: "已有档案：" + JSON.stringify(existing.profile) + "\n可能含个人信息的聊天片段：\n" + candidateLines },
      ],
    }),
  });
  if (!response.ok) return;
  const data = await response.json();
  await recordTokenUsage(
    env.DB,
    token,
    estimateLlmCost({
      usage: data.usage,
      inputChars: schema.length + candidateLines.length,
      outputChars: String(data.choices?.[0]?.message?.content || "").length,
    }, env)
  );
  const extracted = parseJsonObject(data.choices?.[0]?.message?.content, null);
  if (!extracted || typeof extracted !== "object") return;
  const merged = mergeCustomerProfile(existing.profile, extracted);
  await env.DB.prepare(
    "INSERT INTO customer_profiles (token, group_id, profile_json, last_processed_message_id, extracted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token, group_id) DO UPDATE SET profile_json = excluded.profile_json, last_processed_message_id = excluded.last_processed_message_id, extracted_at = excluded.extracted_at, updated_at = excluded.updated_at"
  ).bind(token, groupId, JSON.stringify(merged), processedMaxId, now, now).run();
}
async function activatePersona(db, personaId) {
  const persona = await db.prepare("SELECT id, name FROM personas WHERE id = ?").bind(personaId).first();
  if (!persona) return null;
  await db.batch([
    db.prepare("UPDATE personas SET is_active = 0"),
    db.prepare("UPDATE personas SET is_active = 1 WHERE id = ?").bind(personaId),
  ]);
  return persona;
}

async function activatePersonaForToken(db, token, personaId) {
  const persona = await db.prepare("SELECT id, name FROM personas WHERE id = ?").bind(personaId).first();
  if (!persona) return null;
  await db.prepare("UPDATE tokens SET active_persona_id = ? WHERE token = ?").bind(personaId, token).run();
  return persona;
}

function formatLocation(row) {
  if (!row) return null;
  return {
    home: { city: row.home_city, district: row.home_district },
    work: { city: row.work_city, district: row.work_district },
  };
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  const text = String(value).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(text); } catch (_) { return fallback; }
}

function emptyCustomerProfile() {
  return {
    basic: { name: "", gender: "", age: "" },
    location: { hometown: "", city: "", residence: "" },
    education: { school: "", major: "", degree: "" },
    work: { company: "", role: "", industry: "" },
    family: { marital_status: "", children: "", notes: "" },
    relationship: { status: "", preferences: "" },
    preferences: { likes: [], dislikes: [], hobbies: [] },
    life: { habits: "", schedule: "" },
    recent: { goals: [], events: [] },
    notes: [],
  };
}

function mergeProfileValue(current, incoming) {
  if (Array.isArray(current) || Array.isArray(incoming)) {
    const values = [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    return [...new Set(values)].slice(-30);
  }
  if (current && incoming && typeof current === "object" && typeof incoming === "object") {
    const merged = { ...current };
    for (const [key, value] of Object.entries(incoming)) {
      merged[key] = mergeProfileValue(merged[key], value);
    }
    return merged;
  }
  const text = typeof incoming === "string" ? incoming.trim() : incoming;
  return text === "" || text === null || text === undefined ? current : text;
}

function mergeCustomerProfile(existing, incoming) {
  const base = emptyCustomerProfile();
  const current = mergeProfileValue(base, parseJsonObject(existing, {}));
  return mergeProfileValue(current, parseJsonObject(incoming, {}));
}

const PROFILE_CANDIDATE_PATTERN = /(鎴戝彨|鎴戞槸|濮撳悕|鍚嶅瓧|骞撮緞|浣忓湪|瀹堕噷|鑰佸|鍩庡競|鍦板潃|瀛︽牎|涓撴牚|涓撲笟|鍏徃|涓婄彮|宸ヤ綔|鑱屼笟|琛屼笟|缁撳|绂诲|鑰佸﹩|鑰佸叕|瀛╁瓙|鐢锋湅鍙?|濂虫湅鍙?|鍠滄|涓嶅枩娆?|鐖卞ソ|涔犳儃|鏈€杩?|鎵撶畻|鍑嗗|璁″垝|鐩爣|鐢熸棩|姣曚笟|璁ょ瘑|瑙佽繃)/;

function profileCandidateText(value) {
  const text = String(value || "").trim();
  return text.length >= 2 && text.length <= 240 && /(我叫|我是|姓名|名字|年龄|多大|住在|家里|老家|城市|地址|学校|大学|专业|公司|上班|工作|职业|行业|结婚|离婚|老婆|老公|孩子|男朋友|女朋友|爱好|习惯|最近|打算|准备|计划|目标|生日|毕业|认识|见过|喜欢|不喜欢)/.test(text);
}

async function resolveProfileGroup(db, token, platform, contactId) {
  const link = await db.prepare(
    "SELECT group_id FROM contact_links WHERE token = ? AND platform = ? AND contact_id = ?"
  ).bind(token, platform, contactId).first();
  return link?.group_id || makeSingleGroupId(token, platform, contactId);
}

async function loadCustomerProfile(db, token, groupId) {
  if (!token || !groupId) return { profile: emptyCustomerProfile(), last_processed_message_id: 0, updated_at: 0 };
  const row = await db.prepare(
    "SELECT profile_json, last_processed_message_id, extracted_at, updated_at FROM customer_profiles WHERE token = ? AND group_id = ?"
  ).bind(token, groupId).first();
  if (!row) return { profile: emptyCustomerProfile(), last_processed_message_id: 0, updated_at: 0 };
  return {
    profile: mergeCustomerProfile({}, parseJsonObject(row.profile_json, emptyCustomerProfile())),
    last_processed_message_id: Number(row.last_processed_message_id || 0),
    extracted_at: Number(row.extracted_at || 0),
    updated_at: Number(row.updated_at || 0),
  };
}

function compactProfileForPrompt(value) {
  if (Array.isArray(value)) {
    return value
      .map(compactProfileForPrompt)
      .filter((item) => item !== undefined && item !== null && item !== "")
      .slice(0, 12);
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      const compact = compactProfileForPrompt(child);
      if (compact === undefined || compact === null || compact === "") continue;
      if (Array.isArray(compact) && compact.length === 0) continue;
      if (!Array.isArray(compact) && typeof compact === "object" && Object.keys(compact).length === 0) continue;
      result[key] = compact;
    }
    return result;
  }
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 180) : undefined;
}

function customerProfilePrompt(profile) {
  const compact = compactProfileForPrompt(profile);
  if (!compact || !Object.keys(compact).length) return "";
  return JSON.stringify(compact);
}

async function loadDeviceLocation(db, token) {
  const row = await db.prepare(
    "SELECT home_city, home_district, work_city, work_district FROM user_locations WHERE token = ?"
  ).bind(token).first();
  return formatLocation(row);
}

async function loadDeviceSettings(db, token) {
  const row = await db.prepare(
    "SELECT platform, hosting_enabled, monitor_enabled, weather_enabled, time_enabled FROM device_settings WHERE token = ? LIMIT 1"
  ).bind(token).first();
  if (!row) return { ...DEFAULT_DEVICE_SETTINGS };
  return {
    platform: normalizePlatform(row.platform, DEFAULT_DEVICE_SETTINGS.platform),
    hosting_enabled: parseBoolean(row.hosting_enabled, DEFAULT_DEVICE_SETTINGS.hosting_enabled),
    monitor_enabled: parseBoolean(row.monitor_enabled, DEFAULT_DEVICE_SETTINGS.monitor_enabled),
    weather_enabled: parseBoolean(row.weather_enabled, DEFAULT_DEVICE_SETTINGS.weather_enabled),
    time_enabled: parseBoolean(row.time_enabled, DEFAULT_DEVICE_SETTINGS.time_enabled),
  };
}

async function saveDeviceSetting(db, token, field, value) {
  const allowedFields = new Set(["platform", "hosting_enabled", "monitor_enabled", "weather_enabled", "time_enabled"]);
  if (!allowedFields.has(field)) throw new Error("unsupported_device_setting");
  const now = Math.floor(Date.now() / 1000);
  const defaults = DEFAULT_DEVICE_SETTINGS;
  const insert = "INSERT INTO device_settings (token, platform, hosting_enabled, monitor_enabled, weather_enabled, time_enabled, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?) ";
  const conflict = `ON CONFLICT(token) DO UPDATE SET ${field} = excluded.${field}, updated_at = excluded.updated_at`;
  const base = {
    platform: defaults.platform,
    hosting_enabled: defaults.hosting_enabled ? 1 : 0,
    monitor_enabled: defaults.monitor_enabled ? 1 : 0,
    weather_enabled: defaults.weather_enabled ? 1 : 0,
    time_enabled: defaults.time_enabled ? 1 : 0,
  };
  if (field === "platform") base.platform = String(value);
  else if (field === "hosting_enabled") base.hosting_enabled = parseBoolean(value, false) ? 1 : 0;
  else if (field === "monitor_enabled") base.monitor_enabled = parseBoolean(value, false) ? 1 : 0;
  else if (field === "weather_enabled") base.weather_enabled = parseBoolean(value, false) ? 1 : 0;
  else if (field === "time_enabled") base.time_enabled = parseBoolean(value, false) ? 1 : 0;
  await db.prepare(insert + conflict).bind(
    token,
    base.platform,
    base.hosting_enabled,
    base.monitor_enabled,
    base.weather_enabled,
    base.time_enabled,
    now
  ).run();
  return loadDeviceSettings(db, token);
}

function makeContactKey(token, platform, contactId) {
  return `${token}\u0000${platform}\u0000${contactId}`;
}

function makeSingleGroupId(token, platform, contactId) {
  return `single:${encodeURIComponent(token)}:${encodeURIComponent(platform)}:${encodeURIComponent(contactId)}`;
}

function parseSingleGroupId(groupId) {
  if (!String(groupId || "").startsWith("single:")) return null;
  const parts = String(groupId).slice(7).split(":");
  if (parts.length !== 3) return null;
  try {
    return {
      token: decodeURIComponent(parts[0]),
      platform: decodeURIComponent(parts[1]),
      contactId: decodeURIComponent(parts[2]),
    };
  } catch (_) {
    return null;
  }
}

const VALID_MESSAGE_SOURCES = new Set(["ai", "human_phone", "dashboard", "sync"]);

function hashMessagePart(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function makeSyncedMessageKey(token, platform, contactId, message) {
  const clientKey = String(message.message_key || message.messageId || "").trim();
  if (clientKey) return clientKey.slice(0, 220);
  const role = message.role === "assistant" ? "assistant" : "user";
  const createdAt = Number(message.created_at || 0);
  const fingerprint = [role, String(message.content || ""), createdAt].join("\u001f");
  return ["auto", platform, contactId, hashMessagePart(fingerprint)].join(":").slice(0, 220);
}

function countInsertedRows(results) {
  return (results || []).reduce((total, result) => {
    const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
    return total + (Number.isFinite(changes) ? changes : 0);
  }, 0);
}

async function updateConversationStats(db, token, platform, contactId, contactName, insertedCount, latestMessage, nowSec) {
  if (!insertedCount || !latestMessage) return;
  const role = latestMessage.role === "assistant" ? "assistant" : "user";
  const source = VALID_MESSAGE_SOURCES.has(latestMessage.source) ? latestMessage.source : "sync";
  const content = String(latestMessage.content || "").slice(0, 4000);
  const createdAt = Number(latestMessage.created_at || nowSec);
  let latestMessageId = Number(latestMessage.id || 0);
  if (!latestMessageId && latestMessage.message_key) {
    const inserted = await db.prepare(
      "SELECT id FROM chat_history WHERE token = ? AND message_key = ? LIMIT 1"
    ).bind(token, latestMessage.message_key).first();
    latestMessageId = Number(inserted?.id || 0);
  }
  await db.prepare(
    "INSERT INTO conversation_stats (token, platform, contact_id, contact_name, message_count, latest_message_id, latest_role, latest_content, latest_source, latest_at, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(token, platform, contact_id) DO UPDATE SET " +
    "message_count = conversation_stats.message_count + excluded.message_count, " +
    "contact_name = excluded.contact_name, " +
    "latest_message_id = CASE WHEN excluded.latest_at >= conversation_stats.latest_at THEN excluded.latest_message_id ELSE conversation_stats.latest_message_id END, " +
    "latest_role = CASE WHEN excluded.latest_at >= conversation_stats.latest_at THEN excluded.latest_role ELSE conversation_stats.latest_role END, " +
    "latest_content = CASE WHEN excluded.latest_at >= conversation_stats.latest_at THEN excluded.latest_content ELSE conversation_stats.latest_content END, " +
    "latest_source = CASE WHEN excluded.latest_at >= conversation_stats.latest_at THEN excluded.latest_source ELSE conversation_stats.latest_source END, " +
    "latest_at = MAX(conversation_stats.latest_at, excluded.latest_at), " +
    "updated_at = excluded.updated_at"
  ).bind(
    token,
    platform,
    contactId,
    String(contactName || contactId),
    insertedCount,
    latestMessageId,
    role,
    content,
    source,
    createdAt,
    nowSec
  ).run();
}

async function loadGroupIdentity(db, groupId, token) {
  const single = parseSingleGroupId(groupId);
  if (single) {
    if (token && token !== single.token) return null;
    const contact = await db.prepare(
      "SELECT contact_name FROM contacts WHERE token = ? AND platform = ? AND contact_id = ?"
    ).bind(single.token, single.platform, single.contactId).first();
    return {
      id: groupId,
      token: single.token,
      display_name: contact?.contact_name || single.contactId,
      notes: "",
      priority_reply: 0,
      aliases: [{
        platform: single.platform,
        contact_id: single.contactId,
        contact_name: contact?.contact_name || single.contactId,
      }],
    };
  }

  const group = await db.prepare(
    "SELECT id, token, display_name, notes, priority_reply FROM customer_groups WHERE id = ?"
  ).bind(groupId).first();
  if (!group || (token && group.token !== token)) return null;
  const { results } = await db.prepare(
    "SELECT platform, contact_id, contact_name FROM contact_links WHERE token = ? AND group_id = ? ORDER BY created_at"
  ).bind(group.token, groupId).all();
  return { ...group, aliases: results || [] };
}

async function listCustomerGroups(db, token, platformFilter, searchQuery) {
  const contactQuery = token
    ? "SELECT token, platform, contact_id, contact_name, is_whitelisted, notes, created_at FROM contacts WHERE token = ? ORDER BY created_at DESC"
    : "SELECT token, platform, contact_id, contact_name, is_whitelisted, notes, created_at FROM contacts ORDER BY created_at DESC";
  const contactStmt = db.prepare(contactQuery);
  const contacts = (await (token ? contactStmt.bind(token) : contactStmt).all()).results || [];

  const groupQuery = token
    ? "SELECT id, token, display_name, notes, priority_reply, created_at FROM customer_groups WHERE token = ?"
    : "SELECT id, token, display_name, notes, priority_reply, created_at FROM customer_groups";
  const groupStmt = db.prepare(groupQuery);
  const groups = (await (token ? groupStmt.bind(token) : groupStmt).all()).results || [];

  const linkQuery = token
    ? "SELECT group_id, token, platform, contact_id, contact_name FROM contact_links WHERE token = ?"
    : "SELECT group_id, token, platform, contact_id, contact_name FROM contact_links";
  const linkStmt = db.prepare(linkQuery);
  const links = (await (token ? linkStmt.bind(token) : linkStmt).all()).results || [];

  // Use one latest row per conversation instead of loading up to 10k rows.
  const historyQuery = token
    ? "SELECT token, platform, contact_id, contact_name, latest_role AS role, latest_content AS content, latest_at AS created_at, message_count FROM conversation_stats WHERE token = ?"
    : "SELECT token, platform, contact_id, contact_name, latest_role AS role, latest_content AS content, latest_at AS created_at, message_count FROM conversation_stats";
  const historyStmt = db.prepare(historyQuery);
  const histories = (await (token ? historyStmt.bind(token) : historyStmt).all()).results || [];
  const contentMatchQuery = token
    ? "SELECT DISTINCT token, platform, contact_id FROM chat_history WHERE token = ? AND lower(content) LIKE ? LIMIT 500"
    : "SELECT DISTINCT token, platform, contact_id FROM chat_history WHERE lower(content) LIKE ? LIMIT 500";
  const normalizedSearch = String(searchQuery || "").trim().toLowerCase();
  let contentHitKeys = new Set();
  if (normalizedSearch) {
    const contentMatchStmt = db.prepare(contentMatchQuery);
    const contentNeedle = "%" + normalizedSearch + "%";
    const contentMatches = (await (token ? contentMatchStmt.bind(token, contentNeedle) : contentMatchStmt.bind(contentNeedle)).all()).results || [];
    contentHitKeys = new Set(contentMatches.map((row) => makeContactKey(row.token, row.platform, row.contact_id)));
  }

  const groupRecords = new Map();
  const groupMeta = new Map(groups.map((group) => [group.id, group]));
  const linkMap = new Map(links.map((link) => [
    makeContactKey(link.token, link.platform, link.contact_id),
    link,
  ]));
  const aliasToGroup = new Map();

  function ensureGroup(record) {
    let group = groupRecords.get(record.id);
    if (!group) {
      group = {
        id: record.id,
        token: record.token,
        display_name: record.display_name || record.contact_name || "未命名客户",
        notes: record.notes || "",
        priority_reply: Boolean(record.priority_reply),
        aliases: [],
        platforms: [],
        message_count: 0,
        last_message: null,
        last_at: 0,
      };
      groupRecords.set(record.id, group);
    }
    return group;
  }

  function addAlias(tokenValue, platform, contactId, contactName) {
    const key = makeContactKey(tokenValue, platform, contactId);
    const link = linkMap.get(key);
    const groupId = link?.group_id || makeSingleGroupId(tokenValue, platform, contactId);
    const meta = groupMeta.get(groupId);
    const group = ensureGroup({
      id: groupId,
      token: tokenValue,
      display_name: meta?.display_name || contactName || link?.contact_name,
      notes: meta?.notes,
      priority_reply: meta?.priority_reply,
    });
    if (!group.aliases.some((alias) => alias.platform === platform && alias.contact_id === contactId)) {
      group.aliases.push({ platform, contact_id: contactId, contact_name: contactName || contactId });
    }
    if (!group.platforms.includes(platform)) group.platforms.push(platform);
    aliasToGroup.set(key, groupId);
  }

  for (const contact of contacts) {
    if (platformFilter && contact.platform !== platformFilter) continue;
    addAlias(contact.token, contact.platform, contact.contact_id, contact.contact_name);
  }
  for (const link of links) {
    if (platformFilter && link.platform !== platformFilter) continue;
    addAlias(link.token, link.platform, link.contact_id, link.contact_name);
  }

  for (const message of histories) {
    if (platformFilter && message.platform !== platformFilter) continue;
    const key = makeContactKey(message.token, message.platform, message.contact_id);
    if (!aliasToGroup.has(key)) addAlias(message.token, message.platform, message.contact_id, message.contact_name);
    const group = groupRecords.get(aliasToGroup.get(key));
    if (!group) continue;
    group.message_count += Number(message.message_count || 0);
    group.last_at = Number(message.created_at || 0);
    group.last_message = {
      role: message.role,
      content: message.content,
      platform: message.platform,
      contact_name: message.contact_name,
      created_at: message.created_at,
    };
  }

  const query = String(searchQuery || "").trim().toLowerCase();
  const rows = [...groupRecords.values()].filter((group) => {
    if (!query) return true;
    const aliasHit = group.aliases.some((alias) => String(alias.contact_name || "").toLowerCase().includes(query));
    const contentHit = Array.from(contentHitKeys).some((key) => {
      const [messageToken, messagePlatform, contactId] = key.split("\u0000");
      return aliasToGroup.get(makeContactKey(messageToken, messagePlatform, contactId)) === group.id;
    });
    return String(group.display_name || "").toLowerCase().includes(query) || aliasHit || contentHit;
  });
  rows.sort((a, b) => (b.last_at || 0) - (a.last_at || 0));
  return rows;
}

async function loadCustomerMessages(db, identity, limit = 300, sinceId = 0) {
  if (!identity || !identity.aliases.length) return { messages: [], latest_id: 0 };
  const clauses = identity.aliases.map(() => "(platform = ? AND contact_id = ?)");
  const params = [identity.token, ...identity.aliases.flatMap((alias) => [alias.platform, alias.contact_id])];
  const safeLimit = Math.min(Math.max(Number(limit) || 300, 1), 300);
  let query;
  if (sinceId > 0) {
    query = "SELECT id, platform, contact_id, contact_name, role, content, source, message_key, created_at FROM chat_history WHERE token = ? AND (" + clauses.join(" OR ") + ") AND id > ? ORDER BY id ASC LIMIT ?";
    params.push(sinceId, safeLimit);
  } else {
    query = "SELECT id, platform, contact_id, contact_name, role, content, source, message_key, created_at FROM (SELECT id, platform, contact_id, contact_name, role, content, source, message_key, created_at FROM chat_history WHERE token = ? AND (" + clauses.join(" OR ") + ") ORDER BY id DESC LIMIT ?) ORDER BY id ASC";
    params.push(safeLimit);
  }
  const { results } = await db.prepare(query).bind(...params).all();
  const messages = results || [];
  return {
    messages,
    latest_id: messages.reduce((max, message) => Math.max(max, Number(message.id || 0)), 0),
  };
}

function formatMemoryLines(messages, maxChars = 800) {
  const lines = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const speaker = message.role === "user" ? "对方" : "你";
    const line = `[${message.platform || "未知"} ${formatChinaMessageTime(message.created_at)}] ${speaker}：${String(message.content || "").slice(0, 160)}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.reverse().join("\n");
}

function mergeMemorySummary(existingSummary, messages, maxChars = 800) {
  const addition = formatMemoryLines(messages);
  const merged = [String(existingSummary || "").trim(), addition].filter(Boolean).join("\n");
  return merged.length <= maxChars ? merged : merged.slice(merged.length - maxChars);
}

function dedupeHistoryAgainstCurrent(historyMessages, currentMessages) {
  const remaining = new Map();
  for (const message of currentMessages || []) {
    const key = String(message.role || "user") + "\u0000" + String(message.content || "").trim();
    remaining.set(key, (remaining.get(key) || 0) + 1);
  }
  const result = [];
  for (let index = historyMessages.length - 1; index >= 0; index--) {
    const message = historyMessages[index];
    const key = String(message.role || "user") + "\u0000" + String(message.content || "").trim();
    const count = remaining.get(key) || 0;
    if (count > 0) {
      remaining.set(key, count - 1);
      continue;
    }
    result.push(message);
  }
  return result.reverse();
}

async function loadMemorySummary(db, token, groupId, aliases) {
  if (groupId) {
    const shared = await db.prepare(
      "SELECT summary, summarized_up_to_id FROM customer_summaries WHERE token = ? AND group_id = ?"
    ).bind(token, groupId).first();
    if (shared) return { summary: shared.summary || "", summarizedUpToId: Number(shared.summarized_up_to_id || 0), shared: true };
  }
  if (!aliases.length) return { summary: "", summarizedUpToId: 0, shared: false };
  const clauses = aliases.map(() => "(platform = ? AND contact_id = ?)");
  const { results } = await db.prepare(
    "SELECT summary, summarized_up_to_id FROM session_summary WHERE token = ? AND (" + clauses.join(" OR ") + ")"
  ).bind(token, ...aliases.flatMap((alias) => [alias.platform, alias.contact_id])).all();
  const rows = results || [];
  return {
    summary: rows.map((row) => row.summary).filter(Boolean).join("\n"),
    summarizedUpToId: Math.max(0, ...rows.map((row) => Number(row.summarized_up_to_id || 0))),
    shared: false,
  };
}

async function persistMemorySummary(db, token, groupId, aliases, summary, summarizedUpToId) {
  const now = Math.floor(Date.now() / 1000);
  if (groupId) {
    await db.prepare(
      "INSERT INTO customer_summaries (token, group_id, summary, summarized_up_to_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(token, group_id) DO UPDATE SET summary = excluded.summary, summarized_up_to_id = excluded.summarized_up_to_id, updated_at = excluded.updated_at"
    ).bind(token, groupId, summary, summarizedUpToId, now).run();
    return;
  }
  for (const alias of aliases) {
    await db.prepare(
      "INSERT INTO session_summary (token, platform, contact_id, summary, summarized_up_to_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(token, platform, contact_id) DO UPDATE SET summary = excluded.summary, summarized_up_to_id = excluded.summarized_up_to_id"
    ).bind(token, alias.platform, alias.contact_id, summary, summarizedUpToId).run();
  }
}

export const onRequest = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Dashboard-Password",
      },
    });
  }

  try {
    // GET /api/status — health check
    if (path === "/api/status" && method === "GET") {
      await env.DB.prepare("SELECT 1").first();
      return json({ status: "ok", time: Math.floor(Date.now() / 1000) });
    }

    // POST /api/dashboard/login - verify password without exposing it in the client bundle.
    if (path === "/api/dashboard/login" && method === "POST") {
      if (!env.DASHBOARD_PASSWORD) return json({ success: false, error: "dashboard_not_configured" }, 503);
      const body = await request.json();
      if (String(body.password || "") !== env.DASHBOARD_PASSWORD) {
        return json({ success: false, error: "invalid_password" }, 401);
      }
      return json({ success: true });
    }

    // GET /api/token — list all tokens (Dashboard)
    if (path === "/api/token" && method === "GET") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const { results } = await env.DB.prepare("SELECT token, name, monthly_limit, spent, is_active, active_persona_id, created_at, last_used_at FROM tokens ORDER BY created_at DESC").all();
      return json({ tokens: results || [] });
    }

    // GET /api/config — App startup config
    if (path === "/api/config" && method === "GET") {
      const authHeader = request.headers.get("Authorization") || "";
      const tokenRow = authHeader ? await validateToken(env.DB, authHeader) : null;
      const persona = tokenRow?.active_persona_id
        ? await env.DB.prepare("SELECT id, name FROM personas WHERE id = ? LIMIT 1").bind(tokenRow.active_persona_id).first()
        : await env.DB.prepare("SELECT id, name FROM personas WHERE is_active = 1 LIMIT 1").first();
      const location = tokenRow ? await loadDeviceLocation(env.DB, tokenRow.token) : null;
      const settings = tokenRow ? await loadDeviceSettings(env.DB, tokenRow.token) : { ...DEFAULT_DEVICE_SETTINGS };
      return json({
        active_persona_id: persona?.id || "female",
        active_persona_name: persona?.name || "\u2606\u2622",
        location,
        platform: settings.platform,
        hosting_enabled: settings.hosting_enabled,
        monitor_enabled: settings.monitor_enabled,
        weather_enabled: settings.weather_enabled,
        time_enabled: settings.time_enabled,
      });
    }

    // GET /api/chat/history
    if (path === "/api/chat/history" && method === "GET") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const token = url.searchParams.get("token") || "";
      const platform = url.searchParams.get("platform") || "";
      const contactId = url.searchParams.get("contact_id") || "";
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
      const offset = parseInt(url.searchParams.get("offset") || "0");
      let query = "SELECT id, platform, contact_id, contact_name, role, content, created_at FROM chat_history";
      const conditions = [];
      const params = [];
      if (token) { conditions.push("token = ?"); params.push(token); }
      if (platform) { conditions.push("platform = ?"); params.push(platform); }
      if (contactId) { conditions.push("contact_id = ?"); params.push(contactId); }
      if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
      query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);
      const { results } = await env.DB.prepare(query).bind(...params).all();
      return json({ history: results || [] });
    }

    // GET /api/contacts
    if (path === "/api/contacts" && method === "GET") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const token = url.searchParams.get("token") || "";
      const platform = url.searchParams.get("platform") || "";
      let query = "SELECT id, token, platform, contact_id, contact_name, is_whitelisted, notes, created_at FROM contacts";
      const conditions = [];
      const params = [];
      if (token) { conditions.push("token = ?"); params.push(token); }
      if (platform) { conditions.push("platform = ?"); params.push(platform); }
      if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
      query += " ORDER BY created_at DESC";
      const { results } = await env.DB.prepare(query).bind(...params).all();
      return json({ contacts: results || [] });
    }

    // GET /api/customer-groups - unified customers across bound platforms
    if (path === "/api/customer-groups" && method === "GET") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const token = url.searchParams.get("token") || "";
      const platform = url.searchParams.get("platform") || "";
      const query = url.searchParams.get("q") || "";
      const groups = await listCustomerGroups(env.DB, token, platform, query);
      return json({ groups });
    }

    // POST /api/customer-groups/bind - bind multiple platform accounts to one person
    if (path === "/api/customer-groups/bind" && method === "POST") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const body = await request.json();
      const token = String(body.token || "").trim();
      const displayName = String(body.display_name || "").trim();
      const contacts = Array.isArray(body.contacts) ? body.contacts : [];
      const normalized = contacts
        .map((contact) => ({
          platform: String(contact.platform || "").trim(),
          contactId: String(contact.contact_id || "").trim(),
          contactName: String(contact.contact_name || "").trim(),
        }))
        .filter((contact) => SUPPORTED_PLATFORMS.includes(contact.platform) && contact.contactId);
      if (!token || !displayName || normalized.length < 1) return json({ error: "缺少必要参数" }, 400);

      let groupId = String(body.group_id || "").trim();
      if (!groupId) {
        for (const contact of normalized) {
          const existing = await env.DB.prepare(
            "SELECT group_id FROM contact_links WHERE token = ? AND platform = ? AND contact_id = ?"
          ).bind(token, contact.platform, contact.contactId).first();
          if (existing?.group_id) {
            groupId = existing.group_id;
            break;
          }
        }
      }
      if (!groupId || parseSingleGroupId(groupId)) groupId = "group:" + crypto.randomUUID();

      const existingGroup = await env.DB.prepare(
        "SELECT id, token FROM customer_groups WHERE id = ?"
      ).bind(groupId).first();
      if (existingGroup && existingGroup.token !== token) return json({ error: "身份组不属于该设备" }, 400);

      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        "INSERT INTO customer_groups (id, token, display_name, notes, priority_reply, priority_last_used_at, created_at, updated_at) VALUES (?, ?, ?, '', 0, 0, ?, ?) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at"
      ).bind(groupId, token, displayName, now, now).run();

      const statements = [];
      for (const contact of normalized) {
        statements.push(env.DB.prepare(
          "INSERT INTO contacts (token, platform, contact_id, contact_name, is_whitelisted, notes, created_at) VALUES (?, ?, ?, ?, 1, '', ?) ON CONFLICT(token, platform, contact_id) DO UPDATE SET contact_name = excluded.contact_name"
        ).bind(token, contact.platform, contact.contactId, contact.contactName || contact.contactId, now));
        statements.push(env.DB.prepare(
          "INSERT INTO contact_links (group_id, token, platform, contact_id, contact_name, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token, platform, contact_id) DO UPDATE SET group_id = excluded.group_id, contact_name = excluded.contact_name"
        ).bind(groupId, token, contact.platform, contact.contactId, contact.contactName || contact.contactId, now));
      }
      await env.DB.batch(statements);
      if (body.replace_aliases === true) {
        const keepClauses = normalized.map(() => "(platform = ? AND contact_id = ?)");
        const keepParams = normalized.flatMap((contact) => [contact.platform, contact.contactId]);
        await env.DB.prepare(
          "DELETE FROM contact_links WHERE token = ? AND group_id = ? AND NOT (" + keepClauses.join(" OR ") + ")"
        ).bind(token, groupId, ...keepParams).run();
      }
      const identity = await loadGroupIdentity(env.DB, groupId, token);
      return json({ success: true, group: identity });
    }

    // DELETE /api/customer-groups/unbind - detach one platform account
    if (path === "/api/customer-groups/unbind" && method === "DELETE") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const body = await request.json();
      const token = String(body.token || "").trim();
      const platform = String(body.platform || "").trim();
      const contactId = String(body.contact_id || "").trim();
      if (!token || !platform || !contactId) return json({ error: "缺少必要参数" }, 400);
      await env.DB.prepare(
        "DELETE FROM contact_links WHERE token = ? AND platform = ? AND contact_id = ?"
      ).bind(token, platform, contactId).run();
      return json({ success: true });
    }

    // PUT /api/customer-groups/priority - place this customer before normal unread scans
    if (path === "/api/customer-groups/priority" && method === "PUT") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const body = await request.json();
      const token = String(body.token || "").trim();
      const groupId = String(body.group_id || "").trim();
      const enabled = body.enabled ? 1 : 0;
      if (!token || !groupId) return json({ error: "缺少必要参数" }, 400);

      let identity = await loadGroupIdentity(env.DB, groupId, token);
      if (!identity) return json({ error: "客户不存在" }, 404);
      if (parseSingleGroupId(groupId)) {
        const alias = identity.aliases[0];
        const persistentId = "group:" + crypto.randomUUID();
        const now = Math.floor(Date.now() / 1000);
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO customer_groups (id, token, display_name, notes, priority_reply, priority_last_used_at, created_at, updated_at) VALUES (?, ?, ?, '', ?, 0, ?, ?)"
          ).bind(persistentId, token, identity.display_name || alias.contact_name || alias.contact_id, enabled, now, now),
          env.DB.prepare(
            "INSERT INTO contact_links (group_id, token, platform, contact_id, contact_name, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token, platform, contact_id) DO UPDATE SET group_id = excluded.group_id, contact_name = excluded.contact_name"
          ).bind(persistentId, token, alias.platform, alias.contact_id, alias.contact_name || alias.contact_id, now),
        ]);
        identity = await loadGroupIdentity(env.DB, persistentId, token);
      } else {
        await env.DB.prepare(
          "UPDATE customer_groups SET priority_reply = ?, priority_last_used_at = 0, updated_at = ? WHERE id = ? AND token = ?"
        ).bind(enabled, Math.floor(Date.now() / 1000), groupId, token).run();
        identity = await loadGroupIdentity(env.DB, groupId, token);
      }
      return json({ success: true, group: identity });
    }

    // GET /api/customer-messages - full conversation for a unified customer
    if (path === "/api/customer-messages" && method === "GET") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const groupId = url.searchParams.get("group_id") || "";
      const token = url.searchParams.get("token") || "";
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "300"), 300);
      const sinceId = Math.max(0, parseInt(url.searchParams.get("since_id") || "0"));
      const identity = await loadGroupIdentity(env.DB, groupId, token);
      if (!identity) return json({ error: "客户不存在" }, 404);
      const messagePage = await loadCustomerMessages(env.DB, identity, limit, sinceId);
      const profile = await loadCustomerProfile(env.DB, identity.token, identity.id);
      return json({ identity, ...messagePage, profile });
    }

    // POST /api/manual-replies - enqueue an exact message from the dashboard
    if (path === "/api/manual-replies" && method === "POST") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const body = await request.json();
      const token = String(body.token || "").trim();
      const groupId = String(body.group_id || "").trim();
      const platform = String(body.platform || "").trim();
      const contactId = String(body.contact_id || "").trim();
      const content = String(body.content || "").trim();
      if (!token || !platform || !contactId || !content) return json({ error: "缺少必要参数" }, 400);

      let contactName = String(body.contact_name || contactId).trim();
      if (groupId) {
        const identity = await loadGroupIdentity(env.DB, groupId, token);
        const alias = identity?.aliases.find((item) => item.platform === platform && item.contact_id === contactId);
        if (!alias) return json({ error: "目标账号不属于该客户" }, 400);
        contactName = alias.contact_name || contactName;
      }

      const taskId = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        "INSERT INTO manual_replies (id, token, platform, contact_id, contact_name, group_id, content, status, priority, created_at, claimed_at, sent_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, NULL, NULL, '')"
      ).bind(taskId, token, platform, contactId, contactName, groupId, content, now).run();
      return json({ success: true, task_id: taskId, status: "pending" }, 201);
    }

    // GET /api/reply-tasks/next - Android pulls manual messages first, then priority customers
    if (path === "/api/reply-tasks/next" && method === "GET") {
      const authHeader = request.headers.get("Authorization") || "";
      const tokenRow = await validateToken(env.DB, authHeader);
      if (!tokenRow) return json({ error: "无效的设备密钥" }, 401);
      const platform = url.searchParams.get("platform") || "";
      if (!SUPPORTED_PLATFORMS.includes(platform)) return json({ error: "不支持的平台" }, 400);
      const now = Math.floor(Date.now() / 1000);
      const staleBefore = now - 120;
      const manual = await env.DB.prepare(
        "SELECT id, platform, contact_id, contact_name, group_id, content, status, created_at FROM manual_replies WHERE token = ? AND platform = ? AND (status = 'pending' OR (status = 'claimed' AND claimed_at < ?)) ORDER BY priority DESC, created_at ASC LIMIT 1"
      ).bind(tokenRow.token, platform, staleBefore).first();
      if (manual) {
        await env.DB.prepare(
          "UPDATE manual_replies SET status = 'claimed', claimed_at = ?, error = '' WHERE id = ? AND token = ?"
        ).bind(now, manual.id, tokenRow.token).run();
        return json({ task: { ...manual, type: "manual" } });
      }

      const priority = await env.DB.prepare(
        "SELECT g.id AS group_id, g.display_name, l.platform, l.contact_id, l.contact_name FROM customer_groups g JOIN contact_links l ON l.token = g.token AND l.group_id = g.id WHERE g.token = ? AND g.priority_reply = 1 AND l.platform = ? AND (g.priority_last_used_at = 0 OR g.priority_last_used_at < ?) ORDER BY g.priority_last_used_at ASC, g.updated_at ASC LIMIT 1"
      ).bind(tokenRow.token, platform, now - 15).first();
      if (!priority) return json({ task: null });
      await env.DB.prepare(
        "UPDATE customer_groups SET priority_last_used_at = ? WHERE id = ? AND token = ?"
      ).bind(now, priority.group_id, tokenRow.token).run();
      return json({ task: { type: "priority_contact", task_id: "", group_id: priority.group_id, platform: priority.platform, contact_id: priority.contact_id, contact_name: priority.contact_name || priority.display_name, content: "" } });
    }

    // POST /api/reply-tasks/result - Android reports whether a manual message was sent
    if (path === "/api/reply-tasks/result" && method === "POST") {
      const authHeader = request.headers.get("Authorization") || "";
      const tokenRow = await validateToken(env.DB, authHeader);
      if (!tokenRow) return json({ error: "无效的设备密钥" }, 401);
      const body = await request.json();
      const taskId = String(body.task_id || "").trim();
      const status = body.status === "sent" ? "sent" : "failed";
      const error = String(body.error || "").slice(0, 300);
      if (!taskId) return json({ error: "缺少 task_id" }, 400);
      const task = await env.DB.prepare(
        "SELECT id, platform, contact_id, contact_name, group_id, content FROM manual_replies WHERE id = ? AND token = ?"
      ).bind(taskId, tokenRow.token).first();
      if (!task) return json({ error: "任务不存在" }, 404);
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        "UPDATE manual_replies SET status = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END, error = ? WHERE id = ? AND token = ?"
      ).bind(status, status, now, error, taskId, tokenRow.token).run();
      if (status === "sent") {
        const insertResult = await env.DB.prepare(
          "INSERT OR IGNORE INTO chat_history (token, platform, contact_id, contact_name, role, content, created_at, source, message_key) VALUES (?, ?, ?, ?, 'assistant', ?, ?, 'dashboard', ?)"
        ).bind(tokenRow.token, task.platform, task.contact_id, task.contact_name, task.content, now, "dashboard:" + taskId).run();
        await updateConversationStats(
          env.DB,
          tokenRow.token,
          task.platform,
          task.contact_id,
          task.contact_name,
          countInsertedRows([insertResult]),
          { role: "assistant", content: task.content, source: "dashboard", created_at: now, message_key: "dashboard:" + taskId },
          now
        );
      }
      return json({ success: true, status });
    }

    // POST /api/contacts
    if (path === "/api/contacts" && method === "POST") {
      const body = await request.json();
      const { token, platform, contact_id, contact_name } = body;
      const deviceToken = await validateToken(env.DB, "Bearer " + (token || ""));
      if (!isDashboardAuthorized(request, env) && !deviceToken) return json({ error: "未授权" }, 401);
      if (!token || !platform || !contact_id || !contact_name) return json({ error: "\u7f3a\u5c11\u5fc5\u8981\u53c2\u6570" }, 400);
      const isWhitelisted = body.is_whitelisted ?? 1;
      const notes = body.notes || "";
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare("INSERT INTO contacts (token, platform, contact_id, contact_name, is_whitelisted, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(token, platform, contact_id) DO UPDATE SET contact_name = excluded.contact_name, is_whitelisted = excluded.is_whitelisted, notes = excluded.notes")
        .bind(token, platform, contact_id, contact_name, isWhitelisted, notes, now).run();
      return json({ success: true });
    }

    // PUT /api/contacts ? update contact (whitelist toggle, notes)
    if (path === "/api/contacts" && method === "PUT") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const body = await request.json();
      const { token, platform, contact_id } = body;
      if (!token || !platform || !contact_id) return json({ error: "缺少必要参数" }, 400);
      const updates = [], params = [];
      if (body.contact_name !== undefined) { updates.push("contact_name = ?"); params.push(body.contact_name); }
      if (body.is_whitelisted !== undefined) { updates.push("is_whitelisted = ?"); params.push(body.is_whitelisted); }
      if (body.notes !== undefined) { updates.push("notes = ?"); params.push(body.notes); }
      if (updates.length === 0) return json({ error: "没有要更新的字段" }, 400);
      params.push(token, platform, contact_id);
      await env.DB.prepare("UPDATE contacts SET " + updates.join(", ") + " WHERE token = ? AND platform = ? AND contact_id = ?").bind(...params).run();
      return json({ success: true });
    }

    // DELETE /api/contacts ? delete contact
    if (path === "/api/contacts" && method === "DELETE") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const body = await request.json();
      const { token, platform, contact_id } = body;
      if (!token || !platform || !contact_id) return json({ error: "缺少必要参数" }, 400);
      await env.DB.prepare("DELETE FROM contacts WHERE token = ? AND platform = ? AND contact_id = ?").bind(token, platform, contact_id).run();
      return json({ success: true });
    }


    // GET /api/persona - public metadata never exposes system prompts
    if (path === "/api/persona" && method === "GET") {
      const dashboardAuthorized = isDashboardAuthorized(request, env);
      if (!dashboardAuthorized && url.searchParams.get("include_prompt") === "1") return json({ error: "Unauthorized" }, 401);
      const includePrompt = dashboardAuthorized || url.searchParams.get("include_prompt") === "1";
      if (includePrompt && !isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const columns = includePrompt ? "id, name, system_prompt, is_active, created_at" : "id, name, is_active, created_at";
      const { results } = await env.DB.prepare("SELECT " + columns + " FROM personas ORDER BY CASE WHEN id LIKE 'female%' THEN 0 WHEN id LIKE 'male%' THEN 1 ELSE 2 END, created_at, id").all();
      const personas = (results || []).map((persona) => ({
        ...persona,
        gender: String(persona.id).startsWith("female") ? "female" : "male",
      }));
      return json({ personas });
    }

    // PUT /api/persona/activate - Dashboard persona activation
    if (path === "/api/persona/activate" && method === "PUT") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const body = await request.json();
      const persona = await activatePersona(env.DB, String(body.id || ""));
      if (!persona) return json({ success: false, error: "人设不存在" }, 404);
      return json({ success: true, active_persona_id: persona.id, active_persona_name: persona.name });
    }

    // DELETE /api/persona ? delete a persona (Dashboard)
    if (path === "/api/persona" && method === "DELETE") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const body = await request.json();
      const { id } = body;
      if (!id) return json({ error: "缺少 id" }, 400);
      await env.DB.prepare("DELETE FROM personas WHERE id = ?").bind(id).run();
      return json({ success: true });
    }

    // PUT /api/persona
    if (path === "/api/persona" && method === "PUT") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const body = await request.json();
      const { id, name, system_prompt } = body;
      if (!id || !name || !system_prompt) return json({ error: "\u7f3a\u5c11\u5fc5\u8981\u53c2\u6570" }, 400);
      const isActive = body.is_active ?? 0;
      const now = Math.floor(Date.now() / 1000);
      if (isActive === 1) await env.DB.prepare("UPDATE personas SET is_active = 0").run();
      await env.DB.prepare("INSERT INTO personas (id, token, name, system_prompt, is_active, created_at) VALUES (?, '', ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, system_prompt = excluded.system_prompt, is_active = excluded.is_active")
        .bind(id, name, system_prompt, isActive, now).run();
      return json({ success: true });
    }

    // POST /api/token - dashboard-only registration
    if (path === "/api/token" && method === "POST") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const parsedBody = await parseJsonBody(request, 16 * 1024);
      if (parsedBody.error) return json({ error: parsedBody.error }, parsedBody.status);
      const body = parsedBody.body;
      const token = String(body.token || "").trim();
      if (!/^[A-Za-z0-9._:-]{8,160}$/u.test(token)) return json({ error: "token 格式无效" }, 400);
      const name = String(body.name || "").trim().slice(0, 80);
      const monthlyLimit = Number(body.monthly_limit ?? 30);
      if (!Number.isFinite(monthlyLimit) || monthlyLimit < 0 || monthlyLimit > 1_000_000) return json({ error: "月度上限无效" }, 400);
      const now = Math.floor(Date.now() / 1000);
      const existing = await env.DB.prepare("SELECT token, is_active FROM tokens WHERE token = ?").bind(token).first();
      if (existing) {
        await env.DB.prepare("UPDATE tokens SET last_used_at = ?, name = CASE WHEN name = '' THEN ? ELSE name END WHERE token = ?").bind(now, name, token).run();
        return json({ token, exists: true, is_active: existing.is_active });
      }
      await env.DB.prepare("INSERT INTO tokens (token, name, monthly_limit, spent, is_active, created_at, last_used_at) VALUES (?, ?, ?, 0, 1, ?, ?)").bind(token, name, monthlyLimit, now, now).run();
      return json({ token, exists: false, is_active: 1 }, 201);
    }

    // PUT /api/token
    if (path === "/api/token" && method === "PUT") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const body = await request.json();
      const { token } = body;
      if (!token) return json({ error: "\u7f3a\u5c11 token" }, 400);
      const updates = [], params = [];
      if (body.is_active !== undefined) { updates.push("is_active = ?"); params.push(body.is_active); }
      if (body.monthly_limit !== undefined) {
        const monthlyLimit = Number(body.monthly_limit);
        if (!Number.isFinite(monthlyLimit) || monthlyLimit < 0 || monthlyLimit > 1_000_000) return json({ error: "月度上限无效" }, 400);
        updates.push("monthly_limit = ?");
        params.push(monthlyLimit);
      }
      if (body.name !== undefined) { updates.push("name = ?"); params.push(body.name); }
      if (updates.length === 0) return json({ error: "\u6ca1\u6709\u8981\u66f4\u65b0\u7684\u5b57\u6bb5" }, 400);
      params.push(token);
      await env.DB.prepare("UPDATE tokens SET " + updates.join(", ") + " WHERE token = ?").bind(...params).run();
      return json({ success: true });
    }

    // PUT /api/config
    if (path === "/api/config" && method === "PUT") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const body = await request.json();
      if (body.model_name) {
        const modelName = String(body.model_name).trim();
        if (!/^[A-Za-z0-9._:/-]{1,120}$/u.test(modelName)) return json({ error: "模型名称无效" }, 400);
        await env.KV.put("llm:model", modelName);
      }
      if (body.api_base) {
        const baseUrl = normalizeLlmBaseUrl(body.api_base);
        if (!baseUrl) return json({ error: "API 地址无效" }, 400);
        await env.KV.put("llm:base_url", baseUrl);
      }
      if (body.temperature !== undefined) {
        const temperature = Number(body.temperature);
        if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) return json({ error: "temperature 无效" }, 400);
        await env.KV.put("llm:temperature", String(temperature));
      }
      if (body.max_tokens !== undefined) {
        const maxTokens = Number(body.max_tokens);
        if (!Number.isInteger(maxTokens) || maxTokens < 16 || maxTokens > 4096) return json({ error: "max_tokens 无效" }, 400);
        await env.KV.put("llm:max_tokens", String(maxTokens));
      }
      llmConfigCache.delete(env.KV);
      return json({ success: true });
    }

    // POST /api/messages/sync — monitor mode
    if (path === "/api/messages/sync" && method === "POST") {
      const authHeader = request.headers.get("Authorization") || "";
      const tokenRow = await validateToken(env.DB, authHeader);
      if (!tokenRow) return json({ error: "\u65e0\u6548\u7684\u8bbe\u5907\u5bc6\u94a5" }, 401);
      const body = await request.json();
      const { platform, contact_id, contact_name, messages } = body;
      if (!platform || !contact_id || !contact_name || !messages || !Array.isArray(messages)) return json({ error: "\u7f3a\u5c11\u5fc5\u8981\u53c2\u6570" }, 400);
      if (messages.length > 200) return json({ error: "单次最多同步200条" }, 413);
      const nowSec = Math.floor(Date.now() / 1000);
      const validMessages = [];
      for (let index = 0; index < messages.length; index++) {
        const msg = messages[index] || {};
        const role = msg.role === "assistant" ? "assistant" : "user";
        const content = String(msg.content || "").trim();
        if (!content || content.length > 4000) continue;
        const source = VALID_MESSAGE_SOURCES.has(msg.source) ? msg.source : "sync";
        validMessages.push({
          role,
          content,
          created_at: Number(msg.created_at || nowSec),
          source,
          message_key: makeSyncedMessageKey(tokenRow.token, platform, contact_id, msg),
        });
      }
      const stmt = env.DB.prepare("INSERT OR IGNORE INTO chat_history (token, platform, contact_id, contact_name, role, content, created_at, source, message_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const batch = validMessages.map((msg) => stmt.bind(tokenRow.token, platform, contact_id, contact_name, msg.role, msg.content, msg.created_at, msg.source, msg.message_key));
      const batchResults = batch.length ? await env.DB.batch(batch) : [];
      const insertedCount = countInsertedRows(batchResults);
      const latestMessage = validMessages.reduce((latest, message) => !latest || message.created_at >= latest.created_at ? message : latest, null);
      if (insertedCount > 0) {
        await updateConversationStats(env.DB, tokenRow.token, platform, contact_id, contact_name, insertedCount, latestMessage, nowSec);
        await env.DB.prepare("UPDATE tokens SET last_used_at = ? WHERE token = ?").bind(nowSec, tokenRow.token).run();
        const profileJob = maybeExtractCustomerProfile(env, tokenRow, platform, contact_id).catch((error) => {
          console.error("profile extraction failed", error instanceof Error ? error.message : String(error));
        });
        if (typeof context.waitUntil === "function") context.waitUntil(profileJob); else await profileJob;
      }
      return json({ ok: true, accepted: validMessages.length, inserted: insertedCount });
    }

    // POST /api/chat — core AI reply
    if (path === "/api/chat" && method === "POST") {
      const authHeader = request.headers.get("Authorization") || "";
      const tokenRow = await validateToken(env.DB, authHeader);
      if (!tokenRow) return json({ error: "\u65e0\u6548\u7684\u8bbe\u5907\u5bc6\u94a5" }, 401);
      const parsedBody = await parseJsonBody(request, 96 * 1024);
      if (parsedBody.error) return json({ error: parsedBody.error }, parsedBody.status);
      const body = parsedBody.body;
      const platform = normalizePlatform(body.platform);
      const contact_id = String(body.contact_id || "").trim().slice(0, 200);
      const contact_name = String(body.contact_name || "").trim().slice(0, 200);
      const location = body.location;
      const messages = body.messages;
      const conversationTimeline = String(body.conversation_timeline || "").trim().slice(0, 2400);
      const requestId = String(body.request_id || "").trim().slice(0, 120) || crypto.randomUUID();
      if (!platform || !contact_id || !contact_name) return json({ error: "缺少必要参数" }, 400);
      if (!validateChatMessages(messages)) return json({ error: "消息格式无效或数量超限" }, 400);

      const existingPending = await env.DB.prepare(
        "SELECT id, content, status FROM pending_replies WHERE token = ? AND request_id = ? LIMIT 1"
      ).bind(tokenRow.token, requestId).first();
      if (existingPending) {
        return json({
          action: existingPending.status === "confirmed" ? "skip" : "send",
          reply: existingPending.content,
          reply_id: existingPending.id,
          status: existingPending.status,
        });
      }
      const rate = await enforceChatRateLimit(
        env.DB,
        tokenRow.token,
        Math.max(1, Number(env.CHAT_RATE_LIMIT_PER_MINUTE || 30))
      );
      if (!rate.allowed) return json({ error: "请求过于频繁", retry_after_seconds: 60 }, 429);
      const budget = await enforceTokenBudget(env.DB, tokenRow);
      if (!budget.allowed) return json({
        error: "本月模型额度已用完",
        spent: budget.spent,
        monthly_limit: budget.limit,
      }, 429);
      const deviceSettings = await loadDeviceSettings(env.DB, tokenRow.token);
      const chatStartedAt = Date.now();
      const timing = { persona_ms: 0, context_ms: 0, llm_ms: 0, total_ms: 0 };
      // Input shape is validated before duplicate/rate/budget checks above.

      // whitelist check
      const contact = await env.DB.prepare("SELECT is_whitelisted FROM contacts WHERE token = ? AND platform = ? AND contact_id = ?").bind(tokenRow.token, platform, contact_id).first();
      if (!contact) {
        const nowSec2 = Math.floor(Date.now() / 1000);
        await env.DB.prepare("INSERT INTO contacts (token, platform, contact_id, contact_name, is_whitelisted, notes, created_at) VALUES (?, ?, ?, ?, 1, '', ?)").bind(tokenRow.token, platform, contact_id, contact_name, nowSec2).run();
      } else if (contact.is_whitelisted === 0) {
        return json({ action: "skip" });
      }

      const localVoiceReply = localVoiceRequestReply(messages);
      const localChallengeReply = localVoiceReply || localAiChallengeReply(messages, requestId);
      if (localChallengeReply) {
        const pending = await loadOrCreatePendingReply(env.DB, {
          token: tokenRow.token,
          requestId,
          platform,
          contactId: contact_id,
          contactName: contact_name,
          content: localChallengeReply,
          createdAt: Math.floor(Date.now() / 1000),
        });
        await env.DB.prepare("UPDATE tokens SET last_used_at = ? WHERE token = ?")
          .bind(Math.floor(Date.now() / 1000), tokenRow.token).run();
        return json({ action: "send", reply: pending.content, reply_id: pending.id, status: "pending", local: true });
      }

      // persona
      const personaStartedAt = Date.now();
      const activePersona = await env.DB.prepare(
        "SELECT id, system_prompt FROM personas WHERE id = ? LIMIT 1"
      ).bind(tokenRow.active_persona_id || "female").first();
      timing.persona_ms = Date.now() - personaStartedAt;
      const personaPrompt = activePersona?.system_prompt || "\u4f60\u662f\u4e00\u4e2a\u53cb\u597d\u7684\u804a\u5929\u52a9\u624b\u3002";

      // history
      const contextStartedAt = Date.now();
      const MAX_MSGS = 10;
      const currentLink = await env.DB.prepare(
        "SELECT group_id FROM contact_links WHERE token = ? AND platform = ? AND contact_id = ?"
      ).bind(tokenRow.token, platform, contact_id).first();
      let historyStatement;
      let historyAliases = [{ platform, contact_id }];
      if (currentLink?.group_id) {
        const { results: linkedAliases } = await env.DB.prepare(
          "SELECT platform, contact_id FROM contact_links WHERE token = ? AND group_id = ?"
        ).bind(tokenRow.token, currentLink.group_id).all();
        const aliases = linkedAliases?.length ? linkedAliases : [{ platform, contact_id }];
        if (aliases.length) historyAliases = aliases;
        const clauses = aliases.map(() => "(platform = ? AND contact_id = ?)");
        historyStatement = env.DB.prepare(
          "SELECT id, platform, role, content, created_at FROM chat_history WHERE token = ? AND (" + clauses.join(" OR ") + ") ORDER BY created_at DESC LIMIT ?"
        ).bind(tokenRow.token, ...aliases.flatMap((alias) => [alias.platform, alias.contact_id]), MAX_MSGS + 80);
      } else {
        historyStatement = env.DB.prepare(
          "SELECT id, platform, role, content, created_at FROM chat_history WHERE token = ? AND platform = ? AND contact_id = ? ORDER BY created_at DESC LIMIT ?"
        ).bind(tokenRow.token, platform, contact_id, MAX_MSGS + 80);
      }
      const memoryRow = await loadMemorySummary(env.DB, tokenRow.token, currentLink?.group_id || "", historyAliases);
      const profileGroupId = currentLink?.group_id || makeSingleGroupId(tokenRow.token, platform, contact_id);
      const customerProfile = await loadCustomerProfile(env.DB, tokenRow.token, profileGroupId);
      const { results: allMsgs } = await historyStatement.all();
      const allMessages = (allMsgs || []).reverse();
      const recentHistory = allMessages.length <= MAX_MSGS ? allMessages : allMessages.slice(allMessages.length - MAX_MSGS);
      const historyMessages = dedupeHistoryAgainstCurrent(recentHistory, messages);
      const olderMessages = allMessages.slice(0, Math.max(0, allMessages.length - MAX_MSGS))
        .filter((message) => Number(message.id || 0) > memoryRow.summarizedUpToId);
      const summary = mergeMemorySummary(memoryRow.summary, olderMessages);
      const summarizedUpToId = olderMessages.reduce((max, message) => Math.max(max, Number(message.id || 0)), memoryRow.summarizedUpToId);
      if (olderMessages.length > 0) {
        await persistMemorySummary(env.DB, tokenRow.token, currentLink?.group_id || "", historyAliases, summary, summarizedUpToId);
      }

      // weather
      const homeCity = location?.home?.city || "\u91cd\u5e86";
      const weather = deviceSettings.weather_enabled
        ? await getWeather(homeCity, env.KV, env.WEATHER_API_KEY || "")
        : null;

      // model config
      const modelConfig = await loadLlmConfig(env.KV, env);
      const modelName = modelConfig.modelName;

      // system prompt
      const now2 = new Date();
      const chinaTime = getChinaTimeContext(now2);
      const currentDatetime = chinaTime.currentDatetime;
      const weekday = chinaTime.weekday;
      const currentHour = parseInt((currentDatetime.split(" ")[1] || "12:00:00").split(":")[0], 10) || 12;
      const nowSec2 = Math.floor(Date.now() / 1000);
      const activity = await loadActivityStats(env.DB, tokenRow.token, historyAliases, nowSec2);
      const stage = relationStage(activity.totalExchanges, activity.userMsgs7d);
      const stageText = stage === 1
        ? "你们刚加上，从陌生人正常聊起，别叫昵称，别假设你们很熟。"
        : stage === 3
          ? "你们聊得挺熟了，但只有对方主动聊手机、换机或回收时才自然接，不要主动盘问型号。"
          : "你们聊过几次了，可以自然一点，延续之前的话题。";
      const activityNow = currentActivityByHour(currentHour);
      const profileContext = customerProfilePrompt(customerProfile.profile);
      const messageDelay = deviceSettings.time_enabled
        ? resolveIncomingDelayPolicy(messages, historyMessages, nowSec2)
        : null;
      const contactPolicy = resolveContactRequestPolicy({
        requestCount: countContactRequests(historyMessages, messages),
        stage,
        activity,
        incomingText: latestIncomingText(messages),
        historyMessages,
        messages,
        contactQq: env.CONTACT_QQ || "",
      });
      if (contactPolicy.reply) {
        const pending = await loadOrCreatePendingReply(env.DB, {
          token: tokenRow.token,
          requestId,
          platform,
          contactId: contact_id,
          contactName: contact_name,
          content: contactPolicy.reply,
          createdAt: nowSec2,
        });
        await env.DB.prepare("UPDATE tokens SET last_used_at = ? WHERE token = ?")
          .bind(nowSec2, tokenRow.token).run();
        return json({ action: "send", reply: pending.content, reply_id: pending.id, status: "pending", local: true, contact_gate: contactPolicy.allowed ? "allowed" : "blocked" });
      }

      const systemPrompt = buildLayeredSystemPrompt({
        personaPrompt,
        platform,
        profileContext,
        currentDatetime,
        weekday,
        activityNow,
        homeLocation: { city: location?.home?.city || "重庆", district: location?.home?.district || "两江新区" },
        workLocation: { city: location?.work?.city || "重庆", district: location?.work?.district || "两江新区" },
        weather,
        weatherEnabled: deviceSettings.weather_enabled,
        timeEnabled: deviceSettings.time_enabled,
        activity,
        stageText,
        relationStageLevel: stage,
        messageDelay,
        contactPolicy,
        messages,
        historyMessages,
        conversationTimeline,
      });
      timing.context_ms = Date.now() - contextStartedAt;

      const llmMessages = [{ role: "system", content: systemPrompt }];
      if (summary) llmMessages.push({ role: "user", content: "\u4e4b\u524d\u7684\u804a\u5929\u5927\u6982\u662f\u8fd9\u6837\uff1a" + summary });
      for (const msg of historyMessages) {
        const timeStr = formatChinaMessageTime(msg.created_at);
        const roleLabel = msg.role === "user" ? "\u5bf9\u65b9\u8bf4" : "\u4f60\u8bf4";
        const platformLabel = SUPPORTED_PLATFORMS.includes(msg.platform) ? msg.platform : "未知平台";
        llmMessages.push({ role: "user", content: "[" + platformLabel + " " + timeStr + "] " + roleLabel + "\uff1a" + msg.content });
      }
      for (const msg of messages) {
        llmMessages.push({ role: msg.role, content: formatCurrentChatMessage(msg) });
      }

      // call DeepSeek
      const generation = replyGenerationSettings(messages, messageDelay, modelConfig);
      const requestTemperature = generation.temperature;
      const apiKey = env.DEEPSEEK_API_KEY || "";
      const llmStartedAt = Date.now();
      const resp = await fetch(modelConfig.baseUrl + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
        body: JSON.stringify({ model: modelName, messages: llmMessages, temperature: requestTemperature, max_tokens: generation.maxTokens }),
      });
      if (!resp.ok) return json({ error: "LLM \u8c03\u7528\u5931\u8d25" }, 502);
      const data = await resp.json();
      timing.llm_ms = Date.now() - llmStartedAt;
      await recordTokenUsage(
        env.DB,
        tokenRow.token,
        estimateLlmCost({
          usage: data.usage,
          inputChars: llmMessages.reduce((total, message) => total + String(message.content || "").length, 0),
          outputChars: String(data.choices?.[0]?.message?.content || "").length,
        }, env)
      );
      const rawReply = data.choices?.[0]?.message?.content?.trim() || "\u6069\u6069\uff0c\u597d\u7684\u3002";
      const cleanedReply = sanitizeAssistantReply(rawReply);
      const staleSafeReply = sanitizeStaleAssistantReply(cleanedReply, messageDelay) || "\u6069\u6069\uff0c\u597d\u7684\u3002";
      const reply = sanitizeNewContactBusinessReply(staleSafeReply, stage, latestIncomingText(messages));
      const safeReply = sanitizeContactDisclosure(reply, { allowed: contactPolicy.allowed, contactQq: contactPolicy.contactQq });
      const nowSec = Math.floor(Date.now() / 1000);

      const pending = await loadOrCreatePendingReply(env.DB, {
        token: tokenRow.token,
        requestId,
        platform,
        contactId: contact_id,
        contactName: contact_name,
        content: safeReply,
        createdAt: nowSec,
      });

      // update token
      await env.DB.prepare("UPDATE tokens SET last_used_at = ? WHERE token = ?").bind(nowSec, tokenRow.token).run();

      timing.total_ms = Date.now() - chatStartedAt;
      console.log("chat_timing", JSON.stringify({ token: tokenRow.token.slice(-6), platform, timing }));
      return json({ action: "send", reply: pending.content, reply_id: pending.id, status: "pending", timing });
    }

    // POST /api/chat/confirm - only mark AI history after the phone confirms delivery.
    if (path === "/api/chat/confirm" && method === "POST") {
      const authHeader = request.headers.get("Authorization") || "";
      const tokenRow = await validateToken(env.DB, authHeader);
      if (!tokenRow) return json({ error: "无效的设备密钥" }, 401);
      const body = await request.json();
      const replyId = String(body.reply_id || "").trim();
      if (!replyId) return json({ error: "缺少 reply_id" }, 400);
      const pending = await env.DB.prepare(
        "SELECT id, platform, contact_id, contact_name, content, status FROM pending_replies WHERE id = ? AND token = ? LIMIT 1"
      ).bind(replyId, tokenRow.token).first();
      if (!pending) return json({ error: "待确认回复不存在" }, 404);
      if (pending.status === "confirmed") return json({ success: true, status: "confirmed", duplicate: true });
      const sentContent = String(body.sent_content || pending.content || "").trim().slice(0, 4000);
      const nowSec = Math.floor(Date.now() / 1000);
      const [insertResult] = await env.DB.batch([
        env.DB.prepare(
          "INSERT OR IGNORE INTO chat_history (token, platform, contact_id, contact_name, role, content, created_at, source, message_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(tokenRow.token, pending.platform, pending.contact_id, pending.contact_name, "assistant", sentContent, nowSec, "ai", "ai:" + pending.id),
        env.DB.prepare(
          "UPDATE pending_replies SET status = 'confirmed', sent_content = ?, confirmed_at = ? WHERE id = ? AND token = ?"
        ).bind(sentContent, nowSec, pending.id, tokenRow.token),
      ]);
      const inserted = countInsertedRows([insertResult]);
      if (inserted > 0) {
        await updateConversationStats(
          env.DB,
          tokenRow.token,
          pending.platform,
          pending.contact_id,
          pending.contact_name,
          inserted,
          { role: "assistant", content: sentContent, source: "ai", created_at: nowSec, message_key: "ai:" + pending.id },
          nowSec
        );
      }
      return json({ success: true, status: "confirmed", inserted });
    }

    // POST /api/vision/describe - image/sticker understanding for chat media
    if (path === "/api/vision/describe" && method === "POST") {
      const authHeader = request.headers.get("Authorization") || "";
      const tokenRow = await validateToken(env.DB, authHeader);
      if (!tokenRow) return json({ error: "无效的设备密钥" }, 401);

      const body = await request.json();
      const imageBase64 = typeof body.image_base64 === "string" ? body.image_base64.trim() : "";
      const mimeType = typeof body.mime_type === "string" && body.mime_type.startsWith("image/")
        ? body.mime_type
        : "image/jpeg";
      if (!imageBase64) return json({ success: false, error: "missing_image_base64" }, 400);
      if (imageBase64.length > 8_000_000) return json({ success: false, error: "image_too_large" }, 413);

      const prompt = typeof body.prompt === "string" && body.prompt.trim()
        ? body.prompt.trim()
        : "只用简洁中文描述这张聊天图片或表情包中的可见文字、人物、物体、情绪和可能含义，不要展开分析过程。";

      const budget = await enforceTokenBudget(env.DB, tokenRow);
      if (!budget.allowed) return json({ success: false, error: "monthly_budget_exhausted" }, 429);

      // deepseek-flash accepts text and image content in the same OpenAI-compatible request.
      const visionKey = env.VISION_API_KEY || env.DEEPSEEK_API_KEY || "";
      if (!visionKey) return json({ success: false, error: "vision_not_configured" }, 503);
      const visionBase = (env.VISION_API_BASE || env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1").replace(/\/+$/, "");
      const visionModel = env.VISION_MODEL || "deepseek-flash";
      const upstream = await fetch(visionBase + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + visionKey },
        body: JSON.stringify({
          model: visionModel,
          temperature: 0.2,
          max_tokens: 512,
          thinking: { type: "disabled" },
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: "data:" + mimeType + ";base64," + imageBase64 } },
            ],
          }],
        }),
      });
      if (!upstream.ok) {
        return json({ success: false, error: "vision_upstream_error", status: upstream.status }, 502);
      }
      const result = await upstream.json();
      const description = result.choices?.[0]?.message?.content?.trim() || "";
      await recordTokenUsage(
        env.DB,
        tokenRow.token,
        estimateLlmCost({
          usage: result.usage,
          inputChars: prompt.length + imageBase64.length / 8,
          outputChars: description.length,
        }, env)
      );
      if (!description) return json({ success: false, error: "vision_empty_response" }, 502);
      return json({ success: true, description, provider: "deepseek" });
    }

    // POST /api/config/save — unified config save (device_key required)
    if (path === "/api/config/save" && method === "POST") {
      const body = await request.json();
      const { device_key, action } = body;
      if (!device_key) return json({ error: "缺少 device_key" }, 400);
      const tokenRow = await validateToken(env.DB, "Bearer " + device_key);
      if (!tokenRow) return json({ error: "设备钥匙无效" }, 401);

      // Verify token
      if (action === "verify_token") return json({ success: true, message: "钥匙有效" });

      // Activate persona
      if (action === "activate_persona") {
        const persona = await activatePersonaForToken(env.DB, tokenRow.token, String(body.persona_id || ""));
        if (!persona) return json({ success: false, error: "人设不存在" });
        return json({ success: true, message: "已切换到" + persona.name, active_persona_id: persona.id, active_persona_name: persona.name });
      }

      // Verify persona
      if (action === "verify_persona") {
        const personaId = body.persona_id || "female";
        const persona = await env.DB.prepare("SELECT id, name FROM personas WHERE id = ?").bind(personaId).first();
        if (!persona) return json({ success: false, error: "人设不存在" });
        return json({ success: true, message: "人设已验证: " + persona.name });
      }

      // Save location
      if (action === "save_location") {
        const values = [body.home_city, body.home_district, body.work_city, body.work_district]
          .map((value) => typeof value === "string" ? value.trim() : "");
        if (values.some((value) => !value || value.length > 64)) {
          return json({ success: false, error: "位置参数无效" }, 400);
        }
        const [homeCity, homeDistrict, workCity, workDistrict] = values;
        const updatedAt = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
          "INSERT INTO user_locations (token, home_city, home_district, work_city, work_district, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
          + "ON CONFLICT(token) DO UPDATE SET home_city = excluded.home_city, home_district = excluded.home_district, work_city = excluded.work_city, work_district = excluded.work_district, updated_at = excluded.updated_at"
        ).bind(tokenRow.token, homeCity, homeDistrict, workCity, workDistrict, updatedAt).run();
        return json({
          success: true,
          message: "位置已同步",
          location: formatLocation({ home_city: homeCity, home_district: homeDistrict, work_city: workCity, work_district: workDistrict }),
        });
      }

      // Switch platform
      if (action === "switch_platform") {
        const platform = normalizePlatform(body.platform);
        if (!platform) return json({ success: false, error: "不支持的平台" }, 400);
        const settings = await saveDeviceSetting(env.DB, tokenRow.token, "platform", platform);
        return json({ success: true, message: "已切换到 " + platform, platform: settings.platform });
      }

      // Toggle hosting / monitoring
      if (action === "toggle_hosting" || action === "toggle_monitor") {
        const enabled = parseBoolean(body.enabled, false);
        const field = action === "toggle_hosting" ? "hosting_enabled" : "monitor_enabled";
        const settings = await saveDeviceSetting(env.DB, tokenRow.token, field, enabled);
        return json({ success: true, message: enabled ? "已开启" : "已暂停", settings });
      }

      // Toggle weather / time
      if (action === "toggle_weather" || action === "toggle_time") {
        const enabled = parseBoolean(body.enabled, true);
        const field = action === "toggle_weather" ? "weather_enabled" : "time_enabled";
        const settings = await saveDeviceSetting(env.DB, tokenRow.token, field, enabled);
        return json({ success: true, message: "设置已保存", settings });
      }

      return json({ success: false, error: "未知 action: " + (action || "null") }, 400);
    }

    return json({ error: "Not Found" }, 404);
  } catch (error) {
    console.error("API request failed", path, error instanceof Error ? error.stack || error.message : String(error));
    return json({ error: "服务器内部错误" }, 500);
  }
};
