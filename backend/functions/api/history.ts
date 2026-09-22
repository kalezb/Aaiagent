// functions/api/history.ts - GET /api/chat/history
import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
};

const historyRouter = new Hono<{ Bindings: Bindings }>();

// GET /api/chat/history?token=xxx&platform=soul&contact_id=123&limit=50&offset=0
historyRouter.get("/", async (c) => {
  try {
    const token = c.req.query("token");
    const platform = c.req.query("platform");
    const contactId = c.req.query("contact_id");
    const limit = parseInt(c.req.query("limit") || "50");
    const offset = parseInt(c.req.query("offset") || "0");

    if (!token) {
      return c.json({ error: "缺少 token" }, 400);
    }

    let query = `SELECT id, platform, contact_id, contact_name, role, content, message_id, created_at
                 FROM chat_history WHERE token = ?`;
    const params: unknown[] = [token];

    if (platform) {
      query += " AND platform = ?";
      params.push(platform);
    }

    if (contactId) {
      query += " AND contact_id = ?";
      params.push(contactId);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(Math.min(limit, 100), offset);

    const { results } = await c.env.DB.prepare(query)
      .bind(...params)
      .all();

    return c.json({ history: results || [] }, 200);
  } catch (error) {
    console.error("History error:", error);
    return c.json({ error: "服务器内部错误" }, 500);
  }
});

// DELETE /api/chat/history - 清除某个联系人的聊天记录
historyRouter.delete("/", async (c) => {
  try {
    const body = await c.req.json<{
      token: string;
      platform: string;
      contact_id: string;
    }>();
    const { token, platform, contact_id } = body;

    if (!token || !platform || !contact_id) {
      return c.json({ error: "缺少必要参数" }, 400);
    }

    await c.env.DB.prepare(
      "DELETE FROM chat_history WHERE token = ? AND platform = ? AND contact_id = ?"
    )
      .bind(token, platform, contact_id)
      .run();

    return c.json({ success: true }, 200);
  } catch (error) {
    console.error("History delete error:", error);
    return c.json({ error: "服务器内部错误" }, 500);
  }
});

export { historyRouter };