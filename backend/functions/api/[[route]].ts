const SENSITIVE_WORDS = [
  "借钱", "转账", "汇款", "银行卡", "账号", "密码",
  "验证码", "支付宝", "微信支付", "红包", "刷单",
  "贷款", "借款", "投资", "理财", "点击链接",
  "http://", "https://", "加微信", "加v", "加群"
];
const PLATFORM_STYLE_HINTS = {
  soul: "偏文艺、走心", qq: "偏年轻、活泼", immomo: "直接、不绕弯", lianxin: "自然、日常",
};
const SUPPORTED_PLATFORMS = ["soul", "qq", "immomo", "lianxin"];

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
  const row = await db.prepare("SELECT token, is_active, monthly_limit, spent FROM tokens WHERE token = ?").bind(token).first();
  return (row && row.is_active !== 0) ? row : null;
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
  const hour = Number(value("hour"));
  let period = "深夜";
  let lifeState = "半夜在休息，可能还没睡、刚被消息吵醒或躺着刷手机；不会亲自上门，但业务消息可以远程回复，也能安排白天或明早让人去收";
  let mood = "有点困、说话随意；聊到业务时仍然会把事情安排清楚";
  if (hour >= 6 && hour < 9) period = "清晨";
  else if (hour >= 9 && hour < 12) period = "上午";
  else if (hour >= 12 && hour < 14) period = "中午";
  else if (hour >= 14 && hour < 18) period = "下午";
  else if (hour >= 18 && hour < 23) period = "晚上";
  if (hour >= 6 && hour < 8) { lifeState = "刚醒，正在洗漱准备开始一天"; mood = "还没完全清醒"; }
  else if (hour >= 8 && hour < 12) { lifeState = "上午在忙回收，可能在上门、看机器或和客户沟通"; mood = "忙但正常"; }
  else if (hour >= 12 && hour < 14) { lifeState = "中午吃饭休息，手上的事暂时放一放"; mood = "放松、随意"; }
  else if (hour >= 14 && hour < 18) { lifeState = "下午继续忙回收，偶尔有空看手机"; mood = "忙里有闲"; }
  else if (hour >= 18 && hour < 21) { lifeState = "忙完回家，吃饭、收拾、放松"; mood = "轻松"; }
  else if (hour >= 21 && hour < 23) { lifeState = "在家休息，刷手机或准备洗漱"; mood = "放松"; }
  else if (hour >= 23) { lifeState = "准备睡觉或已经躺下了"; mood = "困、想休息"; }
  return {
    hour,
    period,
    lifeState,
    mood,
    isRestPeriod: hour >= 23 || hour < 7,
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

function latestIncomingAgeHours(messages, historyMessages, nowSec) {
  const latestIncoming = [...messages].reverse().find((message) => message?.role === "user");
  if (!latestIncoming) return null;
  let epoch = requestMessageEpochSeconds(latestIncoming);
  if (!epoch) {
    const content = String(latestIncoming.content || "").trim();
    const matchingHistory = [...(historyMessages || [])].reverse().find((message) =>
      message?.role === "user" && String(message.content || "").trim() === content
    );
    epoch = Number(matchingHistory?.created_at || 0);
  }
  return epoch > 0 ? Math.max(0, Math.floor((nowSec - epoch) / 3600)) : null;
}

const USER_TIME_MENTION_PATTERN = /(睡|醒|早|晚|凌晨|半夜|时间|几点|这个点|夜里|夜深)/;
const UNREQUESTED_TIME_CLAUSE_PATTERN = /(大半夜|半夜|凌晨|这么晚|这个点|还没睡|没睡着|没睡|刚醒|醒着|夜里|夜深|睡了|早点睡|很晚了|太晚了|晚睡|熬夜|大晚上)/;

function hasUserTimeMention(messages) {
  return messages.some((message) =>
    message.role === "user" && USER_TIME_MENTION_PATTERN.test(String(message.content || ""))
  );
}

function removeUnrequestedTimeMentions(reply) {
  return reply
    .split("|||")
    .map((segment) => segment
      .split(/\s+/)
      .filter(Boolean)
      .filter((clause) => !UNREQUESTED_TIME_CLAUSE_PATTERN.test(clause))
      .join(" ")
      .trim())
    .filter(Boolean)
    .join("|||");
}

const STALE_REPLY_EXCUSE_PATTERN = /(刚忙完|刚看到|刚翻到|刚回来|刚有空|才看到|才翻到|才回|最近忙|这几天忙|忙得|忙晕|一直忙|隔了.{0,4}才|现在才回|这么久才回)/;
const STALE_CURRENT_STATE_PATTERN = /(我这边|刚静下来|刚安静下来|刚坐下|刚到家|才回家|准备(?:歇|睡|休息)|要睡|马上睡|我也准备|吃点|去吃|现在去|一会儿|跑了.{0,5}小区|跑小区|送货|上门|见客户|天都黑|黑透|今天(?:有|去|吃|聚|跑|上班|工作|晴|雨|冷|热)|现在.*(?:晴|雨|冷|热|忙|吃|去|跑))/;


function userAskedAboutOwnCurrentState(messages) {
  const lastMessage = [...messages].reverse().find((message) => message.role === "user")?.content || "";
  return /(?:你|星暮).{0,8}(?:在干嘛|干嘛呢|做什么|忙什么|忙不忙|忙吗|到家|回家|吃饭|吃了吗|下班|上班|睡|休息|天气|冷不冷|热不热)|(?:你在哪|你那里)/.test(lastMessage);
}

function removeUnsupportedReplyAssertions(reply) {
  return String(reply || "")
    .split("|||")
    .map((segment) => segment
      .split(/\s+/)
      .filter(Boolean)
      .filter((clause) => !STALE_REPLY_EXCUSE_PATTERN.test(clause) && !STALE_CURRENT_STATE_PATTERN.test(clause))
      .join(" ")
      .trim())
    .filter(Boolean)
    .join(" ||| ");
}

function staleReplyMismatchesQuestion(reply, messages) {
  const lastMessage = [...messages].reverse().find((message) => message.role === "user")?.content || "";
  const userAskedQuestion = /[?？]|问号|疑问|怎么|为啥|为什么|吗|呢/.test(lastMessage);
  return /问号|几个问|发错/.test(reply) && !userAskedQuestion;
}

function staleReplyNeedsContextFallback(reply, messages) {
  const lastMessage = [...messages].reverse().find((message) => message.role === "user")?.content || "";
  const containsRelativeTime = /(今天|明天|今晚|晚点|等会|一会儿|现在|刚)/.test(lastMessage);
  const replyHasPastAnchor = /(前几天|那天|后来|当时|已经|过了|中秋)/.test(reply);
  return containsRelativeTime && !replyHasPastAnchor;
}

function buildTimeSafeReply(reply, messages, hoursAgo = null) {
  const candidate = userAskedAboutOwnCurrentState(messages)
    ? String(reply || "")
    : removeUnsupportedReplyAssertions(reply);
  if (hoursAgo !== null && hoursAgo >= 24 && staleReplyMismatchesQuestion(candidate, messages)) {
    return buildFallbackReply(messages);
  }
  if (hoursAgo !== null && hoursAgo >= 24 && staleReplyNeedsContextFallback(candidate, messages)) {
    return buildFallbackReply(messages);
  }
  if (hasUserTimeMention(messages)) return candidate;
  const cleaned = removeUnrequestedTimeMentions(candidate);
  if (cleaned) return cleaned;
  return buildFallbackReply(messages);
}

function buildFallbackReply(messages) {
  const lastMessage = [...messages].reverse().find((message) => message.role === "user")?.content || "";
  if (/(在吗|你好|嗨|hello|哈喽)/i.test(lastMessage)) return "在呢 怎么了";
  if (/聚餐|聚会/.test(lastMessage)) return "前几天聚餐还开心吧";
  if (/回宿舍|回屋|到家|回去/.test(lastMessage)) return "嗯 回去早点休息";
  if (/中秋/.test(lastMessage)) return "中秋快乐";
  if (/(好看|漂亮|帅|喜欢|气质|照片|穿搭|高跟|丝袜)/.test(lastMessage)) return "谢谢 你眼光不错";
  return "嗯 你说";
}

async function maybeExtractCustomerProfile(env, tokenRow, platform, contactId) {
  if (!env.DEEPSEEK_API_KEY) return;
  const token = tokenRow.token;
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
  const maxId = Number(state?.max_id || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!candidates.length) {
    await env.DB.prepare(
      "INSERT INTO customer_profiles (token, group_id, profile_json, last_processed_message_id, extracted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token, group_id) DO UPDATE SET last_processed_message_id = excluded.last_processed_message_id, extracted_at = excluded.extracted_at, updated_at = excluded.updated_at"
    ).bind(token, groupId, JSON.stringify(existing.profile), maxId, now, now).run();
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
  const extracted = parseJsonObject(data.choices?.[0]?.message?.content, null);
  if (!extracted || typeof extracted !== "object") return;
  const merged = mergeCustomerProfile(existing.profile, extracted);
  await env.DB.prepare(
    "INSERT INTO customer_profiles (token, group_id, profile_json, last_processed_message_id, extracted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token, group_id) DO UPDATE SET profile_json = excluded.profile_json, last_processed_message_id = excluded.last_processed_message_id, extracted_at = excluded.extracted_at, updated_at = excluded.updated_at"
  ).bind(token, groupId, JSON.stringify(merged), maxId, now, now).run();
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

async function loadDeviceLocation(db, token) {
  const row = await db.prepare(
    "SELECT home_city, home_district, work_city, work_district FROM user_locations WHERE token = ?"
  ).bind(token).first();
  return formatLocation(row);
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

function makeSyncedMessageKey(token, platform, contactId, message, index) {
  const clientKey = String(message.message_key || message.messageId || "").trim();
  if (clientKey) return clientKey.slice(0, 220);
  const role = message.role === "assistant" ? "assistant" : "user";
  const createdAt = Number(message.created_at || 0);
  const fingerprint = [role, String(message.content || ""), createdAt, index].join("\u001f");
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
    0,
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

function formatMemoryLines(messages, maxChars = 1800) {
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

function mergeMemorySummary(existingSummary, messages, maxChars = 2400) {
  const addition = formatMemoryLines(messages);
  const merged = [String(existingSummary || "").trim(), addition].filter(Boolean).join("\n");
  return merged.length <= maxChars ? merged : merged.slice(merged.length - maxChars);
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
      const { results } = await env.DB.prepare("SELECT token, name, monthly_limit, spent, is_active, created_at, last_used_at FROM tokens ORDER BY created_at DESC").all();
      return json({ tokens: results || [] });
    }

    // GET /api/config — App startup config
    if (path === "/api/config" && method === "GET") {
      const persona = await env.DB.prepare("SELECT id, name FROM personas WHERE is_active = 1 LIMIT 1").first();
      const authHeader = request.headers.get("Authorization") || "";
      const tokenRow = authHeader ? await validateToken(env.DB, authHeader) : null;
      const location = tokenRow ? await loadDeviceLocation(env.DB, tokenRow.token) : null;
      return json({
        active_persona_id: persona?.id || "female",
        active_persona_name: persona?.name || "\u2606\u2622",
        platform_style_hints: PLATFORM_STYLE_HINTS,
        location,
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
          { role: "assistant", content: task.content, source: "dashboard", created_at: now },
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


    // GET /api/persona
    if (path === "/api/persona" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT id, name, system_prompt, is_active, created_at FROM personas ORDER BY CASE WHEN id LIKE 'female%' THEN 0 WHEN id LIKE 'male%' THEN 1 ELSE 2 END, created_at, id").all();
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

    // POST /api/token
    if (path === "/api/token" && method === "POST") {
      const body = await request.json();
      const { token } = body;
      if (!token) return json({ error: "\u7f3a\u5c11 token" }, 400);
      const name = body.name || "";
      const monthlyLimit = body.monthly_limit ?? 30;
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
      if (body.monthly_limit !== undefined) { updates.push("monthly_limit = ?"); params.push(body.monthly_limit); }
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
      if (body.model_name) await env.KV.put("llm:model", body.model_name);
      if (body.api_base) await env.KV.put("llm:base_url", body.api_base);
      if (body.temperature !== undefined) await env.KV.put("llm:temperature", String(body.temperature));
      if (body.max_tokens !== undefined) await env.KV.put("llm:max_tokens", String(body.max_tokens));
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
          message_key: makeSyncedMessageKey(tokenRow.token, platform, contact_id, msg, index),
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
      const body = await request.json();
      const { platform, contact_id, contact_name, location, messages } = body;
      if (!platform || !contact_id || !contact_name || !messages || !Array.isArray(messages) || messages.length === 0) return json({ error: "\u7f3a\u5c11\u5fc5\u8981\u53c2\u6570" }, 400);

      // sensitive word check
      const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
      const userContent = lastUserMsg?.content || "";
      if (SENSITIVE_WORDS.some((w) => userContent.includes(w))) {
        const nowSec = Math.floor(Date.now() / 1000);
        await env.DB.prepare("INSERT INTO chat_history (token, platform, contact_id, contact_name, role, content, created_at) VALUES (?, ?, ?, ?, 'user', ?, ?)").bind(tokenRow.token, platform, contact_id, contact_name, userContent, nowSec).run();
        return json({ action: "safe_reply", reply: "\u8fd9\u4e2a\u6211\u4e0d\u592a\u65b9\u4fbf\u804a\uff0c\u6362\u4e2a\u8bdd\u9898\u5427" });
      }

      // whitelist check
      const contact = await env.DB.prepare("SELECT is_whitelisted FROM contacts WHERE token = ? AND platform = ? AND contact_id = ?").bind(tokenRow.token, platform, contact_id).first();
      if (!contact) {
        const nowSec2 = Math.floor(Date.now() / 1000);
        await env.DB.prepare("INSERT INTO contacts (token, platform, contact_id, contact_name, is_whitelisted, notes, created_at) VALUES (?, ?, ?, ?, 1, '', ?)").bind(tokenRow.token, platform, contact_id, contact_name, nowSec2).run();
      } else if (contact.is_whitelisted === 0) {
        return json({ action: "skip" });
      }

      // persona
      const activePersona = await env.DB.prepare("SELECT id, system_prompt FROM personas WHERE is_active = 1 LIMIT 1").first();
      const personaPrompt = activePersona?.system_prompt || "\u4f60\u662f\u4e00\u4e2a\u53cb\u597d\u7684\u804a\u5929\u52a9\u624b\u3002";

      // history
      const MAX_MSGS = 40;
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
      const { results: allMsgs } = await historyStatement.all();
      const allMessages = (allMsgs || []).reverse();
      const hoursAgo = latestIncomingAgeHours(messages, allMessages, Math.floor(Date.now() / 1000));
      const historyMessages = allMessages.length <= MAX_MSGS ? allMessages : allMessages.slice(allMessages.length - MAX_MSGS);
      const olderMessages = allMessages.slice(0, Math.max(0, allMessages.length - MAX_MSGS))
        .filter((message) => Number(message.id || 0) > memoryRow.summarizedUpToId);
      const summary = mergeMemorySummary(memoryRow.summary, olderMessages);
      const summarizedUpToId = olderMessages.reduce((max, message) => Math.max(max, Number(message.id || 0)), memoryRow.summarizedUpToId);
      if (olderMessages.length > 0) {
        await persistMemorySummary(env.DB, tokenRow.token, currentLink?.group_id || "", historyAliases, summary, summarizedUpToId);
      }

      // weather
      const homeCity = location?.home?.city || "\u91cd\u5e86";
      const weather = await getWeather(homeCity, env.KV, env.WEATHER_API_KEY || "");

      // model config
      const temperature = parseFloat(await env.KV.get("llm:temperature") || "0.7");
      const maxTokens = parseInt(await env.KV.get("llm:max_tokens") || "160");
      const modelName = await env.KV.get("llm:model") || "deepseek-chat";

      // system prompt
      const now2 = new Date();
      const chinaTime = getChinaTimeContext(now2);
      const currentDatetime = chinaTime.currentDatetime;
      const weekday = chinaTime.weekday;
      const platformStyle = PLATFORM_STYLE_HINTS[platform] || "\u81ea\u7136\u3001\u65e5\u5e38";

      let systemPrompt = personaPrompt + "\n\n\u5f53\u524d\u5e73\u53f0\uff1a" + platform + "\uff0c\u8bf7\u7528\u4ee5\u4e0b\u8bed\u6c14\uff1a" + platformStyle + "\n\n\u73b0\u5728\u662f " + currentDatetime + "\uff08" + weekday + "\uff09\u3002\n\u4f60\u4f4f\u5728" + (location?.home?.city || "\u91cd\u5e86") + (location?.home?.district || "") + "\uff0c\u5728" + (location?.work?.city || "\u91cd\u5e86") + (location?.work?.district || "") + "\u4e0a\u73ed\u3002\n\u4eca\u5929" + weather.condition + "\uff0c\u6c14\u6e29" + weather.temp + "\u00b0C\u3002\n\n\u56de\u590d\u89c4\u5219\uff08\u5fc5\u987b\u9075\u5b88\uff09\uff1a\n1. \"\u5bf9\u65b9\u8bf4\"\u662f\u5bf9\u65b9\u53d1\u7684\u8bdd\uff0c\"\u4f60\u8bf4\"\u662f\u4f60\uff08AI \u626e\u6f14\u7684\u4eba\u8bbe\uff09\u4e4b\u524d\u53d1\u7684\u8bdd\u3002\u4e0d\u8981\u641e\u6df7\u89d2\u8272\u3002\n2. \u6ce8\u610f\u5f53\u524d\u65f6\u95f4\u3002\u665a\u4e0a\u4e0d\u8bf4\"\u65e9\u4e0a\u597d\"\uff0c\u4e0b\u5348\u4e0d\u8bf4\"\u521a\u8d77\u5e8a\"\u3002\n3. \u6ce8\u610f\u5f53\u524d\u5929\u6c14\u3002\u51b7\u5929\u4e0d\u8bf4\u70ed\uff0c\u9634\u5929\u4e0d\u8bf4\u592a\u9633\u5927\u3002\n4. \u5bf9\u65b9\u804a\u5929\u6c14\u65f6\u4ee5\u5bf9\u65b9\u8bf4\u7684\u4e3a\u51c6\u3002\u53ea\u6709\u5bf9\u65b9\u95ee\"\u4f60\u90a3\u8fb9\u51b7\u4e0d\u51b7\"\u65f6\u624d\u8bf4\u81ea\u5df1\u8fd9\u8fb9\u3002\n5. \u5bf9\u65b9\u95ee\u4f4f\u5728\u54ea \u2192 \u8bf4\u5bb6\u5ead\u5730\u5740\uff08home\uff09\u3002\u5bf9\u65b9\u95ee\u5de5\u4f5c\u5728\u54ea \u2192 \u8bf4\u5de5\u4f5c\u5730\u5740\uff08work\uff09\u3002\n6. \u4e0d\u8981\u7f16\u9020\u4e0e\u5bf9\u65b9\u6d88\u606f\u77db\u76fe\u7684\u4e8b\u5b9e\u3002\n7. \u5982\u679c\u4f60\u5f88\u4e45\u6ca1\u56de\u5bf9\u65b9\uff0c\u6b63\u5e38\u8bf4\"\u521a\u5fd9\u5b8c\"\"\u521a\u770b\u5230\u6d88\u606f\"\u3002\u4e0d\u8981\u8bf4\u5bf9\u65b9\u6d88\u5931\u4e86\u2014\u2014\u6d88\u5931\u7684\u4eba\u662f\u4f60\u3002\n8. \u53ea\u56de\u590d\u5bf9\u65b9\u6700\u65b0\u7684\u8fd9\u6761\u6d88\u606f\uff0c\u57fa\u4e8e\u4e0a\u4e0b\u6587\u81ea\u7136\u63a5\u8bdd\u3002";
      if (hoursAgo !== null && hoursAgo > 2) {
        systemPrompt += chinaTime.isRestPeriod
          ? "\n\n\u6ce8\u610f\uff1a\u5bf9\u65b9\u6700\u540e\u4e00\u6761\u6d88\u606f\u662f " + hoursAgo + " \u5c0f\u65f6\u524d\u53d1\u7684\u3002\u5f53\u524d\u662f\u6df1\u591c\uff0c\u4e0d\u8981\u8bf4\u521a\u4e0a\u95e8\u6216\u8fd8\u5728\u5916\u9762\u8dd1\uff0c\u4f46\u53ef\u4ee5\u81ea\u7136\u56de\u590d\u4e1a\u52a1\u6d88\u606f\uff0c\u4e5f\u53ef\u4ee5\u5b89\u6392\u660e\u5929\u53bb\u6536\u3002"
          : "\n\n\u6ce8\u610f\uff1a\u5bf9\u65b9\u6700\u540e\u4e00\u6761\u6d88\u606f\u662f " + hoursAgo + " \u5c0f\u65f6\u524d\u53d1\u7684\u3002\u4e0d\u8981\u5047\u88c5\u521a\u521a\u770b\u5230\uff0c\u4e5f\u4e0d\u8981\u7f16\u9020\u8fd9\u51e0\u5929\u505a\u8fc7\u4ec0\u4e48\uff1b\u76f4\u63a5\u56de\u5e94\u5bf9\u65b9\u7684\u539f\u8bdd\uff0c\u53ef\u81ea\u7136\u8865\u4e00\u53e5\u9694\u4e86\u51e0\u5929\u624d\u56de\u3002";
      }
      if (chinaTime.isRestPeriod) {
        systemPrompt += "\n\n\u661f\u66ae\u6b64\u523b\u7684\u771f\u5b9e\u751f\u6d3b\u72b6\u6001\uff1a" + chinaTime.lifeState + "\u3002\u60c5\u7eea\uff1a" + chinaTime.mood + "\u3002\n\u4f60\u8981\u50cf\u4e00\u4e2a\u6709\u6b63\u5e38\u4f5c\u606f\u548c\u60c5\u7eea\u7684\u4eba\uff0c\u4e0d\u662f24\u5c0f\u65f6\u5f85\u547d\u5ba2\u670d\u3002\u5f53\u524d\u72b6\u6001\u53ea\u4f5c\u4e3a\u81ea\u7136\u80cc\u666f\uff0c\u6309\u771f\u5b9e\u53cd\u5e94\u8bf4\u8bdd\uff0c\u4e0d\u8981\u673a\u68b0\u6c47\u62a5\u4f5c\u606f\uff0c\u4e5f\u4e0d\u8981\u7f16\u9020\u4e0e\u5f53\u524d\u72b6\u6001\u51b2\u7a81\u7684\u5de5\u4f5c\u7ecf\u5386\u3002";
      }
      if (hoursAgo !== null && hoursAgo >= 24) {
        systemPrompt += "\n\n旧消息约束（必须遵守）：对方这条消息已经过去 " + hoursAgo + " 小时。不要提刚忙完、刚看到、才翻到、最近忙、隔了几天或现在才回，不要解释为什么晚回，不要描述这几天做过什么，也不要提我这边、现在、今天、天气、刚到家或刚静下来。只直接回应对方原文，过去事件用过去语气承载，不给当前或未来建议。";
      }

      systemPrompt += "\n\n短句聊天风格（必须优先遵守）：\n" +
        "1. 你是在手机上跟陌生人微信式闲聊，不是客服、助手或写作机器人。不要解释、总结、说教，也不要输出客服腔和AI腔。\n" +
        "2. 通常生成2到4条短句，用 ||| 分隔；对方只是打招呼或一句话很简单时，可以只生成1到2条。\n" +
        "3. 总字数控制在10到40字，每条尽量5到18字，不要长段落，不要连续追问。\n" +
        "4. 内容要直接回应对方最后一条消息，像熟人随口聊天，允许轻微口语和情绪，但不要油腻、不要暧昧、不要夸张共情。\n" +
        "5. 输出里除 ||| 外，不要使用句号、逗号、问号、感叹号等标点；需要停顿时用空格。只输出回复正文，不要加引号、标题、序号或解释。";

      systemPrompt += "\n\n事实约束（优先级最高）：\n" +
        "1. 只能把聊天记录里明确出现的内容当成事实，不要猜测或补全对方没说的事情。\n" +
        "2. 禁止编造自己正在做什么、去过哪里、见了谁、吃了什么、聚餐、跑小区、送货等具体活动；聊天记录没出现就不要提。\n" +
        "3. 只有系统明确给出“对方最后一条消息是多少小时前发的”时，才可以提很久没回；没有时间依据时不要主动说刚忙完、刚看到或汇报近况。\n" +
        "4. 直接回应对方最后一条消息。对方只是问候或说一句与时间无关的话时，只接这句话，不要扯工作、天气、行程或生活流水账。\n" +
        "5. 如果上面的规则与本段冲突，以本段为准。";

      systemPrompt += "\n\n同一客户可能绑定 Soul、QQ、陌陌、连信上的多个账号，历史中的不同平台昵称都视为同一个人，记忆必须连续。";

      // build llm messages
      systemPrompt += "\n\n旧消息回复规则（覆盖前面冲突规则）：发现消息距今超过24小时时，直接回应内容，不解释晚回原因，不提刚忙完、刚看到、最近在忙、这几天、隔了几天、聚餐、跑小区或任何未在聊天记录中出现的生活经历。对方只是问候时，用一句自然的话接住即可。";
      systemPrompt += "\n\n对方夸奖外貌、穿搭、身材、照片或动态时，直接自然接住夸奖，然后正常继续聊天。";
      const llmMessages = [{ role: "system", content: systemPrompt }];
      if (summary) llmMessages.push({ role: "user", content: "\u4e4b\u524d\u7684\u804a\u5929\u5927\u6982\u662f\u8fd9\u6837\uff1a" + summary });
      for (const msg of historyMessages) {
        const timeStr = formatChinaMessageTime(msg.created_at);
        const roleLabel = msg.role === "user" ? "\u5bf9\u65b9\u8bf4" : "\u4f60\u8bf4";
        const platformLabel = PLATFORM_STYLE_HINTS[msg.platform] ? msg.platform : "未知平台";
        llmMessages.push({ role: "user", content: "[" + platformLabel + " " + timeStr + "] " + roleLabel + "\uff1a" + msg.content });
      }
      for (const msg of messages) {
        llmMessages.push({ role: msg.role, content: formatCurrentChatMessage(msg) });
      }

      // call DeepSeek
      const requestTemperature = hoursAgo !== null && hoursAgo >= 24 ? Math.min(temperature, 0.2) : temperature;
      const apiKey = env.DEEPSEEK_API_KEY || "";
      const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
        body: JSON.stringify({ model: modelName, messages: llmMessages, temperature: requestTemperature, max_tokens: maxTokens }),
      });
      if (!resp.ok) return json({ error: "LLM \u8c03\u7528\u5931\u8d25" }, 502);
      const data = await resp.json();
      const rawReply = data.choices?.[0]?.message?.content?.trim() || "\u6069\u6069\uff0c\u597d\u7684\u3002";
      const reply = buildTimeSafeReply(rawReply, messages, hoursAgo);
      const nowSec = Math.floor(Date.now() / 1000);

      // User messages arrive through the idempotent sync outbox. Only write the generated AI
      // reply here so repeated phone snapshots do not grow D1 writes without limit.
      const insertResult = await env.DB.prepare(
        "INSERT OR IGNORE INTO chat_history (token, platform, contact_id, contact_name, role, content, created_at, source, message_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        tokenRow.token,
        platform,
        contact_id,
        contact_name,
        "assistant",
        reply,
        nowSec,
        "ai",
        "ai:" + crypto.randomUUID()
      ).run();
      await updateConversationStats(
        env.DB,
        tokenRow.token,
        platform,
        contact_id,
        contact_name,
        countInsertedRows([insertResult]),
        { role: "assistant", content: reply, source: "ai", created_at: nowSec },
        nowSec
      );

      // update token
      await env.DB.prepare("UPDATE tokens SET last_used_at = ?, spent = spent + 0.01 WHERE token = ?").bind(nowSec, tokenRow.token).run();

      return json({ action: "send", reply });
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
        const persona = await activatePersona(env.DB, String(body.persona_id || ""));
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
        const platform = body.platform || "soul";
        return json({ success: true, message: "已切换到 " + platform });
      }

      // Toggle hosting
      if (action === "toggle_hosting") {
        return json({ success: true, message: body.enabled === "true" ? "托管已开启" : "托管已暂停" });
      }

      // Toggle weather / time
      if (action === "toggle_weather" || action === "toggle_time") {
        return json({ success: true, message: "设置已保存" });
      }

      return json({ success: false, error: "未知 action: " + (action || "null") }, 400);
    }

    return json({ error: "Not Found" }, 404);
  } catch (error) {
    console.error("API request failed", path, error instanceof Error ? error.stack || error.message : String(error));
    return json({ error: "服务器内部错误" }, 500);
  }
};
