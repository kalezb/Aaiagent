// functions/api/chat.ts - POST /api/chat（调 LLM 生成回复）
import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  DEEPSEEK_API_KEY?: string;
  WEATHER_API_KEY?: string;
};

type ChatRequest = {
  platform: string;
  contact_id: string;
  contact_name: string;
  location: {
    home: { city: string; district: string };
    work: { city: string; district: string };
  };
  messages: Array<{ role: string; content: string; created_at?: number }>;
};

const chatRouter = new Hono<{ Bindings: Bindings }>();

// 敏感词列表
const SENSITIVE_WORDS = [
  "借钱", "转账", "汇款", "银行卡", "账号", "密码",
  "验证码", "支付宝", "微信支付", "红包", "刷单",
  "贷款", "借款", "投资", "理财", "点击链接",
  "http://", "https://", "加微信", "加v", "加群"
];

function containsSensitiveWords(text: string): boolean {
  return SENSITIVE_WORDS.some((w) => text.includes(w));
}

// 平台风格提示
const PLATFORM_STYLE_HINTS: Record<string, string> = {
  soul: "偏文艺、走心",
  qq: "偏年轻、活泼",
  immomo: "直接、不绕弯",
  lianxin: "自然、日常",
};

// 获取天气
async function getWeather(
  city: string,
  kv: KVNamespace,
  apiKey: string
): Promise<{ condition: string; temp: number }> {
  try {
    // 检查 KV 缓存
    const cached = await kv.get("weather:cache", "json") as {
      city?: string;
      temp?: number;
      condition?: string;
      updated_at?: number;
    } | null;

    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.city === city && cached.updated_at && now - cached.updated_at < 1800) {
      return { condition: cached.condition || "晴", temp: cached.temp || 20 };
    }

    // 调和风天气 API
    const geoUrl = +""+https://geoapi.qweather.com/v2/city/lookup?location=}&key=}+""+;
    const geoResp = await fetch(geoUrl);
    const geoData = await geoResp.json() as { location?: Array<{ id: string }> };

    if (!geoData.location || geoData.location.length === 0) {
      return { condition: "晴", temp: 20 };
    }

    const locationId = geoData.location[0].id;
    const weatherUrl = +""+https://devapi.qweather.com/v7/weather/now?location=}&key=}+""+;
    const weatherResp = await fetch(weatherUrl);
    const weatherData = await weatherResp.json() as { now?: { text: string; temp: string } };

    const condition = weatherData.now?.text || "晴";
    const temp = parseInt(weatherData.now?.temp || "20");

    // 缓存 30 分钟
    await kv.put("weather:cache", JSON.stringify({
      city,
      temp,
      condition,
      updated_at: now,
    }));

    return { condition, temp };
  } catch (error) {
    console.error("Weather fetch error:", error);
    return { condition: "晴", temp: 20 };
  }
}

// 获取最近 20 轮历史 + 摘要
async function getRecentHistory(
  db: D1Database,
  token: string,
  platform: string,
  contactId: string
): Promise<{ messages: Array<{ role: string; content: string; created_at: number }>; summary: string; hoursAgo: number }> {
  const MAX_ROUNDS = 20;
  const MAX_MESSAGES = MAX_ROUNDS * 2;

  // 先查 session_summary
  const summaryRow = await db.prepare(
    "SELECT summary, summarized_up_to_id FROM session_summary WHERE token = ? AND platform = ? AND contact_id = ?"
  )
    .bind(token, platform, contactId)
    .first<{ summary: string; summarized_up_to_id: number }>();

  const summary = summaryRow?.summary || "";

  const { results } = await db
    .prepare(
      +""+SELECT id, role, content, created_at FROM chat_history
       WHERE token = ? AND platform = ? AND contact_id = ?
       ORDER BY created_at DESC LIMIT ?+""+
    )
    .bind(token, platform, contactId, MAX_MESSAGES + 10)
    .all();

  if (!results || results.length === 0) {
    return { messages: [], summary, hoursAgo: 0 };
  }

  const allMessages = (results as Array<{
    id: number;
    role: string;
    content: string;
    created_at: number;
  }>).reverse();

  // 计算最后一条 user 消息距离现在多久
  let hoursAgo = 0;
  for (let i = allMessages.length - 1; i >= 0; i--) {
    if (allMessages[i].role === "user") {
      hoursAgo = Math.floor((Date.now() / 1000 - allMessages[i].created_at) / 3600);
      break;
    }
  }

  let messages: Array<{ role: string; content: string; created_at: number }>;

  if (allMessages.length <= MAX_MESSAGES) {
    messages = allMessages.map((m) => ({
      role: m.role,
      content: m.content,
      created_at: m.created_at,
    }));
  } else {
    messages = allMessages.slice(allMessages.length - MAX_MESSAGES).map((m) => ({
      role: m.role,
      content: m.content,
      created_at: m.created_at,
    }));
  }

  return { messages, summary, hoursAgo };
}

