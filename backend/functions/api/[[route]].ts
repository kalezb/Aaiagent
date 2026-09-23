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
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
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
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    // GET /api/status — health check
    if (path === "/api/status" && method === "GET") {
      await env.DB.prepare("SELECT 1").first();
      return json({ status: "ok", time: Math.floor(Date.now() / 1000) });
    }

    // GET /api/token — list all tokens (Dashboard)
    if (path === "/api/token" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT token, name, monthly_limit, spent, is_active, created_at, last_used_at FROM tokens ORDER BY created_at DESC").all();
      return json({ tokens: results || [] });
    }

    // GET /api/config — App startup config
    if (path === "/api/config" && method === "GET") {
      const persona = await env.DB.prepare("SELECT id, name FROM personas WHERE is_active = 1 LIMIT 1").first();
      return json({
        active_persona_id: persona?.id || "female",
        active_persona_name: persona?.name || "\u2606\u2622",
        platform_style_hints: PLATFORM_STYLE_HINTS,
      });
    }

    // GET /api/chat/history
    if (path === "/api/chat/history" && method === "GET") {
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
      if (!token || !platform || !contact_id || !contact_name) return json({ error: "\u7f3a\u5c11\u5fc5\u8981\u53c2\u6570" }, 400);
      const isWhitelisted = body.is_whitelisted ?? 1;
      const notes = body.notes || "";
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare("INSERT INTO contacts (token, platform, contact_id, contact_name, is_whitelisted, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(token, platform, contact_id) DO UPDATE SET contact_name = excluded.contact_name, is_whitelisted = excluded.is_whitelisted, notes = excluded.notes")
        .bind(token, platform, contact_id, contact_name, isWhitelisted, notes, now).run();
      return json({ success: true });
    }

    // GET /api/persona
    if (path === "/api/persona" && method === "GET") {
      const { results } = await env.DB.prepare("SELECT id, name, system_prompt, is_active, created_at FROM personas ORDER BY created_at").all();
      return json({ personas: results || [] });
    }

    // DELETE /api/persona ? delete a persona (Dashboard)
    if (path === "/api/persona" && method === "DELETE") {
      const body = await request.json();
      const { id } = body;
      if (!id) return json({ error: "缺少 id" }, 400);
      await env.DB.prepare("DELETE FROM personas WHERE id = ?").bind(id).run();
      return json({ success: true });
    }

    // PUT /api/persona
    if (path === "/api/persona" && method === "PUT") {
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
      if (!contact || contact.is_whitelisted === 0) return json({ action: "skip" });

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
      const maxTokens = parseInt(await env.KV.get("llm:max_tokens") || "300");
      const modelName = await env.KV.get("llm:model") || "deepseek-chat";

      // system prompt
      const now2 = new Date();
      const currentDatetime = now2.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
      const weekdays = ["\u5468\u65e5", "\u5468\u4e00", "\u5468\u4e8c", "\u5468\u4e09", "\u5468\u56db", "\u5468\u4e94", "\u5468\u516d"];
      const weekday = weekdays[now2.getDay()];
      const platformStyle = PLATFORM_STYLE_HINTS[platform] || "\u81ea\u7136\u3001\u65e5\u5e38";

      let systemPrompt = personaPrompt + "\n\n\u5f53\u524d\u5e73\u53f0\uff1a" + platform + "\uff0c\u8bf7\u7528\u4ee5\u4e0b\u8bed\u6c14\uff1a" + platformStyle + "\n\n\u73b0\u5728\u662f " + currentDatetime + "\uff08" + weekday + "\uff09\u3002\n\u4f60\u4f4f\u5728" + (location?.home?.city || "\u91cd\u5e86") + (location?.home?.district || "") + "\uff0c\u5728" + (location?.work?.city || "\u91cd\u5e86") + (location?.work?.district || "") + "\u4e0a\u73ed\u3002\n\u4eca\u5929" + weather.condition + "\uff0c\u6c14\u6e29" + weather.temp + "\u00b0C\u3002\n\n\u56de\u590d\u89c4\u5219\uff08\u5fc5\u987b\u9075\u5b88\uff09\uff1a\n1. \"\u5bf9\u65b9\u8bf4\"\u662f\u5bf9\u65b9\u53d1\u7684\u8bdd\uff0c\"\u4f60\u8bf4\"\u662f\u4f60\uff08AI \u626e\u6f14\u7684\u4eba\u8bbe\uff09\u4e4b\u524d\u53d1\u7684\u8bdd\u3002\u4e0d\u8981\u641e\u6df7\u89d2\u8272\u3002\n2. \u6ce8\u610f\u5f53\u524d\u65f6\u95f4\u3002\u665a\u4e0a\u4e0d\u8bf4\"\u65e9\u4e0a\u597d\"\uff0c\u4e0b\u5348\u4e0d\u8bf4\"\u521a\u8d77\u5e8a\"\u3002\n3. \u6ce8\u610f\u5f53\u524d\u5929\u6c14\u3002\u51b7\u5929\u4e0d\u8bf4\u70ed\uff0c\u9634\u5929\u4e0d\u8bf4\u592a\u9633\u5927\u3002\n4. \u5bf9\u65b9\u804a\u5929\u6c14\u65f6\u4ee5\u5bf9\u65b9\u8bf4\u7684\u4e3a\u51c6\u3002\u53ea\u6709\u5bf9\u65b9\u95ee\"\u4f60\u90a3\u8fb9\u51b7\u4e0d\u51b7\"\u65f6\u624d\u8bf4\u81ea\u5df1\u8fd9\u8fb9\u3002\n5. \u5bf9\u65b9\u95ee\u4f4f\u5728\u54ea \u2192 \u8bf4\u5bb6\u5ead\u5730\u5740\uff08home\uff09\u3002\u5bf9\u65b9\u95ee\u5de5\u4f5c\u5728\u54ea \u2192 \u8bf4\u5de5\u4f5c\u5730\u5740\uff08work\uff09\u3002\n6. \u4e0d\u8981\u7f16\u9020\u4e0e\u5bf9\u65b9\u6d88\u606f\u77db\u76fe\u7684\u4e8b\u5b9e\u3002\n7. \u5982\u679c\u4f60\u5f88\u4e45\u6ca1\u56de\u5bf9\u65b9\uff0c\u6b63\u5e38\u8bf4\"\u521a\u5fd9\u5b8c\"\"\u521a\u770b\u5230\u6d88\u606f\"\u3002\u4e0d\u8981\u8bf4\u5bf9\u65b9\u6d88\u5931\u4e86\u2014\u2014\u6d88\u5931\u7684\u4eba\u662f\u4f60\u3002\n8. \u53ea\u56de\u590d\u5bf9\u65b9\u6700\u65b0\u7684\u8fd9\u6761\u6d88\u606f\uff0c\u57fa\u4e8e\u4e0a\u4e0b\u6587\u81ea\u7136\u63a5\u8bdd\u3002";
      if (hoursAgo > 2) systemPrompt += "\n\n\u6ce8\u610f\uff1a\u5bf9\u65b9\u6700\u540e\u4e00\u6761\u6d88\u606f\u662f " + hoursAgo + " \u5c0f\u65f6\u524d\u53d1\u7684\u3002\u4f60\u4e00\u76f4\u5728\u5fd9\u6ca1\u56de\u590d\uff0c\u73b0\u5728\u521a\u770b\u5230\u3002";

      // build llm messages
      const llmMessages = [{ role: "system", content: systemPrompt }];
      if (summary) llmMessages.push({ role: "user", content: "\u4e4b\u524d\u7684\u804a\u5929\u5927\u6982\u662f\u8fd9\u6837\uff1a" + summary });
      for (const msg of historyMessages) {
        const timeStr = new Date(msg.created_at * 1000).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" });
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
      const reply = data.choices?.[0]?.message?.content?.trim() || "\u6069\u6069\uff0c\u597d\u7684\u3002";
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

    return json({ error: "Not Found" }, 404);
  } catch (error) {
    return json({ error: "\u670d\u52a1\u5668\u5185\u90e8\u9519\u8bef" }, 500);
  }
};
