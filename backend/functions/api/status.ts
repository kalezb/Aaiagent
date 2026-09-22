// functions/api/status.ts - GET /api/status (健康检查)
import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
};

const statusRouter = new Hono<{ Bindings: Bindings }>();

// GET /api/status - 健康检查
statusRouter.get("/", async (c) => {
  try {
    // 检查 D1 连接
    await c.env.DB.prepare("SELECT 1").first();

    return c.json({
      status: "ok",
      time: Math.floor(Date.now() / 1000),
    }, 200);
  } catch (error) {
    return c.json({
      status: "error",
      message: "数据库连接失败",
    }, 503);
  }
});

export { statusRouter };