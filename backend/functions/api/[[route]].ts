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
  let reply = String(value || "").trim();
  const contextPrefix = /^\[[^\]\r\n]{1,100}\]\s*(?:你说|对方说|我说)\s*[：:]\s*/u;
  const speakerPrefix = /^(?:你说|对方说|我说)\s*[：:]\s*/u;
  const timestampPrefix = /^\[(?:(?:今天|昨天|前天)\s*)?\d{1,2}:\d{2}(?::\d{2})?(?:\s*，距今约\d+小时)?\]\s*/u;

  // Keep this limited to the start of the reply so normal text mentioning these words is untouched.
  while (reply) {
    const before = reply;
    reply = reply
      .replace(contextPrefix, "")
      .replace(speakerPrefix, "")
      .replace(timestampPrefix, "")
      .trimStart();
    if (reply === before) break;
  }
  return reply;
}

// 根据当前小时给出"我此刻在干嘛"，让回复场景跟时间对得上（凌晨不说在跑客户）
function currentActivityByHour(hour) {
  if (hour >= 0 && hour < 7) return "现在是深夜，你躺床上睡不着在刷手机，所以回消息慢";
  if (hour >= 7 && hour < 9) return "你刚起床，在洗漱吃早饭，手机放旁边";
  if (hour >= 9 && hour < 12) return "你在回收店里整理收来的手机，偶尔来个客户";
  if (hour >= 12 && hour < 14) return "你刚吃完饭，在店里坐着刷手机，有点困";
  if (hour >= 14 && hour < 18) return "你在店里忙，收货验机跟客户谈事，不一定随时看手机";
  if (hour >= 18 && hour < 21) return "你下班回到家，刚吃完饭，在沙发上玩手机";
  return "你洗完澡躺床上了，准备睡，一边刷手机一边回";
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
      const platformStyle = PLATFORM_STYLE_HINTS[platform] || "自然、日常";
      const currentHour = parseInt((currentDatetime.split(" ")[1] || "12:00:00").split(":")[0], 10) || 12;
      const nowSec2 = Math.floor(Date.now() / 1000);
      const activity = await loadActivityStats(env.DB, tokenRow.token, historyAliases, nowSec2);
      const stage = relationStage(activity.totalExchanges, activity.userMsgs7d);
      const stageText = stage === 1
        ? "你们刚认识，先自然聊，不要显得太熟。"
        : stage === 3
          ? "你们最近互动频繁，可以自然熟络一点，但不要主动推销。"
          : "你们聊过几次，可以延续之前的话题，别突然变陌生。";
      const activityNow = currentActivityByHour(currentHour);

      let systemPrompt = personaPrompt +
        "\n\n当前平台：" + platform + "，语气：" + platformStyle + "。" +
        "\n\n【现在】" + currentDatetime + "（" + weekday + "）。" + activityNow + "。" +
        "你住在" + (location?.home?.city || "重庆") + (location?.home?.district || "") + "，在" + (location?.work?.city || "重庆") + (location?.work?.district || "") + "上班，做旧手机回收。今天" + weather.condition + weather.temp + "度。" +
        (activity.activeDays >= 2 ? "\n这个对象最近7天有" + activity.activeDays + "天都主动找过你，如果隔了很久没回别装作天天在聊。" : "") +
        "\n" + stageText +
        "\n\n说话像手机微信：短句子分行打，别打句号，别用～，结尾反问一句。例：对方说加班好累，你就分三行回「9点？」「你们老板不睡觉吗」「吃晚饭没」。" +
        "\n上下文里的\"对方说\"是对方发的话，\"你说\"是你之前发的话，不要搞混角色。" +
        "\n时间戳和“你说/对方说”只是上下文标记，不是回复内容，禁止写进回复。" +
        "\n别刚加好友就推销回收，别主动提见面，别发联系方式，被质疑是AI就打哈哈带过，别和前面说过的话矛盾。" +
        "\n同一客户绑定多平台账号的，都视为同一个人，记忆必须连续。";

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
      const requestTemperature = temperature;
      const apiKey = env.DEEPSEEK_API_KEY || "";
      const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
        body: JSON.stringify({ model: modelName, messages: llmMessages, temperature: requestTemperature, max_tokens: maxTokens }),
      });
      if (!resp.ok) return json({ error: "LLM \u8c03\u7528\u5931\u8d25" }, 502);
      const data = await resp.json();
      const rawReply = data.choices?.[0]?.message?.content?.trim() || "\u6069\u6069\uff0c\u597d\u7684\u3002";
      const reply = sanitizeAssistantReply(rawReply) || "\u6069\u6069\uff0c\u597d\u7684\u3002";
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