// 检查是否需要重新生成摘要（每新增 10 条）
async function maybeRegenerateSummary(
  db: D1Database,
  token: string,
  platform: string,
  contactId: string,
  deepseekKey: string
) {
  try {
    const summaryRow = await db.prepare(
      "SELECT summary, summarized_up_to_id FROM session_summary WHERE token = ? AND platform = ? AND contact_id = ?"
    )
      .bind(token, platform, contactId)
      .first<{ summary: string; summarized_up_to_id: number }>();

    const maxIdRow = await db.prepare(
      "SELECT MAX(id) as max_id FROM chat_history WHERE token = ? AND platform = ? AND contact_id = ?"
    )
      .bind(token, platform, contactId)
      .first<{ max_id: number }>();

    const maxId = maxIdRow?.max_id || 0;
    const lastSummarizedId = summaryRow?.summarized_up_to_id || 0;

    if (maxId - lastSummarizedId < 10) return;

    // 获取需要摘要的消息
    const { results } = await db.prepare(
      +""+SELECT role, content FROM chat_history
       WHERE token = ? AND platform = ? AND contact_id = ?
       AND id > ?
       ORDER BY created_at ASC LIMIT 20+""+
    )
      .bind(token, platform, contactId, lastSummarizedId)
      .all();

    if (!results || results.length === 0) return;

    const conversationText = (results as Array<{ role: string; content: string }>)
      .map((m) => (m.role === "user" ? "对方" : "我") + ": " + m.content)
      .join("\n");

    const oldSummary = summaryRow?.summary || "";

    // 调用 DeepSeek 生成摘要
    const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: +""+Bearer }+""+,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "你是一个对话摘要助手。请用不超过200字概括以下聊天内容要点。" },
          { role: "user", content: (oldSummary ? "之前的摘要: " + oldSummary + "\n\n" : "") + "新对话:\n" + conversationText },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    });

    if (!resp.ok) return;

    const data = await resp.json() as { choices?: Array<{ message: { content: string } }> };
    const newSummary = data.choices?.[0]?.message?.content?.trim() || oldSummary;

    // 更新 session_summary
    await db.prepare(
      +""+INSERT INTO session_summary (token, platform, contact_id, summary, summarized_up_to_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(token, platform, contact_id) DO UPDATE SET
         summary = excluded.summary,
         summarized_up_to_id = excluded.summarized_up_to_id+""+
    )
      .bind(token, platform, contactId, newSummary.substring(0, 200), maxId)
      .run();
  } catch (error) {
    console.error("Summary generation error:", error);
  }
}

// 构建 LLM 消息列表
function buildLLMMessages(
  systemPrompt: string,
  historyMessages: Array<{ role: string; content: string; created_at: number }>,
  summary: string,
  newMessages: Array<{ role: string; content: string }>
): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  if (summary) {
    result.push({ role: "user", content: +""+之前的聊天大概是这样：}+""+ });
  }

  for (const msg of historyMessages) {
    const timeStr = new Date(msg.created_at * 1000).toLocaleString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const roleLabel = msg.role === "user" ? "对方说" : "你说";
    result.push({ role: "user", content: +""+[}] }：}+""+ });
  }

  for (const msg of newMessages) {
    result.push({ role: msg.role, content: msg.content });
  }

  return result;
}

// 验证 Bearer Token
async function validateToken(db: D1Database, authHeader: string) {
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;

  const row = await db.prepare(
    "SELECT token, is_active, monthly_limit, spent FROM tokens WHERE token = ?"
  )
    .bind(token)
    .first<{ token: string; is_active: number; monthly_limit: number; spent: number }>();

  if (!row || row.is_active === 0) return null;
  return row;
}

