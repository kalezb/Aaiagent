// functions/api/messages.ts - POST /api/messages/sync（监控模式）
import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
};

const messagesRouter = new Hono<{ Bindings: Bindings }>();

// POST /api/messages/sync - 监控模式：只存记录，不调 LLM
messagesRouter.post("/sync", async (c) => {
  try {
    const authHeader = c.req.header("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    if (!token) {
      return c.json({ error: "缺少认证令牌" }, 401);
    }

    // 验证 token
    const tokenResult = await c.env.DB.prepare(
      "SELECT is_active FROM tokens WHERE token = ?"
    )
      .bind(token)
      .first<{ is_active: number }>();

    if (!tokenResult || tokenResult.is_active === 0) {
      return c.json({ error: "无效的设备密钥" }, 401);
    }

    const body = await c.req.json<{
      platform: string;
      contact_id: string;
      contact_name: string;
      messages: Array<{ role: string; content: string; created_at?: number }>;
    }>();

    const { platform, contact_id, contact_name, messages } = body;

    if (!platform || !contact_id || !contact_name || !messages || !Array.isArray(messages)) {
      return c.json({ error: "缺少必要参数" }, 400);
    }

    const nowSec = Math.floor(Date.now() / 1000);

    // 批量插入聊天记录
    const stmt = c.env.DB.prepare(
      +""+INSERT INTO chat_history (token, platform, contact_id, contact_name, role, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)+""+
    );

    const batch = messages.map((msg) =>
      stmt.bind(
        token,
        platform,
        contact_id,
        contact_name,
        msg.role,
        msg.content,
        msg.created_at || nowSec
      )
    );

    await c.env.DB.batch(batch);

    // 更新 token 最后使用时间
    await c.env.DB.prepare(
      "UPDATE tokens SET last_used_at = ? WHERE token = ?"
    )
      .bind(nowSec, token)
      .run();

    return c.json({ ok: true }, 200);
  } catch (error) {
    console.error("Messages sync error:", error);
    return c.json({ error: "服务器内部错误" }, 500);
  }
});

export { messagesRouter };
