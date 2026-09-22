// functions/api/chat.ts - POST /api/chat
import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  DEEPSEEK_API_KEY?: string;
};

type ChatRequest = {
  token: string;
  platform: string;
  contact_id: string;
  contact_name: string;
  message: string;
  message_id: string;
  persona_id?: string;
};

const chatRouter = new Hono<{ Bindings: Bindings }>();

// 敏感词列表
const SENSITIVE_WORDS = ["借钱", "账号", "密码", "银行卡", "转账", "验证码", "身份证"];

function containsSensitiveWords(text: string): boolean {
  return SENSITIVE_WORDS.some((w) => text.includes(w));
}

// 安全回复模板
const SAFE_REPLY =
  "这个我不太方便在线上说呢，要不我们换个方式聊？";

// 构建 system prompt
function buildSystemPrompt(
  personaPrompt: string,
  historySummary: string,
  currentTime: string
): string {
  return `${personaPrompt}

现在时间是 ${currentTime}。回复时请注意时间语境，不要说错早晚。

聊天历史摘要：
${historySummary || "（这是你们第一次聊天）"}

重要规则：
1. 回复控制在50字以内，自然口语化
2. 不要连续问两个及以上问题
3. 不要编造与对方矛盾的事实
4. 如果对方长时间没回（超过24小时），不要问"你怎么消失了"——消失的人是你
5. 对方最后一条消息在聊天历史中已经标明了时间
6. 遇到借钱、账号密码等敏感话题，礼貌拒绝`;
}

