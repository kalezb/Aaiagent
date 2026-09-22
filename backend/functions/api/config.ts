// functions/api/config.ts - GET /api/config
import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
};

const configRouter = new Hono<{ Bindings: Bindings }>();

// GET /api/config?token=xxx - 获取当前配置
configRouter.get("/", async (c) => {
  try {
    const token = c.req.query("token") || "";

    // 获取活跃人设
    const persona = await c.env.DB.prepare(
      "SELECT id, name FROM personas WHERE is_active = 1 AND (token = ? OR token = '') LIMIT 1"
    )
      .bind(token)
      .first<{ id: string; name: string }>();

    // 从 KV 获取模型配置
    const modelName = (await c.env.KV.get("model_name")) || "deepseek-chat";
    const apiBase = (await c.env.KV.get("api_base")) || "https://api.deepseek.com/v1";

    // 获取白名单联系人数量
    const contactCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM contacts WHERE token = ? AND is_whitelisted = 1"
    )
      .bind(token)
      .first<{ count: number }>();

    return c.json({
      persona: persona || { id: "male", name: "阿杰" },
      model: modelName,
      api_base: apiBase,
      whitelist_count: contactCount?.count || 0,
    }, 200);
  } catch (error) {
    console.error("Config error:", error);
    return c.json({ error: "服务器内部错误" }, 500);
  }
});

// PUT /api/config - 更新 KV 配置（模型切换等）
configRouter.put("/", async (c) => {
  try {
    const body = await c.req.json<{
      model_name?: string;
      api_base?: string;
    }>();

    if (body.model_name) {
      await c.env.KV.put("model_name", body.model_name);
    }
    if (body.api_base) {
      await c.env.KV.put("api_base", body.api_base);
    }

    return c.json({ success: true }, 200);
  } catch (error) {
    console.error("Config put error:", error);
    return c.json({ error: "服务器内部错误" }, 500);
  }
});

export { configRouter };