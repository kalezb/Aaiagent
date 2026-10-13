import {
  isDashboardAuthorized,
  validateToken,
} from "./_access_runtime";
import { SUPPORTED_PLATFORMS } from "./_chat_input";
import {
  DEFAULT_DEVICE_SETTINGS,
  loadDeviceSettings,
} from "./_device_runtime";
import {
  listCustomerGroups,
  loadCustomerMessages,
  loadGroupIdentity,
  parseSingleGroupId,
} from "./_history_runtime";
import { json } from "./_http_runtime";
import {
  DEFAULT_PERSONA_FACTS,
  normalizePersonaFacts,
  resolvePersonaAge,
} from "./_persona_facts";
import {
  loadRuntimePersonaFacts,
} from "./_persona_runtime";
import { loadCustomerProfile, mergeCustomerProfile } from "./_profile_runtime";

export async function handleDashboardCustomerRequest({
  request,
  env,
  url,
  path,
  method,
}) {
  // GET /api/token — list all tokens (Dashboard)
  if (path === "/api/token" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const { results } = await env.DB.prepare(
      "SELECT token, name, monthly_limit, spent, is_active, active_persona_id, created_at, last_used_at FROM tokens ORDER BY created_at DESC"
    ).all();
    return json({ tokens: results || [] });
  }

  // GET /api/config — App startup config
  if (path === "/api/config" && method === "GET") {
    const authHeader = request.headers.get("Authorization") || "";
    const tokenRow = authHeader ? await validateToken(env.DB, authHeader) : null;
    const persona = tokenRow?.active_persona_id
      ? await env.DB.prepare(
          "SELECT id, name FROM personas WHERE id = ? LIMIT 1"
        ).bind(tokenRow.active_persona_id).first()
      : await env.DB.prepare(
          "SELECT id, name FROM personas WHERE is_active = 1 LIMIT 1"
        ).first();
    const settings = tokenRow
      ? await loadDeviceSettings(env.DB, tokenRow.token)
      : { ...DEFAULT_DEVICE_SETTINGS };
    const personaId = persona?.id || "female";
    const effectivePersona = tokenRow
      ? await loadRuntimePersonaFacts(env.DB, tokenRow.token, personaId)
      : {
          facts: normalizePersonaFacts(DEFAULT_PERSONA_FACTS),
          version: 1,
        };
    const location = {
      home: {
        city: effectivePersona.facts.current_city,
        district: effectivePersona.facts.current_district,
      },
      work: {
        city: effectivePersona.facts.work_city,
        district: effectivePersona.facts.work_district,
      },
    };
    return json({
      active_persona_id: personaId,
      active_persona_name: persona?.name || "\u2606\u2622",
      location,
      persona_facts: {
        ...effectivePersona.facts,
        age: resolvePersonaAge(effectivePersona.facts),
        config_version: effectivePersona.version,
      },
      line: settings.model_line ||
        (String(await env.KV.get("llm:provider") || "").trim().toLowerCase() === "gemini" ? "b" : "a"),
      platform: settings.platform,
      hosting_enabled: settings.hosting_enabled,
      monitor_enabled: settings.monitor_enabled,
      weather_enabled: settings.weather_enabled,
      time_enabled: settings.time_enabled,
      reply_pace_sec: settings.reply_pace_sec ?? 0,
      ai_hours_enabled: settings.ai_hours_enabled ?? false,
      ai_start_hour: settings.ai_start_hour ?? 8,
      ai_end_hour: settings.ai_end_hour ?? 23,
    });
  }

  // GET /api/chat/history
  if (path === "/api/chat/history" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const token = url.searchParams.get("token") || "";
    const platform = url.searchParams.get("platform") || "";
    const contactId = url.searchParams.get("contact_id") || "";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
    const offset = parseInt(url.searchParams.get("offset") || "0");
    let query = "SELECT id, platform, contact_id, contact_name, role, content, created_at FROM chat_history";
    const conditions = [];
    const params = [];
    if (token) {
      conditions.push("token = ?");
      params.push(token);
    }
    if (platform) {
      conditions.push("platform = ?");
      params.push(platform);
    }
    if (contactId) {
      conditions.push("contact_id = ?");
      params.push(contactId);
    }
    if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
    // 2026-10-07 用户报：看板里“压到我腿毛了”的消息顺序和 App 不一样。
    // 他一次发好几条时，云端记的是“抽到的那一刻”，同一秒内没有次序，排序就乱了。
    // 加上 id 作为次序，同秒内按写入顺序（也就是 App 屏幕上的顺序）排列。
    query += " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);
    const { results } = await env.DB.prepare(query).bind(...params).all();
    return json({ history: results || [] });
  }

  // GET /api/contacts
  if (path === "/api/contacts" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const token = url.searchParams.get("token") || "";
    const platform = url.searchParams.get("platform") || "";
    let query = "SELECT id, token, platform, contact_id, contact_name, is_whitelisted, notes, created_at FROM contacts";
    const conditions = [];
    const params = [];
    if (token) {
      conditions.push("token = ?");
      params.push(token);
    }
    if (platform) {
      conditions.push("platform = ?");
      params.push(platform);
    }
    if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY created_at DESC";
    const { results } = await env.DB.prepare(query).bind(...params).all();
    return json({ contacts: results || [] });
  }

  // GET /api/customer-groups - unified customers across bound platforms
  if (path === "/api/customer-groups" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const token = url.searchParams.get("token") || "";
    const platform = url.searchParams.get("platform") || "";
    const query = url.searchParams.get("q") || "";
    const groups = await listCustomerGroups(env.DB, token, platform, query);
    const profileRows = token
      ? await env.DB.prepare("SELECT group_id, profile_json FROM customer_profiles WHERE token = ?").bind(token).all()
      : await env.DB.prepare("SELECT group_id, profile_json FROM customer_profiles").all();
    const profileMap = new Map((profileRows?.results || []).map((row) => [row.group_id, row.profile_json]));
    const enrichedGroups = groups.map((group) => {
      const raw = profileMap.get(group.id);
      let generosity_status = "observing";
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          generosity_status = parsed?.relationship?.generosity_status || "observing";
        } catch (_) {}
      }
      return {
        ...group,
        generosity_status,
      };
    });
    return json({ groups: enrichedGroups });
  }

  // POST /api/customer-groups/bind - bind multiple platform accounts to one person
  if (path === "/api/customer-groups/bind" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const body = await request.json();
    const token = String(body.token || "").trim();
    const displayName = String(body.display_name || "").trim();
    const contacts = Array.isArray(body.contacts) ? body.contacts : [];
    const normalized = contacts
      .map((contact) => ({
        platform: String(contact.platform || "").trim(),
        contactId: String(contact.contact_id || "").trim(),
        contactName: String(contact.contact_name || "").trim(),
      }))
      .filter((contact) =>
        SUPPORTED_PLATFORMS.includes(contact.platform) && contact.contactId
      );
    if (!token || !displayName || normalized.length < 1) {
      return json({ error: "缺少必要参数" }, 400);
    }

    let groupId = String(body.group_id || "").trim();
    if (!groupId) {
      for (const contact of normalized) {
        const existing = await env.DB.prepare(
          "SELECT group_id FROM contact_links WHERE token = ? AND platform = ? AND contact_id = ?"
        ).bind(token, contact.platform, contact.contactId).first();
        if (existing?.group_id) {
          groupId = existing.group_id;
          break;
        }
      }
    }
    if (!groupId || parseSingleGroupId(groupId)) groupId = "group:" + crypto.randomUUID();

    const existingGroup = await env.DB.prepare(
      "SELECT id, token FROM customer_groups WHERE id = ?"
    ).bind(groupId).first();
    if (existingGroup && existingGroup.token !== token) {
      return json({ error: "身份组不属于该设备" }, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT INTO customer_groups (id, token, display_name, notes, priority_reply, priority_last_used_at, created_at, updated_at) VALUES (?, ?, ?, '', 0, 0, ?, ?) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at"
    ).bind(groupId, token, displayName, now, now).run();

    const statements = [];
    for (const contact of normalized) {
      statements.push(env.DB.prepare(
        "INSERT INTO contacts (token, platform, contact_id, contact_name, is_whitelisted, notes, created_at) VALUES (?, ?, ?, ?, 1, '', ?) ON CONFLICT(token, platform, contact_id) DO UPDATE SET contact_name = excluded.contact_name"
      ).bind(token, contact.platform, contact.contactId, contact.contactName || contact.contactId, now));
      statements.push(env.DB.prepare(
        "INSERT INTO contact_links (group_id, token, platform, contact_id, contact_name, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token, platform, contact_id) DO UPDATE SET group_id = excluded.group_id, contact_name = excluded.contact_name"
      ).bind(groupId, token, contact.platform, contact.contactId, contact.contactName || contact.contactId, now));
    }
    await env.DB.batch(statements);
    if (body.replace_aliases === true) {
      const keepClauses = normalized.map(() => "(platform = ? AND contact_id = ?)");
      const keepParams = normalized.flatMap((contact) => [contact.platform, contact.contactId]);
      await env.DB.prepare(
        "DELETE FROM contact_links WHERE token = ? AND group_id = ? AND NOT (" + keepClauses.join(" OR ") + ")"
      ).bind(token, groupId, ...keepParams).run();
    }
    const identity = await loadGroupIdentity(env.DB, groupId, token);
    return json({ success: true, group: identity });
  }

  // DELETE /api/customer-groups/unbind - detach one platform account
  if (path === "/api/customer-groups/unbind" && method === "DELETE") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const body = await request.json();
    const token = String(body.token || "").trim();
    const platform = String(body.platform || "").trim();
    const contactId = String(body.contact_id || "").trim();
    if (!token || !platform || !contactId) return json({ error: "缺少必要参数" }, 400);
    await env.DB.prepare(
      "DELETE FROM contact_links WHERE token = ? AND platform = ? AND contact_id = ?"
    ).bind(token, platform, contactId).run();
    return json({ success: true });
  }

  // PUT /api/customer-groups/priority - place this customer before normal unread scans
  if (path === "/api/customer-groups/priority" && method === "PUT") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const body = await request.json();
    const token = String(body.token || "").trim();
    const groupId = String(body.group_id || "").trim();
    const enabled = body.enabled ? 1 : 0;
    if (!token || !groupId) return json({ error: "缺少必要参数" }, 400);

    // 2026-10-07 真机：单个联系人点“优先回复”报“服务器内部错误”（500），但通用报错把真实原因盖住了。
    // 这里把真实原因带回前端，并给缺 alias 的情况一个明确提示，方便定位。
    try {
      let identity = await loadGroupIdentity(env.DB, groupId, token);
      if (!identity) return json({ error: "客户不存在" }, 404);
      if (parseSingleGroupId(groupId)) {
        // aliases 可能压根没有这个字段：直接取 [0] 会抛异常，变成“服务器内部错误”
        const alias = (identity.aliases || [])[0];
        if (!alias) {
          return json({ error: "这个联系人还不在客户库里，先让设备同步一次再试" }, 400);
        }
        const persistentId = "group:" + crypto.randomUUID();
        const now = Math.floor(Date.now() / 1000);
        await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO customer_groups (id, token, display_name, notes, priority_reply, priority_last_used_at, created_at, updated_at) VALUES (?, ?, ?, '', ?, 0, ?, ?)"
          ).bind(
            persistentId,
            token,
            identity.display_name || alias.contact_name || alias.contact_id,
            enabled,
            now,
            now,
          ),
          env.DB.prepare(
            "INSERT INTO contact_links (group_id, token, platform, contact_id, contact_name, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token, platform, contact_id) DO UPDATE SET group_id = excluded.group_id, contact_name = excluded.contact_name"
          ).bind(
            persistentId,
            token,
            alias.platform,
            alias.contact_id,
            alias.contact_name || alias.contact_id,
            now,
          ),
        ]);
        identity = await loadGroupIdentity(env.DB, persistentId, token);
      } else {
        await env.DB.prepare(
          "UPDATE customer_groups SET priority_reply = ?, priority_last_used_at = 0, updated_at = ? WHERE id = ? AND token = ?"
        ).bind(enabled, Math.floor(Date.now() / 1000), groupId, token).run();
        identity = await loadGroupIdentity(env.DB, groupId, token);
      }
      return json({ success: true, group: identity });
    } catch (error) {
      return json({ error: "优先回复更新失败：" + String(error?.message || error) }, 500);
    }
  }

  // GET /api/customer-messages - full conversation for a unified customer
  if (path === "/api/customer-messages" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const groupId = url.searchParams.get("group_id") || "";
    const token = url.searchParams.get("token") || "";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "300"), 300);
    const sinceId = Math.max(0, parseInt(url.searchParams.get("since_id") || "0"));
    const identity = await loadGroupIdentity(env.DB, groupId, token);
    if (!identity) return json({ error: "客户不存在" }, 404);
    const messagePage = await loadCustomerMessages(env.DB, identity, limit, sinceId);
    const profile = await loadCustomerProfile(env.DB, identity.token, identity.id);
    return json({ identity, ...messagePage, profile });
  }

  // POST /api/customer-profile - update customer profile directly from dashboard inline edit
  if (path === "/api/customer-profile" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const body = await request.json();
    const token = String(body.token || "").trim();
    const groupId = String(body.group_id || "").trim();
    const patch = body.profile || {};
    if (!token || !groupId) return json({ error: "缺少必要参数" }, 400);
    const existing = await loadCustomerProfile(env.DB, token, groupId);
    const updated = mergeCustomerProfile(existing.profile, patch);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT INTO customer_profiles (token, group_id, profile_json, last_processed_message_id, extracted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token, group_id) DO UPDATE SET profile_json = excluded.profile_json, updated_at = excluded.updated_at"
    ).bind(token, groupId, JSON.stringify(updated), existing.last_processed_message_id || 0, existing.extracted_at || now, now).run();
    return json({ success: true, profile: updated });
  }

  // GET /api/takeover-alerts - 需要人工接管的记录（对方要联系方式等，系统当时停手并发了邮件）
  if (path === "/api/takeover-alerts" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const token = url.searchParams.get("token") || "";
    const contactName = url.searchParams.get("contact_name") || "";
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50") || 50, 1), 200);
    const clauses = [];
    const params = [];
    if (token) {
      clauses.push("token = ?");
      params.push(token);
    }
    if (contactName) {
      clauses.push("contact_name = ?");
      params.push(contactName);
    }
    const query = "SELECT id, platform, contact_name, kind, content, created_at, notified_at FROM takeover_alerts" +
      (clauses.length ? " WHERE " + clauses.join(" AND ") : "") +
      " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);
    const { results } = await env.DB.prepare(query).bind(...params).all();
    return json({ alerts: results || [] });
  }

  // GET /api/human-waiting - borrows xiniuzi human-waiting-by-account: who is waiting for a human, longest first
  if (path === "/api/human-waiting" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const token = url.searchParams.get("token") || "";
    const clauses = ["mode = 'manual'", "waiting_since > 0"];
    const params = [];
    if (token) {
      clauses.push("token = ?");
      params.push(token);
    }
    const { results } = await env.DB.prepare(
      "SELECT token, platform, contact_id, contact_name, takeover_by, waiting_since, latest_content, latest_at FROM conversation_stats WHERE " +
      clauses.join(" AND ") +
      " ORDER BY waiting_since ASC LIMIT 200"
    ).bind(...params).all();
    return json({ waiting: results || [] });
  }

  // POST /api/takeover - single or batch take over / release back to AI (borrows xiniuzi takeover + takeover_batch)
  if (path === "/api/takeover" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const body = await request.json();
    const items = Array.isArray(body.items)
      ? body.items
      : [{ token: body.token, platform: body.platform, contact_id: body.contact_id }];
    const mode = body.mode === "ai" ? "ai" : "manual";
    const by = String(body.by || "dashboard").slice(0, 80);
    const nowSec = Math.floor(Date.now() / 1000);
    const stmts = [];
    for (const item of items.slice(0, 100)) {
      const token = String(item.token || "").trim();
      const platform = String(item.platform || "").trim();
      const contactId = String(item.contact_id || "").trim();
      if (!token || !platform || !contactId) continue;
      stmts.push(env.DB.prepare(
        "INSERT INTO conversation_stats (token, platform, contact_id, contact_name, message_count, mode, takeover_by, waiting_since, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?) " +
        "ON CONFLICT(token, platform, contact_id) DO UPDATE SET mode = excluded.mode, takeover_by = excluded.takeover_by, waiting_since = excluded.waiting_since, updated_at = excluded.updated_at"
      ).bind(
        token,
        platform,
        contactId,
        String(item.contact_name || contactId),
        mode,
        mode === "manual" ? by : "",
        mode === "manual" ? nowSec : 0,
        nowSec,
      ));
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ success: true, mode, count: stmts.length });
  }

  return null;
}
