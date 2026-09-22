// functions/api/contacts.ts - GET/POST /api/contacts
import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
};

const contactsRouter = new Hono<{ Bindings: Bindings }>();

// GET /api/contacts?token=xxx&platform=soul
contactsRouter.get("/", async (c) => {
  try {
    const token = c.req.query("token");
    const platform = c.req.query("platform") || "";

    if (!token) {
      return c.json({ error: "缺少 token" }, 400);
    }

    let query = `SELECT id, token, platform, contact_id, contact_name, is_whitelisted, notes, created_at
                 FROM contacts WHERE token = ?`;
    const params: unknown[] = [token];

    if (platform) {
      query += " AND platform = ?";
      params.push(platform);
    }

    query += " ORDER BY created_at DESC";

    const { results } = await c.env.DB.prepare(query)
      .bind(...params)
      .all();

    return c.json({ contacts: results || [] }, 200);
  } catch (error) {
    console.error("Contacts get error:", error);
    return c.json({ error: "服务器内部错误" }, 500);
  }
});

// POST /api/contacts - 添加/更新联系人
contactsRouter.post("/", async (c) => {
  try {
    const body = await c.req.json<{
      token: string;
      platform: string;
      contact_id: string;
      contact_name: string;
      is_whitelisted?: number;
      notes?: string;
    }>();

    const { token, platform, contact_id, contact_name } = body;
    const isWhitelisted = body.is_whitelisted ?? 1;
    const notes = body.notes || "";
    const now = Math.floor(Date.now() / 1000);

    if (!token || !platform || !contact_id || !contact_name) {
      return c.json({ error: "缺少必要参数" }, 400);
    }

    await c.env.DB.prepare(
      `INSERT INTO contacts (token, platform, contact_id, contact_name, is_whitelisted, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(token, platform, contact_id) DO UPDATE SET
         contact_name = excluded.contact_name,
         is_whitelisted = excluded.is_whitelisted,
         notes = excluded.notes`
    )
      .bind(token, platform, contact_id, contact_name, isWhitelisted, notes, now)
      .run();

    return c.json({ success: true }, 200);
  } catch (error) {
    console.error("Contacts post error:", error);
    return c.json({ error: "服务器内部错误" }, 500);
  }
});

// DELETE /api/contacts
contactsRouter.delete("/", async (c) => {
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
      "DELETE FROM contacts WHERE token = ? AND platform = ? AND contact_id = ?"
    )
      .bind(token, platform, contact_id)
      .run();

    return c.json({ success: true }, 200);
  } catch (error) {
    console.error("Contacts delete error:", error);
    return c.json({ error: "服务器内部错误" }, 500);
  }
});

export { contactsRouter };