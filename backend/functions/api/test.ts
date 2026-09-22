import { Hono } from "hono";

const app = new Hono();

app.get("/api/test", (c) => {
  return c.json({ status: "ok", time: Date.now() });
});

export const onRequest = app.fetch;
