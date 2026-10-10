import {
  isDashboardAuthorized,
  validateToken,
} from "./_access_runtime";
import { json, parseJsonBody } from "./_http_runtime";
import {
  invalidateLlmConfigCache,
  normalizeLlmBaseUrl,
} from "./_model_runtime";
import {
  activatePersona,
  claimSharedPersonaVersion,
  sharedPersonaConflict,
} from "./_persona_admin";
import {
  DEFAULT_PERSONA_FACTS,
  normalizePersonaFacts,
} from "./_persona_facts";
import { effectivePersonaDrawers } from "./_persona_runtime";

export async function handleAdminCrudRequest({
  request,
  env,
  url,
  path,
  method,
}) {
  // POST /api/contacts
  if (path === "/api/contacts" && method === "POST") {
    const body = await request.json();
    const { token, platform, contact_id, contact_name } = body;
    const deviceToken = await validateToken(env.DB, "Bearer " + (token || ""));
    if (!isDashboardAuthorized(request, env) && !deviceToken) {
      return json({ error: "未授权" }, 401);
    }
    if (!token || !platform || !contact_id || !contact_name) {
      return json({ error: "\u7f3a\u5c11\u5fc5\u8981\u53c2\u6570" }, 400);
    }
    const isWhitelisted = body.is_whitelisted ?? 1;
    const notes = body.notes || "";
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT INTO contacts (token, platform, contact_id, contact_name, is_whitelisted, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(token, platform, contact_id) DO UPDATE SET contact_name = excluded.contact_name, is_whitelisted = excluded.is_whitelisted, notes = excluded.notes"
    ).bind(
      token,
      platform,
      contact_id,
      contact_name,
      isWhitelisted,
      notes,
      now,
    ).run();
    return json({ success: true });
  }

  // PUT /api/contacts ? update contact (whitelist toggle, notes)
  if (path === "/api/contacts" && method === "PUT") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const body = await request.json();
    const { token, platform, contact_id } = body;
    if (!token || !platform || !contact_id) return json({ error: "缺少必要参数" }, 400);
    const updates = [];
    const params = [];
    if (body.contact_name !== undefined) {
      updates.push("contact_name = ?");
      params.push(body.contact_name);
    }
    if (body.is_whitelisted !== undefined) {
      updates.push("is_whitelisted = ?");
      params.push(body.is_whitelisted);
    }
    // 2026-10-07：看板要能看见并改回“已婚不回 / 语音刷屏已停”。
    if (body.marital_status !== undefined) {
      updates.push("marital_status = ?");
      params.push(String(body.marital_status || ""));
    }
    if (body.his_photo_at !== undefined) {
      updates.push("his_photo_at = ?");
      params.push(Number(body.his_photo_at || 0));
    }
    if (body.her_photo_at !== undefined) {
      updates.push("her_photo_at = ?");
      params.push(Number(body.her_photo_at || 0));
    }
    if (body.voice_warn_at !== undefined) {
      updates.push("voice_warn_at = ?");
      params.push(Number(body.voice_warn_at || 0));
    }
    if (body.notes !== undefined) {
      updates.push("notes = ?");
      params.push(body.notes);
    }
    if (updates.length === 0) return json({ error: "没有要更新的字段" }, 400);
    params.push(token, platform, contact_id);
    await env.DB.prepare(
      "UPDATE contacts SET " + updates.join(", ") + " WHERE token = ? AND platform = ? AND contact_id = ?"
    ).bind(...params).run();
    return json({ success: true });
  }

  // DELETE /api/contacts ? delete contact
  if (path === "/api/contacts" && method === "DELETE") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const body = await request.json();
    const { token, platform, contact_id } = body;
    if (!token || !platform || !contact_id) return json({ error: "缺少必要参数" }, 400);
    await env.DB.prepare(
      "DELETE FROM contacts WHERE token = ? AND platform = ? AND contact_id = ?"
    ).bind(token, platform, contact_id).run();
    return json({ success: true });
  }

  // GET /api/persona - public metadata never exposes system prompts
  if (path === "/api/persona" && method === "GET") {
    const dashboardAuthorized = isDashboardAuthorized(request, env);
    if (!dashboardAuthorized && url.searchParams.get("include_prompt") === "1") {
      return json({ error: "Unauthorized" }, 401);
    }
    const includePrompt = dashboardAuthorized || url.searchParams.get("include_prompt") === "1";
    if (includePrompt && !isDashboardAuthorized(request, env)) {
      return json({ error: "未授权" }, 401);
    }
    const columns = includePrompt
      ? "id, name, system_prompt, is_active, created_at"
      : "id, name, is_active, created_at";
    const { results } = await env.DB.prepare(
      "SELECT " + columns +
      " FROM personas ORDER BY CASE WHEN id LIKE 'female%' THEN 0 WHEN id LIKE 'male%' THEN 1 ELSE 2 END, created_at, id"
    ).all();
    const personas = await Promise.all((results || []).map(async (persona) => {
      let drawers = null;
      if (includePrompt) {
        const customDrawers = await env.KV.get(`persona:drawers:${persona.id}`, "json");
        const effective = effectivePersonaDrawers(persona.id, customDrawers);
        drawers = {
          topics: effective.topics,
          counters: effective.counters,
          custom: effective.custom,
        };
      }
      return {
        ...persona,
        gender: String(persona.id).startsWith("female") ? "female" : "male",
        drawers,
      };
    }));
    return json({ personas });
  }

  // PUT /api/persona/activate - Dashboard persona activation
  if (path === "/api/persona/activate" && method === "PUT") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const body = await request.json();
    const persona = await activatePersona(env.DB, String(body.id || ""));
    if (!persona) return json({ success: false, error: "人设不存在" }, 404);
    return json({
      success: true,
      active_persona_id: persona.id,
      active_persona_name: persona.name,
    });
  }

  // DELETE /api/persona ? delete a persona (Dashboard)
  if (path === "/api/persona" && method === "DELETE") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const body = await request.json();
    const { id } = body;
    if (!id) return json({ error: "缺少 id" }, 400);
    await env.DB.prepare("DELETE FROM personas WHERE id = ?").bind(id).run();
    return json({ success: true });
  }

  // PUT /api/persona
  if (path === "/api/persona" && method === "PUT") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const body = await request.json();
    const { id, name, system_prompt, drawers } = body;
    if (!id || !name || !system_prompt) {
      return json({ error: "\u7f3a\u5c11\u5fc5\u8981\u53c2\u6570" }, 400);
    }
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO persona_facts (persona_id, facts_json, version, updated_at) VALUES (?, ?, 1, ?)"
    ).bind(
      String(id),
      JSON.stringify(normalizePersonaFacts(DEFAULT_PERSONA_FACTS)),
      now,
    ).run();
    const claim = await claimSharedPersonaVersion(env.DB, String(id), body.expected_version);
    if (!claim.ok) return sharedPersonaConflict(claim.currentVersion);
    if (drawers && typeof drawers === "object") {
      await env.KV.put(`persona:drawers:${id}`, JSON.stringify(drawers));
    }
    const isActive = body.is_active ?? 0;
    if (isActive === 1) await env.DB.prepare("UPDATE personas SET is_active = 0").run();
    await env.DB.prepare(
      "INSERT INTO personas (id, token, name, system_prompt, is_active, created_at) VALUES (?, '', ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, system_prompt = excluded.system_prompt, is_active = excluded.is_active"
    ).bind(id, name, system_prompt, isActive, now).run();
    await env.DB.prepare(
      "UPDATE pending_replies SET status = 'superseded' WHERE persona_id = ? AND status = 'pending'"
    ).bind(String(id)).run();
    return json({ success: true, shared_version: claim.version });
  }

  // POST /api/token - dashboard-only registration
  if (path === "/api/token" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const parsedBody = await parseJsonBody(request, 16 * 1024);
    if (parsedBody.error) return json({ error: parsedBody.error }, parsedBody.status);
    const body = parsedBody.body;
    const token = String(body.token || "").trim();
    if (!/^[A-Za-z0-9._:-]{8,160}$/u.test(token)) {
      return json({ error: "token 格式无效" }, 400);
    }
    const name = String(body.name || "").trim().slice(0, 80);
    const monthlyLimit = Number(body.monthly_limit ?? 30);
    if (!Number.isFinite(monthlyLimit) || monthlyLimit < 0 || monthlyLimit > 1_000_000) {
      return json({ error: "月度上限无效" }, 400);
    }
    const now = Math.floor(Date.now() / 1000);
    const existing = await env.DB.prepare(
      "SELECT token, is_active FROM tokens WHERE token = ?"
    ).bind(token).first();
    if (existing) {
      await env.DB.prepare(
        "UPDATE tokens SET last_used_at = ?, name = CASE WHEN name = '' THEN ? ELSE name END WHERE token = ?"
      ).bind(now, name, token).run();
      return json({ token, exists: true, is_active: existing.is_active });
    }
    await env.DB.prepare(
      "INSERT INTO tokens (token, name, monthly_limit, spent, is_active, created_at, last_used_at) VALUES (?, ?, ?, 0, 1, ?, ?)"
    ).bind(token, name, monthlyLimit, now, now).run();
    return json({ token, exists: false, is_active: 1 }, 201);
  }

  // PUT /api/token
  if (path === "/api/token" && method === "PUT") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const body = await request.json();
    const { token } = body;
    if (!token) return json({ error: "\u7f3a\u5c11 token" }, 400);
    const updates = [];
    const params = [];
    if (body.is_active !== undefined) {
      updates.push("is_active = ?");
      params.push(body.is_active);
    }
    if (body.monthly_limit !== undefined) {
      const monthlyLimit = Number(body.monthly_limit);
      if (!Number.isFinite(monthlyLimit) || monthlyLimit < 0 || monthlyLimit > 1_000_000) {
        return json({ error: "月度上限无效" }, 400);
      }
      updates.push("monthly_limit = ?");
      params.push(monthlyLimit);
    }
    if (body.name !== undefined) {
      updates.push("name = ?");
      params.push(body.name);
    }
    if (updates.length === 0) {
      return json({ error: "\u6ca1\u6709\u8981\u66f4\u65b0\u7684\u5b57\u6bb5" }, 400);
    }
    params.push(token);
    await env.DB.prepare(
      "UPDATE tokens SET " + updates.join(", ") + " WHERE token = ?"
    ).bind(...params).run();
    return json({ success: true });
  }

  // PUT /api/config
  if (path === "/api/config" && method === "PUT") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const body = await request.json();
    if (body.model_name) {
      const modelName = String(body.model_name).trim();
      if (!/^[A-Za-z0-9._:/-]{1,120}$/u.test(modelName)) {
        return json({ error: "模型名称无效" }, 400);
      }
      await env.KV.put("llm:model", modelName);
    }
    if (body.api_base) {
      const baseUrl = normalizeLlmBaseUrl(body.api_base);
      if (!baseUrl) return json({ error: "API 地址无效" }, 400);
      await env.KV.put("llm:base_url", baseUrl);
    }
    if (body.temperature !== undefined) {
      const temperature = Number(body.temperature);
      if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
        return json({ error: "temperature 无效" }, 400);
      }
      await env.KV.put("llm:temperature", String(temperature));
    }
    if (body.max_tokens !== undefined) {
      const maxTokens = Number(body.max_tokens);
      if (!Number.isInteger(maxTokens) || maxTokens < 16 || maxTokens > 4096) {
        return json({ error: "max_tokens 无效" }, 400);
      }
      await env.KV.put("llm:max_tokens", String(maxTokens));
    }
    invalidateLlmConfigCache(env.KV);
    return json({ success: true });
  }

  return null;
}