// 获取最近 20 轮历史（40条），超出部分做摘要
async function getRecentHistory(
  db: D1Database,
  token: string,
  platform: string,
  contactId: string
): Promise<{ messages: Array<{ role: string; content: string }>; summary: string }> {
  const MAX_ROUNDS = 20;
  const MAX_MESSAGES = MAX_ROUNDS * 2;

  const { results } = await db
    .prepare(
      `SELECT role, content, created_at FROM chat_history
       WHERE token = ? AND platform = ? AND contact_id = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .bind(token, platform, contactId, MAX_MESSAGES + 10)
    .all();

  if (!results || results.length === 0) {
    return { messages: [], summary: "" };
  }

  const allMessages = results.reverse() as Array<{
    role: string;
    content: string;
    created_at: number;
  }>;

  let summary = "";
  let messages: Array<{ role: string; content: string }> = [];

  if (allMessages.length <= MAX_MESSAGES) {
    messages = allMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  } else {
    // 超出部分做摘要
    const overflow = allMessages.slice(0, allMessages.length - MAX_MESSAGES);
    const recent = allMessages.slice(allMessages.length - MAX_MESSAGES);

    const overflowText = overflow
      .map(
        (m) =>
          `${m.role === "user" ? "对方" : "我"}[${new Date(
            m.created_at * 1000
          ).toLocaleString("zh-CN")}]: ${m.content}`
      )
      .join("\n");

    summary = `早期对话摘要（已截断，保留最近${MAX_ROUNDS}轮）：\n${overflowText.substring(0, 200)}`;

    messages = recent.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  return { messages, summary };
}

// POST /api/chat
chatRouter.post("/", async (c) => {
  try {
    const body = await c.req.json<ChatRequest>();
    const { token, platform, contact_id, contact_name, message, message_id, persona_id } = body;

    if (!token || !platform || !contact_id || !message) {
      return c.json({ error: "缺少必要参数" }, 400);
    }

    // 验证 token
    const tokenResult = await c.env.DB.prepare(
      "SELECT is_active, monthly_limit, spent FROM tokens WHERE token = ?"
    )
      .bind(token)
      .first<{ is_active: number; monthly_limit: number; spent: number }>();

    if (!tokenResult || tokenResult.is_active === 0) {
      return c.json({ error: "无效的设备密钥" }, 401);
    }

    // 去重检查（5分钟窗口）
    if (message_id) {
      const dupCheck = await c.env.DB.prepare(
        `SELECT id FROM chat_history
         WHERE token = ? AND message_id = ? AND role = 'assistant'
         AND created_at > ?`
      )
        .bind(token, message_id, Math.floor(Date.now() / 1000) - 300)
        .first();

      if (dupCheck) {
        return c.json({ reply: "", skipped: true, reason: "去重" }, 200);
      }
    }

    // 敏感词检测
    if (containsSensitiveWords(message)) {
      // 保存用户消息
      await c.env.DB.prepare(
        `INSERT INTO chat_history (token, platform, contact_id, contact_name, role, content, message_id, created_at)
         VALUES (?, ?, ?, ?, 'user', ?, ?, ?)`
      )
        .bind(token, platform, contact_id, contact_name, message, message_id, Math.floor(Date.now() / 1000))
        .run();

      // 保存 AI 安全回复
      await c.env.DB.prepare(
        `INSERT INTO chat_history (token, platform, contact_id, contact_name, role, content, message_id, created_at)
         VALUES (?, ?, ?, ?, 'assistant', ?, ?, ?)`
      )
        .bind(token, platform, contact_id, contact_name, SAFE_REPLY, message_id, Math.floor(Date.now() / 1000))
        .run();

      return c.json({ reply: SAFE_REPLY, safety: true }, 200);
    }

    // 获取联系人白名单状态
    const contact = await c.env.DB.prepare(
      "SELECT is_whitelisted FROM contacts WHERE token = ? AND platform = ? AND contact_id = ?"
    )
      .bind(token, platform, contact_id)
      .first<{ is_whitelisted: number }>();

    if (!contact || contact.is_whitelisted === 0) {
      return c.json({ reply: "", skipped: true, reason: "不在白名单" }, 200);
    }

    // 获取活跃人设
    let personaPrompt = "你是一个友好的聊天助手。";
    if (persona_id) {
      const persona = await c.env.DB.prepare(
        "SELECT system_prompt FROM personas WHERE id = ?"
      )
        .bind(persona_id)
        .first<{ system_prompt: string }>();
      if (persona) {
        personaPrompt = persona.system_prompt;
      }
    } else {
      const activePersona = await c.env.DB.prepare(
        "SELECT system_prompt FROM personas WHERE is_active = 1 LIMIT 1"
      )
        .first<{ system_prompt: string }>();
      if (activePersona) {
        personaPrompt = activePersona.system_prompt;
      }
    }

    // 获取历史
    const { messages, summary } = await getRecentHistory(
      c.env.DB,
      token,
      platform,
      contact_id
    );

    const now = new Date();
    const currentTime = now.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
    });

    const systemPrompt = buildSystemPrompt(personaPrompt, summary, currentTime);

    // 构建消息列表
    const llmMessages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
      ...messages,
      { role: "user", content: message },
    ];

    // 调用 DeepSeek
    const apiKey = c.env.DEEPSEEK_API_KEY || "";
    const apiBase = "https://api.deepseek.com/v1";

    const response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: llmMessages,
        temperature: 0.7,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      console.error("DeepSeek API error:", response.status);
      return c.json({ error: "LLM 调用失败" }, 502);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const reply =
      data.choices?.[0]?.message?.content?.trim() || "嗯嗯，好的。";

    const nowSec = Math.floor(Date.now() / 1000);

    // 保存用户消息
    await c.env.DB.prepare(
      `INSERT INTO chat_history (token, platform, contact_id, contact_name, role, content, message_id, created_at)
       VALUES (?, ?, ?, ?, 'user', ?, ?, ?)`
    )
      .bind(token, platform, contact_id, contact_name, message, message_id, nowSec)
      .run();

    // 保存 AI 回复
    await c.env.DB.prepare(
      `INSERT INTO chat_history (token, platform, contact_id, contact_name, role, content, message_id, created_at)
       VALUES (?, ?, ?, ?, 'assistant', ?, ?, ?)`
    )
      .bind(token, platform, contact_id, contact_name, reply, message_id, nowSec)
      .run();

    // 更新 token 最后使用时间和花费
    await c.env.DB.prepare(
      "UPDATE tokens SET last_used_at = ?, spent = spent + 0.01 WHERE token = ?"
    )
      .bind(nowSec, token)
      .run();

    return c.json({ reply, persona: persona_id || "default" }, 200);
  } catch (error) {
    console.error("Chat error:", error);
    return c.json({ error: "服务器内部错误" }, 500);
  }
});

export { chatRouter };