// functions/api/persona.ts - GET/PUT /api/persona
import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
};

const personaRouter = new Hono<{ Bindings: Bindings }>();

// GET /api/persona?token=xxx - 获取所有人设
personaRouter.get("/", async (c) => {
  try {
    const token = c.req.query("token") || "";

    const { results } = await c.env.DB.prepare(
      "SELECT id, name, system_prompt, is_active, created_at FROM personas WHERE token = ? OR token = '' ORDER BY created_at"
    )
      .bind(token)
      .all();

    return c.json({ personas: results || [] }, 200);
  } catch (error) {
    console.error("Persona get error:", error);
    return c.json({ error: "服务器内部错误" }, 500);
  }
});

// PUT /api/persona - 更新或新增人设
personaRouter.put("/", async (c) => {
  try {
    const body = await c.req.json<{
      token: string;
      id: string;
      name: string;
      system_prompt: string;
      is_active?: number;
    }>();
    const { token, id, name, system_prompt } = body;
    const isActive = body.is_active ?? 0;
    const now = Math.floor(Date.now() / 1000);

    if (!id || !name || !system_prompt) {
      return c.json({ error: "缺少必要参数" }, 400);
    }

    // 如果设定为活跃，先取消其他人设的活跃状态
    if (isActive === 1) {
      await c.env.DB.prepare(
        "UPDATE personas SET is_active = 0 WHERE token = ? OR token = ''"
      )
        .bind(token || "")
        .run();
    }

    await c.env.DB.prepare(
      `INSERT INTO personas (id, token, name, system_prompt, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         token = excluded.token,
         name = excluded.name,
         system_prompt = excluded.system_prompt,
         is_active = excluded.is_active`
    )
      .bind(id, token || "", name, system_prompt, isActive, now)
      .run();

    return c.json({ success: true }, 200);
  } catch (error) {
    console.error("Persona put error:", error);
    return c.json({ error: "服务器内部错误" }, 500);
  }
});

export { personaRouter };