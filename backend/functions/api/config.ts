// functions/api/config.ts - GET/PUT /api/config
import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
};

const configRouter = new Hono<{ Bindings: Bindings }>();

const PLATFORM_STYLE_HINTS: Record<string, string> = {
  soul: "偏文艺、走心",
  qq: "偏年轻、活泼",
  immomo: "直接、不绕弯",
  lianxin: "自然、日常",
};

// GET /api/config - 获取当前配置（App 启动时拉一次）
configRouter.get("/", async (c) => {
  try {
    const authHeader = c.req.header("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    // 获取活跃人设
    const persona = await c.env.DB.prepare(
      "SELECT id, name, system_prompt FROM personas WHERE is_active = 1 LIMIT 1"
    )
      .first<{ id: string; name: string; system_prompt: string }>();

    return c.json({
      active_persona_id: persona?.id || "male",
      active_persona_name: persona?.name || "阿杰",
      platform_style_hints: PLATFORM_STYLE_HINTS,
    }, 200);
  } catch (error) {
    console.error("Config error:", error);
    return c.json({ error: "服务器内部错误" }, 500);
  }
});

// PUT /api/config - 更新 KV 配置
configRouter.put("/", async (c) => {
  try {
    const body = await c.req.json<{
      model_name?: string;
      api_base?: string;
      temperature?: number;
      max_tokens?: number;
    }>();

    if (body.model_name) await c.env.KV.put("llm:model", body.model_name);
    if (body.api_base) await c.env.KV.put("llm:base_url", body.api_base);
    if (body.temperature !== undefined) await c.env.KV.put("llm:temperature", String(body.temperature));
    if (body.max_tokens !== undefined) await c.env.KV.put("llm:max_tokens", String(body.max_tokens));

    return c.json({ success: true }, 200);
  } catch (error) {
    console.error("Config put error:", error);
    return c.json({ error: "服务器内部错误" }, 500);
  }
});

export { configRouter };
