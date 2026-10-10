import { isDashboardAuthorized } from "./_access_runtime";
import {
  listAgentRules,
  loadAgentRuleState,
  normalizeAgentRuleGate,
  runAgentPreviewLine,
} from "./_agent_rule_runtime";
import {
  detectAgentRuleConflicts,
  summarizeAgentRuleConflicts,
} from "./_agent_rule_conflicts";
import { translateAgentRuleText } from "./_agent_rule_translate";
import { json } from "./_http_runtime";
import {
  effectivePersonaDrawers,
  loadEffectivePersonaFacts,
} from "./_persona_runtime";

export async function handleAgentRulesRequest({ request, env, path, method }) {
  // GET /api/agent-rules - editable rules used by chat on the next request.
  if (path === "/api/agent-rules" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const rules = await listAgentRules(env.DB);
    const conflicts = detectAgentRuleConflicts(rules);
    return json({
      rules,
      conflicts,
      summary: summarizeAgentRuleConflicts(conflicts),
    });
  }

  // POST /api/agent-rules/translate - turn plain Chinese into a checked action.
  if (path === "/api/agent-rules/translate" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const rules = await listAgentRules(env.DB);
    const translation = translateAgentRuleText(body.text, rules as never);
    return json({ success: true, translation });
  }

  // POST /api/agent-rules - create one rule
  if (path === "/api/agent-rules" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const title = String(body.title || "").trim().slice(0, 120);
    const detail = String(body.detail || "").trim().slice(0, 3000);
    if (!title || !detail) return json({ error: "规则名字和内容不能为空" }, 400);
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT INTO agent_rules (id, legacy_rule_id, persona_id, title, detail, gate, priority, enabled, sort_order, source, created_at, updated_at) " +
      "VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, 'dashboard', ?, ?)"
    ).bind(
      id,
      String(body.persona_id || "").trim().slice(0, 80),
      title,
      detail,
      normalizeAgentRuleGate(body.gate),
      Math.max(1, Math.min(100, Number(body.priority) || 50)),
      body.enabled === false ? 0 : 1,
      Math.max(0, Math.floor(Number(body.sort_order) || 0)),
      now,
      now,
    ).run();
    return json({ success: true, id }, 201);
  }

  // PUT /api/agent-rules - edit one rule
  if (path === "/api/agent-rules" && method === "PUT") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const id = String(body.id || "").trim();
    if (!id) return json({ error: "缺少 id" }, 400);
    const updates = [];
    const params = [];
    if (body.title !== undefined) {
      const title = String(body.title || "").trim().slice(0, 120);
      if (!title) return json({ error: "规则名字不能为空" }, 400);
      updates.push("title = ?");
      params.push(title);
    }
    if (body.detail !== undefined) {
      const detail = String(body.detail || "").trim().slice(0, 3000);
      if (!detail) return json({ error: "规则内容不能为空" }, 400);
      updates.push("detail = ?");
      params.push(detail);
    }
    if (body.gate !== undefined) {
      updates.push("gate = ?");
      params.push(normalizeAgentRuleGate(body.gate));
    }
    if (body.persona_id !== undefined) {
      updates.push("persona_id = ?");
      params.push(String(body.persona_id || "").trim().slice(0, 80));
    }
    if (body.priority !== undefined) {
      updates.push("priority = ?");
      params.push(Math.max(1, Math.min(100, Number(body.priority) || 50)));
    }
    if (body.enabled !== undefined) {
      updates.push("enabled = ?");
      params.push(body.enabled ? 1 : 0);
    }
    if (body.sort_order !== undefined) {
      updates.push("sort_order = ?");
      params.push(Math.max(0, Math.floor(Number(body.sort_order) || 0)));
    }
    if (!updates.length) return json({ error: "没有要修改的内容" }, 400);
    updates.push("updated_at = ?");
    params.push(Math.floor(Date.now() / 1000), id);
    const result = await env.DB.prepare(
      "UPDATE agent_rules SET " + updates.join(", ") + " WHERE id = ?"
    ).bind(...params).run();
    if (!Number(result?.meta?.changes || 0)) return json({ error: "规则不存在" }, 404);
    return json({ success: true, id });
  }

  // DELETE /api/agent-rules - hide the rule from the dashboard and chat immediately.
  if (path === "/api/agent-rules" && method === "DELETE") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const id = String(body.id || "").trim();
    if (!id) return json({ error: "缺少 id" }, 400);
    const rule = await env.DB.prepare(
      "SELECT id, legacy_rule_id FROM agent_rules WHERE id = ? AND deleted_at = 0 LIMIT 1"
    ).bind(id).first();
    if (!rule) return json({ error: "规则不存在" }, 404);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "UPDATE agent_rules SET enabled = 0, deleted_at = ?, updated_at = ? WHERE id = ?"
    ).bind(now, now, id).run();
    return json({ success: true, deleted: true, id });
  }

  // POST /api/agent-overview/test - run the same persona test on both model lines
  if (path === "/api/agent-overview/test" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const personaId = String(body.persona_id || "female_sutang").trim();
    const persona = await env.DB.prepare(
      "SELECT id, name, system_prompt FROM personas WHERE id = ? LIMIT 1"
    ).bind(personaId).first();
    if (!persona) return json({ error: "人设不存在" }, 404);
    const drawers = effectivePersonaDrawers(
      personaId,
      await env.KV.get("persona:drawers:" + personaId, "json"),
    );
    const cards = [...drawers.topics, ...drawers.counters, ...drawers.custom];
    const facts = (await loadEffectivePersonaFacts(env.DB, "", personaId)).facts;
    const requested = Array.isArray(body.questions) ? body.questions : [];
    const agentRuleState = await loadAgentRuleState(env.DB, personaId);
    const questions = requested
      .map((item) => String(item || "").trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 5);
    const defaults = [
      "你今年多大？",
      "你孩子几岁？",
      "你最讨厌别人做什么？",
      "你会主动给联系方式吗？",
    ];
    const finalQuestions = questions.length ? questions : defaults;
    const results = await Promise.all(finalQuestions.map(async (question) => {
      const [lineA, lineB] = await Promise.all([
        runAgentPreviewLine({ env, line: "a", persona, facts, cards, question, agentRuleState }),
        runAgentPreviewLine({ env, line: "b", persona, facts, cards, question, agentRuleState }),
      ]);
      return { question, line_a: lineA, line_b: lineB };
    }));
    return json({ success: true, persona_id: personaId, results });
  }

  return null;
}