// POST /api/chat
chatRouter.post("/", async (c) => {
  try {
    const authHeader = c.req.header("Authorization") || "";
    const tokenRow = await validateToken(c.env.DB, authHeader);

    if (!tokenRow) {
      return c.json({ error: "无效的设备密钥" }, 401);
    }

    const body = await c.req.json<ChatRequest>();
    const { platform, contact_id, contact_name, location, messages } = body;

    if (!platform || !contact_id || !contact_name || !messages || !Array.isArray(messages) || messages.length === 0) {
      return c.json({ error: "缺少必要参数" }, 400);
    }

    // 取最后一条用户消息做敏感词检测
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const userContent = lastUserMsg?.content || "";

    // 敏感词检测
    if (containsSensitiveWords(userContent)) {
      // 存用户消息
      const nowSec = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        +""+INSERT INTO chat_history (token, platform, contact_id, contact_name, role, content, created_at)
         VALUES (?, ?, ?, ?, 'user', ?, ?)+""+
      )
        .bind(tokenRow.token, platform, contact_id, contact_name, userContent, nowSec)
        .run();

      return c.json({ action: "safe_reply", reply: "这个我不太方便聊，换个话题吧" }, 200);
    }

    // 检查白名单
    const contact = await c.env.DB.prepare(
      "SELECT is_whitelisted FROM contacts WHERE token = ? AND platform = ? AND contact_id = ?"
    )
      .bind(tokenRow.token, platform, contact_id)
      .first<{ is_whitelisted: number }>();

    if (!contact || contact.is_whitelisted === 0) {
      return c.json({ action: "skip" }, 200);
    }

    // 获取活跃人设
    const activePersona = await c.env.DB.prepare(
      "SELECT id, system_prompt FROM personas WHERE is_active = 1 LIMIT 1"
    )
      .first<{ id: string; system_prompt: string }>();

    const personaPrompt = activePersona?.system_prompt || "你是一个友好的聊天助手。";

    // 获取历史
    const { messages: historyMessages, summary, hoursAgo } = await getRecentHistory(
      c.env.DB,
      tokenRow.token,
      platform,
      contact_id
    );

    // 获取天气
    const homeCity = location?.home?.city || "重庆";
    const weatherApiKey = c.env.WEATHER_API_KEY || "";
    const weather = await getWeather(homeCity, c.env.KV, weatherApiKey);

    // 获取 KV 配置
    const temperature = parseFloat(await c.env.KV.get("llm:temperature") || "0.7");
    const maxTokens = parseInt(await c.env.KV.get("llm:max_tokens") || "300");
    const modelName = await c.env.KV.get("llm:model") || "deepseek-chat";

    const now = new Date();
    const currentDatetime = now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const weekday = weekdays[now.getDay()];

    // 拼 system prompt
    const platformStyle = PLATFORM_STYLE_HINTS[platform] || "自然、日常";

    let systemPrompt = +""+${+"$"+{personaPrompt}}

当前平台：}，请用以下语气：}

现在是 }（}）。
你住在}}，在}}上班。
今天}，气温}°C。

回复规则（必须遵守）：
1. "对方说"是对方发的话，"你说"是你（AI 扮演的人设）之前发的话。不要搞混角色。
2. 注意当前时间。晚上不说"早上好"，下午不说"刚起床"。
3. 注意当前天气。冷天不说热，阴天不说太阳大。
4. 对方聊天气时以对方说的为准。只有对方问"你那边冷不冷"时才说自己这边。
5. 对方问住在哪 → 说家庭地址（home）。对方问工作在哪 → 说工作地址（work）。
6. 不要编造与对方消息矛盾的事实。
7. 如果你很久没回对方，正常说"刚忙完""刚看到消息"。不要说对方消失了——消失的人是你。
8. 只回复对方最新的这条消息，基于上下文自然接话。+""+;

    if (hoursAgo > 2) {
      systemPrompt += +""+\n\n注意：对方最后一条消息是 } 小时前发的。你一直在忙没回复，现在刚看到。+""+;
    }

    // 构建消息
    const llmMessages = buildLLMMessages(
      systemPrompt,
      historyMessages,
      summary,
      messages
    );

    // 调用 DeepSeek
    const apiKey = c.env.DEEPSEEK_API_KEY || "";

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: +""+Bearer }+""+,
      },
      body: JSON.stringify({
        model: modelName,
        messages: llmMessages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      console.error("DeepSeek API error:", response.status);
      return c.json({ error: "LLM 调用失败" }, 502);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const reply = data.choices?.[0]?.message?.content?.trim() || "嗯嗯，好的。";

    const nowSec = Math.floor(Date.now() / 1000);

    // 保存所有新消息
    const stmt = c.env.DB.prepare(
      +""+INSERT INTO chat_history (token, platform, contact_id, contact_name, role, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)+""+
    );

    const batch = messages.map((msg) =>
      stmt.bind(
        tokenRow.token,
        platform,
        contact_id,
        contact_name,
        msg.role,
        msg.content,
        msg.created_at || nowSec
      )
    );

    // 加上 AI 回复
    batch.push(
      stmt.bind(tokenRow.token, platform, contact_id, contact_name, "assistant", reply, nowSec)
    );

    await c.env.DB.batch(batch);

    // 更新 token
    await c.env.DB.prepare(
      "UPDATE tokens SET last_used_at = ?, spent = spent + 0.01 WHERE token = ?"
    )
      .bind(nowSec, tokenRow.token)
      .run();

    // 异步重算摘要
    c.executionCtx.waitUntil(
      maybeRegenerateSummary(c.env.DB, tokenRow.token, platform, contact_id, apiKey)
    );

    return c.json({ action: "send", reply }, 200);
  } catch (error) {
    console.error("Chat error:", error);
    return c.json({ error: "服务器内部错误" }, 500);
  }
});

export { chatRouter };
