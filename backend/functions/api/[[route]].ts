// functions/api/[[route]].ts - Hono 入口，挂载所有子路由
import { Hono } from "hono";
import { cors } from "hono/cors";
import { chatRouter } from "./chat";
import { messagesRouter } from "./messages";
import { historyRouter } from "./history";
import { contactsRouter } from "./contacts";
import { personaRouter } from "./persona";
import { configRouter } from "./config";
import { tokenRouter } from "./token";
import { statusRouter } from "./status";

type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  DEEPSEEK_API_KEY?: string;
  WEATHER_API_KEY?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("/*", cors());

app.route("/api/chat", chatRouter);
app.route("/api/messages", messagesRouter);
app.route("/api/chat/history", historyRouter);
app.route("/api/contacts", contactsRouter);
app.route("/api/persona", personaRouter);
app.route("/api/config", configRouter);
app.route("/api/token", tokenRouter);
app.route("/api/status", statusRouter);

// 404
app.all("*", (c) => c.json({ error: "Not Found" }, 404));

export const onRequest = app.fetch;
