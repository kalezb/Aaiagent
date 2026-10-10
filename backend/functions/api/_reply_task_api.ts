import {
  isDashboardAuthorized,
  validateToken,
} from "./_access_runtime";
import { SUPPORTED_PLATFORMS } from "./_chat_input";
import {
  countInsertedRows,
  loadGroupIdentity,
  updateConversationStats,
} from "./_history_runtime";
import { json } from "./_http_runtime";
import { loadRuntimePersonaFacts } from "./_persona_runtime";

export async function handleReplyTaskRequest({ request, env, url, path, method }) {
  // POST /api/manual-replies - enqueue an exact message from the dashboard
  if (path === "/api/manual-replies" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const body = await request.json();
    const token = String(body.token || "").trim();
    const groupId = String(body.group_id || "").trim();
    const platform = String(body.platform || "").trim();
    const contactId = String(body.contact_id || "").trim();
    const content = String(body.content || "").trim();
    if (!token || !platform || !contactId || !content) {
      return json({ error: "缺少必要参数" }, 400);
    }

    let contactName = String(body.contact_name || contactId).trim();
    if (groupId) {
      const identity = await loadGroupIdentity(env.DB, groupId, token);
      const alias = identity?.aliases.find((item) =>
        item.platform === platform && item.contact_id === contactId
      );
      if (!alias) return json({ error: "目标账号不属于该客户" }, 400);
      contactName = alias.contact_name || contactName;
    }

    const taskId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT INTO manual_replies (id, token, platform, contact_id, contact_name, group_id, content, status, priority, created_at, claimed_at, sent_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, NULL, NULL, '')"
    ).bind(taskId, token, platform, contactId, contactName, groupId, content, now).run();
    return json({ success: true, task_id: taskId, status: "pending" }, 201);
  }

  // GET /api/reply-tasks/next - Android pulls manual messages first, then priority customers
  if (path === "/api/reply-tasks/next" && method === "GET") {
    const authHeader = request.headers.get("Authorization") || "";
    const tokenRow = await validateToken(env.DB, authHeader);
    if (!tokenRow) return json({ error: "无效的设备密钥" }, 401);
    const platform = url.searchParams.get("platform") || "";
    if (!SUPPORTED_PLATFORMS.includes(platform)) return json({ error: "不支持的平台" }, 400);
    const now = Math.floor(Date.now() / 1000);
    const staleBefore = now - 120;
    const manual = await env.DB.prepare(
      "SELECT id, platform, contact_id, contact_name, group_id, content, status, created_at FROM manual_replies WHERE token = ? AND platform = ? AND (status = 'pending' OR (status = 'claimed' AND claimed_at < ?)) ORDER BY priority DESC, created_at ASC LIMIT 1"
    ).bind(tokenRow.token, platform, staleBefore).first();
    if (manual) {
      await env.DB.prepare(
        "UPDATE manual_replies SET status = 'claimed', claimed_at = ?, error = '' WHERE id = ? AND token = ?"
      ).bind(now, manual.id, tokenRow.token).run();
      return json({ task: { ...manual, type: "manual" } });
    }

    const priority = await env.DB.prepare(
      "SELECT g.id AS group_id, g.display_name, l.platform, l.contact_id, l.contact_name FROM customer_groups g JOIN contact_links l ON l.token = g.token AND l.group_id = g.id WHERE g.token = ? AND g.priority_reply = 1 AND l.platform = ? AND (g.priority_last_used_at = 0 OR g.priority_last_used_at < ?) ORDER BY g.priority_last_used_at ASC, g.updated_at ASC LIMIT 1"
    ).bind(tokenRow.token, platform, now - 15).first();
    if (!priority) return json({ task: null });
    await env.DB.prepare(
      "UPDATE customer_groups SET priority_last_used_at = ? WHERE id = ? AND token = ?"
    ).bind(now, priority.group_id, tokenRow.token).run();
    return json({
      task: {
        type: "priority_contact",
        task_id: "",
        group_id: priority.group_id,
        platform: priority.platform,
        contact_id: priority.contact_id,
        contact_name: priority.contact_name || priority.display_name,
        content: "",
      },
    });
  }

  // POST /api/reply-tasks/result - Android reports whether a manual message was sent
  if (path === "/api/reply-tasks/result" && method === "POST") {
    const authHeader = request.headers.get("Authorization") || "";
    const tokenRow = await validateToken(env.DB, authHeader);
    if (!tokenRow) return json({ error: "无效的设备密钥" }, 401);
    const body = await request.json();
    const taskId = String(body.task_id || "").trim();
    const status = body.status === "sent" ? "sent" : "failed";
    const error = String(body.error || "").slice(0, 300);
    if (!taskId) return json({ error: "缺少 task_id" }, 400);
    const task = await env.DB.prepare(
      "SELECT id, platform, contact_id, contact_name, group_id, content FROM manual_replies WHERE id = ? AND token = ?"
    ).bind(taskId, tokenRow.token).first();
    if (!task) return json({ error: "任务不存在" }, 404);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "UPDATE manual_replies SET status = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END, error = ? WHERE id = ? AND token = ?"
    ).bind(status, status, now, error, taskId, tokenRow.token).run();
    if (status === "sent") {
      const activePersonaId = String(tokenRow.active_persona_id || "female");
      const effectivePersona = await loadRuntimePersonaFacts(env.DB, tokenRow.token, activePersonaId);
      const insertResult = await env.DB.prepare(
        "INSERT OR IGNORE INTO chat_history (token, platform, contact_id, contact_name, role, content, created_at, source, message_key, persona_id, persona_version, time_kind, transcript, voice_seconds) VALUES (?, ?, ?, ?, 'assistant', ?, ?, 'dashboard', ?, ?, ?, 'manual', '', 0)"
      ).bind(
        tokenRow.token,
        task.platform,
        task.contact_id,
        task.contact_name,
        task.content,
        now,
        "dashboard:" + taskId,
        activePersonaId,
        effectivePersona.version,
      ).run();
      await updateConversationStats(
        env.DB,
        tokenRow.token,
        task.platform,
        task.contact_id,
        task.contact_name,
        countInsertedRows([insertResult]),
        {
          role: "assistant",
          content: task.content,
          source: "dashboard",
          created_at: now,
          message_key: "dashboard:" + taskId,
        },
        now,
      );
    }
    return json({ success: true, status });
  }

  return null;
}
