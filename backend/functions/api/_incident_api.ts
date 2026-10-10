import {
  isDashboardAuthorized,
  validateToken,
} from "./_access_runtime";
import { json, parseJsonBody } from "./_http_runtime";
import {
  cleanupOldAutomationIncidents,
  evaluateReplayCaseRecord,
} from "./_incident_runtime";

export async function handleIncidentRequest({ request, env, url, path, method }) {
  // POST /api/automation-incidents - Android black-box incident upload.
  if (path === "/api/automation-incidents" && method === "POST") {
    const authHeader = request.headers.get("Authorization") || "";
    const tokenRow = await validateToken(env.DB, authHeader);
    if (!tokenRow) return json({ error: "无效的设备密钥" }, 401);
    await cleanupOldAutomationIncidents(env);
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 16 * 1024 * 1024) {
      return json({ error: "故障记录过大" }, 413);
    }
    const payload = await request.text();
    if (!payload.trim()) return json({ error: "故障记录为空" }, 400);
    if (new TextEncoder().encode(payload).byteLength > 16 * 1024 * 1024) {
      return json({ error: "故障记录过大" }, 413);
    }
    let firstEvent: Record<string, any> = {};
    try {
      firstEvent = JSON.parse(payload.split(/\r?\n/u).find((line) => line.trim()) || "{}");
    } catch (_) {
      return json({ error: "故障记录格式错误" }, 400);
    }
    const incidentId = String(
      request.headers.get("X-Incident-Id") ||
      firstEvent.incidentId ||
      firstEvent.incident_id ||
      "",
    ).trim().slice(0, 160);
    if (!/^[A-Za-z0-9._:-]{8,160}$/u.test(incidentId)) {
      return json({ error: "故障编号无效" }, 400);
    }
    const now = Math.floor(Date.now() / 1000);
    const platform = String(
      request.headers.get("X-Platform") || firstEvent.platform || "",
    ).trim().slice(0, 40);
    const contactId = String(
      request.headers.get("X-Contact-Id") || firstEvent.contactId || "",
    ).trim().slice(0, 200);
    const contactName = String(
      request.headers.get("X-Contact-Name") || "",
    ).trim().slice(0, 200);
    const appVersion = String(
      request.headers.get("X-App-Version") || firstEvent.appVersion || "",
    ).trim().slice(0, 80);
    const source = String(
      request.headers.get("X-Incident-Source") || "android",
    ).trim().slice(0, 40) || "android";
    const kind = String(
      request.headers.get("X-Incident-Kind") || "manual_feedback",
    ).trim().slice(0, 120);
    const eventCount = payload.split(/\r?\n/u).filter((line) => line.trim()).length;
    await env.DB.prepare(
      "INSERT INTO automation_incidents (id, token, platform, contact_id, contact_name, app_version, source, kind, status, event_count, payload, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET platform = excluded.platform, contact_id = excluded.contact_id, contact_name = excluded.contact_name, " +
      "app_version = excluded.app_version, source = excluded.source, kind = excluded.kind, event_count = excluded.event_count, payload = excluded.payload, updated_at = excluded.updated_at"
    ).bind(
      incidentId,
      tokenRow.token,
      platform,
      contactId,
      contactName,
      appVersion,
      source,
      kind,
      eventCount,
      payload,
      now,
      now,
    ).run();
    return json({ success: true, id: incidentId, event_count: eventCount }, 201);
  }

  // GET /api/automation-incidents - dashboard/AI incident list and detail.
  if (path === "/api/automation-incidents" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    await cleanupOldAutomationIncidents(env);
    const id = String(url.searchParams.get("id") || "").trim();
    if (id) {
      const incident = await env.DB.prepare(
        "SELECT id, token, platform, contact_id, contact_name, app_version, source, kind, status, event_count, payload, created_at, updated_at " +
        "FROM automation_incidents WHERE id = ? LIMIT 1"
      ).bind(id).first();
      if (!incident) return json({ error: "故障记录不存在" }, 404);
      return json({ incident });
    }
    const tokenFilter = String(url.searchParams.get("token") || "").trim();
    const sourceFilter = String(url.searchParams.get("source") || "").trim();
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 30)));
    const clauses = [];
    const params = [];
    if (tokenFilter) {
      clauses.push("token = ?");
      params.push(tokenFilter);
    }
    if (sourceFilter) {
      clauses.push("source = ?");
      params.push(sourceFilter);
    }
    const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
    const result = await env.DB.prepare(
      "SELECT id, token, platform, contact_id, contact_name, app_version, source, kind, status, event_count, substr(payload, 1, 600) AS payload_preview, created_at, updated_at " +
      "FROM automation_incidents" + where + " ORDER BY created_at DESC LIMIT ?"
    ).bind(...params, limit).all();
    return json({ incidents: result.results || [] });
  }

  // PUT /api/automation-incidents - move an incident through its lifecycle.
  if (path === "/api/automation-incidents" && method === "PUT") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const id = String(body.id || "").trim();
    const status = String(body.status || "").trim().toLowerCase();
    const allowed = new Set(["new", "processing", "fixed", "verified"]);
    if (!id || !allowed.has(status)) return json({ error: "故障编号或状态无效" }, 400);
    const result = await env.DB.prepare(
      "UPDATE automation_incidents SET status = ?, updated_at = ? WHERE id = ?"
    ).bind(status, Math.floor(Date.now() / 1000), id).run();
    if (!Number(result?.meta?.changes || 0)) return json({ error: "故障记录不存在" }, 404);
    return json({ success: true, id, status });
  }

  // POST /api/dashboard-incidents - customer dashboard black-box report.
  if (path === "/api/dashboard-incidents" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    await cleanupOldAutomationIncidents(env);
    const parsedBody = await parseJsonBody(request, 256 * 1024);
    if (parsedBody.error) return json({ error: parsedBody.error }, parsedBody.status);
    const body = parsedBody.body || {};
    const incidentId = String(body.id || body.incident_id || crypto.randomUUID()).trim().slice(0, 160);
    if (!/^[A-Za-z0-9._:-]{8,160}$/u.test(incidentId)) {
      return json({ error: "故障编号无效" }, 400);
    }
    const events = Array.isArray(body.events) ? body.events.slice(0, 500) : [];
    const kind = String(body.kind || "dashboard_error").trim().slice(0, 120);
    const reason = String(body.reason || "").trim().slice(0, 2000);
    const context = body.context && typeof body.context === "object" ? body.context : {};
    const payload = JSON.stringify({ reason, context, events });
    if (payload.length > 240 * 1024) return json({ error: "故障记录过大" }, 413);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT INTO automation_incidents (id, token, platform, contact_id, contact_name, app_version, source, kind, status, event_count, payload, created_at, updated_at) " +
      "VALUES (?, 'dashboard', 'dashboard', '', '', ?, 'dashboard', ?, 'new', ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET app_version = excluded.app_version, kind = excluded.kind, event_count = excluded.event_count, payload = excluded.payload, updated_at = excluded.updated_at"
    ).bind(
      incidentId,
      String(context.app_version || "").slice(0, 80),
      kind,
      events.length,
      payload,
      now,
      now,
    ).run();
    return json({ success: true, id: incidentId, event_count: events.length }, 201);
  }

  // POST /api/replay-cases/from-incident - freeze one incident into a regression case.
  if (path === "/api/replay-cases/from-incident" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const parsedBody = await parseJsonBody(request, 64 * 1024);
    if (parsedBody.error) return json({ error: parsedBody.error }, parsedBody.status);
    const body = parsedBody.body || {};
    const incidentId = String(body.incident_id || "").trim().slice(0, 160);
    if (!incidentId) return json({ error: "缺少故障编号" }, 400);
    const incident = await env.DB.prepare(
      "SELECT id, source, platform, contact_id, contact_name, kind, payload, created_at FROM automation_incidents WHERE id = ? LIMIT 1"
    ).bind(incidentId).first();
    if (!incident) return json({ error: "故障记录不存在" }, 404);

    let events: Array<Record<string, any>> = [];
    try {
      const parsed = JSON.parse(String(incident.payload || ""));
      events = Array.isArray(parsed?.events) ? parsed.events : [parsed];
    } catch (_) {
      events = String(incident.payload || "")
        .split(/\r?\n/u)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch (_) {
            return null;
          }
        })
        .filter(Boolean);
    }
    const anomalyActions = events
      .map((event) => String(event.action || event.event || ""))
      .filter((value) =>
        /UnexpectedProfilePageAfterReply|ConversationListRefreshStorm|AutomationFeedbackLoop/u.test(value)
      );
    const defaultExpected = anomalyActions.includes("UnexpectedProfilePageAfterReply")
      ? "再次出现同样动作序列时，必须自动识别资料页误入，并恢复到消息列表"
      : anomalyActions.includes("ConversationListRefreshStorm")
        ? "再次出现同样内容变化时，必须合并刷新并暂停重复扫描"
        : "再次出现同样操作序列时，必须得到和本次修复目标一致的结果";
    const expected = String(body.expected || defaultExpected).trim().slice(0, 3000);
    const forbidden = String(
      body.forbidden ||
      "同类异常在短时间内连续重复；把异常现场误判为正常流程"
    ).trim().slice(0, 3000);
    const title = String(
      body.title ||
      `${incident.source || "unknown"} · ${incident.kind || "issue"} · ${incidentId}`
    ).trim().slice(0, 200);
    const id = String(body.id || `replay-${crypto.randomUUID()}`).trim().slice(0, 160);
    const now = Math.floor(Date.now() / 1000);
    const expectation = JSON.stringify({
      expected,
      forbidden,
      anomaly_actions: anomalyActions,
    });
    await env.DB.prepare(
      "INSERT OR IGNORE INTO replay_cases (id, incident_id, source, title, kind, fixture_json, expectation_json, enabled, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)"
    ).bind(
      id,
      incidentId,
      String(incident.source || ""),
      title,
      String(incident.source || "") === "dashboard" ? "browser_event_sequence" : "android_event_sequence",
      String(incident.payload || ""),
      expectation,
      now,
      now,
    ).run();
    const saved = await env.DB.prepare(
      "SELECT id, incident_id, source, title, kind, expectation_json, enabled, created_at, updated_at FROM replay_cases WHERE incident_id = ? LIMIT 1"
    ).bind(incidentId).first();
    return json({ success: true, replay_case: saved }, 201);
  }

  // GET /api/replay-cases - regression case catalog.
  if (path === "/api/replay-cases" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 100)));
    const { results } = await env.DB.prepare(
      "SELECT id, incident_id, source, title, kind, expectation_json, enabled, created_at, updated_at " +
      "FROM replay_cases ORDER BY created_at DESC LIMIT ?"
    ).bind(limit).all();
    return json({ replay_cases: results || [] });
  }

  // POST /api/replay-cases/run - execute the whole regression catalog.
  if (path === "/api/replay-cases/run" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const { results } = await env.DB.prepare(
      "SELECT id, incident_id, source, title, kind, fixture_json, expectation_json, enabled " +
      "FROM replay_cases WHERE enabled = 1 ORDER BY created_at ASC"
    ).bind().all();
    const evaluations = (results || []).map(evaluateReplayCaseRecord);
    const failed = evaluations.filter((item) => !item.passed);
    return json({
      success: failed.length === 0,
      total: evaluations.length,
      passed: evaluations.length - failed.length,
      failed: failed.length,
      results: evaluations,
    });
  }

  return null;
}
