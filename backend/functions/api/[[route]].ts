const SENSITIVE_WORDS = [
  "借钱", "转账", "汇款", "银行卡", "账号", "密码",
  "验证码", "支付宝", "微信支付", "红包", "刷单",
  "贷款", "借款", "投资", "理财", "点击链接",
  "http://", "https://", "加微信", "加v", "加群"
];
const PLATFORM_STYLE_HINTS = {
  soul: "偏文艺、走心", qq: "偏年轻、活泼", immomo: "直接、不绕弯", lianxin: "自然、日常",
};

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

function buildTimeSafeReply(reply, messages) {
  if (hasUserTimeMention(messages)) return reply;
  const cleaned = removeUnrequestedTimeMentions(reply);
  if (cleaned) return cleaned;
  const lastMessage = [...messages].reverse().find((message) => message.role === "user")?.content || "";
  if (/(在吗|你好|嗨|hello|哈喽)/i.test(lastMessage)) return "在呢 怎么了";
  if (/(好看|漂亮|帅|喜欢|气质|照片|穿搭|高跟|丝袜)/.test(lastMessage)) return "谢谢 你眼光不错";
  return "嗯 你说";
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

async function loadDeviceLocation(db, token) {
  const row = await db.prepare(
    "SELECT home_city, home_district, work_city, work_district FROM user_locations WHERE token = ?"
  ).bind(token).first();
  return formatLocation(row);
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
      const token = url.searchParams.get("token");
      if (!token) return json({ error: "\u7f3a\u5c11 token" }, 400);
      const platform = url.searchParams.get("platform") || "";
      const contactId = url.searchParams.get("contact_id") || "";
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
      const offset = parseInt(url.searchParams.get("offset") || "0");
      let query = "SELECT id, platform, contact_id, contact_name, role, content, created_at FROM chat_history WHERE token = ?";
      const params = [token];
      if (platform) { query += " AND platform = ?"; params.push(platform); }
      if (contactId) { query += " AND contact_id = ?"; params.push(contactId); }
      query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);
      const { results } = await env.DB.prepare(query).bind(...params).all();
      return json({ history: results || [] });
    }

    // GET /api/contacts
    if (path === "/api/contacts" && method === "GET") {
      if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
      const token = url.searchParams.get("token");
      if (!token) return json({ error: "\u7f3a\u5c11 token" }, 400);
      const platform = url.searchParams.get("platform") || "";
      let query = "SELECT id, token, platform, contact_id, contact_name, is_whitelisted, notes, created_at FROM contacts WHERE token = ?";
      const params = [token];
      if (platform) { query += " AND platform = ?"; params.push(platform); }
      query += " ORDER BY created_at DESC";
      const { results } = await env.DB.prepare(query).bind(...params).all();
      return json({ contacts: results || [] });
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
      const nowSec = Math.floor(Date.now() / 1000);
      const stmt = env.DB.prepare("INSERT INTO chat_history (token, platform, contact_id, contact_name, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
      const batch = messages.map((msg) => stmt.bind(tokenRow.token, platform, contact_id, contact_name, msg.role, msg.content, msg.created_at || nowSec));
      await env.DB.batch(batch);
      await env.DB.prepare("UPDATE tokens SET last_used_at = ? WHERE token = ?").bind(nowSec, tokenRow.token).run();
      return json({ ok: true });
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
      const summaryRow = await env.DB.prepare("SELECT summary, summarized_up_to_id FROM session_summary WHERE token = ? AND platform = ? AND contact_id = ?").bind(tokenRow.token, platform, contact_id).first();
      const summary = summaryRow?.summary || "";
      const { results: allMsgs } = await env.DB.prepare("SELECT id, role, content, created_at FROM chat_history WHERE token = ? AND platform = ? AND contact_id = ? ORDER BY created_at DESC LIMIT ?").bind(tokenRow.token, platform, contact_id, MAX_MSGS + 10).all();
      const allMessages = (allMsgs || []).reverse();
      let hoursAgo = 0;
      for (let i = allMessages.length - 1; i >= 0; i--) { if (allMessages[i].role === "user") { hoursAgo = Math.floor((Date.now() / 1000 - allMessages[i].created_at) / 3600); break; } }
      const historyMessages = allMessages.length <= MAX_MSGS ? allMessages : allMessages.slice(allMessages.length - MAX_MSGS);

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
      if (hoursAgo > 2) {
        systemPrompt += chinaTime.isRestPeriod
          ? "\n\n\u6ce8\u610f\uff1a\u5bf9\u65b9\u6700\u540e\u4e00\u6761\u6d88\u606f\u662f " + hoursAgo + " \u5c0f\u65f6\u524d\u53d1\u7684\u3002\u5f53\u524d\u662f\u6df1\u591c\uff0c\u4e0d\u8981\u8bf4\u521a\u4e0a\u95e8\u6216\u8fd8\u5728\u5916\u9762\u8dd1\uff0c\u4f46\u53ef\u4ee5\u81ea\u7136\u56de\u590d\u4e1a\u52a1\u6d88\u606f\uff0c\u4e5f\u53ef\u4ee5\u5b89\u6392\u660e\u5929\u53bb\u6536\u3002"
          : "\n\n\u6ce8\u610f\uff1a\u5bf9\u65b9\u6700\u540e\u4e00\u6761\u6d88\u606f\u662f " + hoursAgo + " \u5c0f\u65f6\u524d\u53d1\u7684\u3002\u4f60\u4e00\u76f4\u5728\u5fd9\u6ca1\u56de\u590d\uff0c\u73b0\u5728\u521a\u770b\u5230\u3002";
      }
      if (chinaTime.isRestPeriod) {
        systemPrompt += "\n\n\u661f\u66ae\u6b64\u523b\u7684\u771f\u5b9e\u751f\u6d3b\u72b6\u6001\uff1a" + chinaTime.lifeState + "\u3002\u60c5\u7eea\uff1a" + chinaTime.mood + "\u3002\n\u4f60\u8981\u50cf\u4e00\u4e2a\u6709\u6b63\u5e38\u4f5c\u606f\u548c\u60c5\u7eea\u7684\u4eba\uff0c\u4e0d\u662f24\u5c0f\u65f6\u5f85\u547d\u5ba2\u670d\u3002\u5f53\u524d\u72b6\u6001\u53ea\u4f5c\u4e3a\u81ea\u7136\u80cc\u666f\uff0c\u6309\u771f\u5b9e\u53cd\u5e94\u8bf4\u8bdd\uff0c\u4e0d\u8981\u673a\u68b0\u6c47\u62a5\u4f5c\u606f\uff0c\u4e5f\u4e0d\u8981\u7f16\u9020\u4e0e\u5f53\u524d\u72b6\u6001\u51b2\u7a81\u7684\u5de5\u4f5c\u7ecf\u5386\u3002";
      }

      systemPrompt += "\n\n短句聊天风格（必须优先遵守）：\n" +
        "1. 你是在手机上跟陌生人微信式闲聊，不是客服、助手或写作机器人。不要解释、总结、说教，也不要输出客服腔和AI腔。\n" +
        "2. 通常生成2到4条短句，用 ||| 分隔；对方只是打招呼或一句话很简单时，可以只生成1到2条。\n" +
        "3. 总字数控制在10到40字，每条尽量5到18字，不要长段落，不要连续追问。\n" +
        "4. 内容要直接回应对方最后一条消息，像熟人随口聊天，允许轻微口语和情绪，但不要油腻、不要暧昧、不要夸张共情。\n" +
        "5. 输出里除 ||| 外，不要使用句号、逗号、问号、感叹号等标点；需要停顿时用空格。只输出回复正文，不要加引号、标题、序号或解释。";

      // build llm messages
      systemPrompt += "\n\n瞬间/动态引发的聊天规则（优先遵守）：\n" +
        "1. 对方用文字夸奖外貌、穿搭、照片或动态，但没有明确说刚发或新动态时，只当作对方可能看过你的瞬间后搭话。自然接住夸奖，不判断是刚发还是旧动态，不编造你此刻穿着或正在做什么，不追问哪张图以及什么时候看到。\n" +
        "2. 对方明确说刚发、新动态或刚刷到，可以自然回应“刚发就被你看见啦”“这都被你发现了”这类意思，但这些只是表达方向，不是固定话术。每次都要结合对方原话换一种自然说法，不能机械照搬。\n" +
        "3. 对方只发在吗、你好，且没有提到动态时，正常打招呼，不能主动认定对方看了你的瞬间。\n" +
        "4. 不要仅因为当前时间主动说半夜、这么晚、还没睡；只有对方提到作息、睡觉或时间时，才自然回应时间。\n" +
        "5. 先参考你说过的最近内容，避免连续重复相同句式、相同开头和相同夸赞回应；同一个意思要换自然说法。";
      systemPrompt += "\n\n时间词硬限制：只要对方当前或最近消息没有出现睡觉、醒、早上、晚上、凌晨、半夜、时间、几点、这个点等时间相关词，你的回复就绝对不能出现半夜、这么晚、还没睡、没睡、刚醒、夜里、这个点、睡了等时间或作息判断，即使系统时间是凌晨也必须遵守。";
      const llmMessages = [{ role: "system", content: systemPrompt }];
      if (summary) llmMessages.push({ role: "user", content: "\u4e4b\u524d\u7684\u804a\u5929\u5927\u6982\u662f\u8fd9\u6837\uff1a" + summary });
      for (const msg of historyMessages) {
        const timeStr = formatChinaMessageTime(msg.created_at);
        const roleLabel = msg.role === "user" ? "\u5bf9\u65b9\u8bf4" : "\u4f60\u8bf4";
        llmMessages.push({ role: "user", content: "[" + timeStr + "] " + roleLabel + "\uff1a" + msg.content });
      }
      for (const msg of messages) { llmMessages.push({ role: msg.role, content: msg.content }); }

      // call DeepSeek
      const apiKey = env.DEEPSEEK_API_KEY || "";
      const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
        body: JSON.stringify({ model: modelName, messages: llmMessages, temperature, max_tokens: maxTokens }),
      });
      if (!resp.ok) return json({ error: "LLM \u8c03\u7528\u5931\u8d25" }, 502);
      const data = await resp.json();
      const rawReply = data.choices?.[0]?.message?.content?.trim() || "\u6069\u6069\uff0c\u597d\u7684\u3002";
      const reply = buildTimeSafeReply(rawReply, messages);
      const nowSec = Math.floor(Date.now() / 1000);

      // save messages
      const stmt = env.DB.prepare("INSERT INTO chat_history (token, platform, contact_id, contact_name, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
      const batch = messages.map((msg) => stmt.bind(tokenRow.token, platform, contact_id, contact_name, msg.role, msg.content, msg.created_at || nowSec));
      batch.push(stmt.bind(tokenRow.token, platform, contact_id, contact_name, "assistant", reply, nowSec));
      await env.DB.batch(batch);

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
