// functions/api/token.ts - POST/DELETE /api/token (设备密钥管理)
import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
};

const tokenRouter = new Hono<{ Bindings: Bindings }>();

// POST /api/token - 创建或验证 token
tokenRouter.post("/", async (c) => {
  try {
    const body = await c.req.json<{
      token: string;
      name?: string;
      monthly_limit?: number;
    }>();
    const { token } = body;
    const name = body.name || "";
    const monthlyLimit = body.monthly_limit ?? 30;
    const now = Math.floor(Date.now() / 1000);

    if (!token) {
      return c.json({ error: "缺少 token" }, 400);
    }

    // 检查是否已存在
    const existing = await c.env.DB.prepare(
      "SELECT token, is_active FROM tokens WHERE token = ?"
    )
      .bind(token)
      .first<{ token: string; is_active: number }>();

    if (existing) {
      // 更新最后使用时间
      await c.env.DB.prepare(
        "UPDATE tokens SET last_used_at = ?, name = CASE WHEN name = '' THEN ? ELSE name END WHERE token = ?"
      )
        .bind(now, name, token)
        .run();
      return c.json({ token, exists: true, is_active: existing.is_active }, 200);
    }

    // 新建
    await c.env.DB.prepare(
      `INSERT INTO tokens (token, name, monthly_limit, spent, is_active, created_at, last_used_at)
       VALUES (?, ?, ?, 0, 1, ?, ?)`
    )
      .bind(token, name, monthlyLimit, now, now)
      .run();

    return c.json({ token, exists: false, is_active: 1 }, 201);
  } catch (error) {
    console.error("Token post error:", error);
    return c.json({ error: "服务器内部错误" }, 500);
  }
});

// PUT /api/token - 更新 token 状态
tokenRouter.put("/", async (c) => {
  try {
    const body = await c.req.json<{
      token: string;
      is_active?: number;
      monthly_limit?: number;
      name?: string;
    }>();
    const { token } = body;

    if (!token) {
      return c.json({ error: "缺少 token" }, 400);
    }

    const updates: string[] = [];
    const params: unknown[] = [];

    if (body.is_active !== undefined) {
      updates.push("is_active = ?");
      params.push(body.is_active);
    }
    if (body.monthly_limit !== undefined) {
      updates.push("monthly_limit = ?");
      params.push(body.monthly_limit);
    }
    if (body.name !== undefined) {
      updates.push("name = ?");
      params.push(body.name);
    }

    if (updates.length === 0) {
      return c.json({ error: "没有要更新的字段" }, 400);
    }

    params.push(token);
    await c.env.DB.prepare(
      `UPDATE tokens SET ${updates.join(", ")} WHERE token = ?`
    )
      .bind(...params)
      .run();

    return c.json({ success: true }, 200);
  } catch (error) {
    console.error("Token put error:", error);
    return c.json({ error: "服务器内部错误" }, 500);
  }
});

export { tokenRouter };