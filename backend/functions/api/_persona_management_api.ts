import { isDashboardAuthorized } from "./_access_runtime";
import { LEGACY_AGENT_RULES } from "./_agent_rule_inventory";
import {
  RULE_PREVIEW_CASES,
  runRawRulePreviewLine,
} from "./_agent_rule_runtime";
import { json } from "./_http_runtime";
import {
  buildPersonaFactsPrompt,
  normalizePersonaFacts,
  validatePersonaFactsInput,
} from "./_persona_facts";
import {
  claimSharedPersonaVersion,
  sharedPersonaConflict,
} from "./_persona_admin";
import {
  auditAllPersonas,
  detectAgentConfigConflicts,
} from "./_persona_audit";
import {
  defaultDrawersForPersona,
  parsePersonaDrawers,
} from "./_persona_drawers";
import {
  effectivePersonaDrawers,
  loadEffectivePersonaFacts,
  loadPublishedPersonaSnapshot,
  mergeDrawerCards,
  normalizeDrawerActivation,
  normalizeDrawerKeywords,
  normalizeDrawerKind,
  normalizeDrawerReplyMode,
} from "./_persona_runtime";

export async function handlePersonaManagementRequest({
  request,
  env,
  url,
  path,
  method,
}) {
  // GET /api/agent-overview - read the current agent without guessing what code adds
  if (path === "/api/agent-overview" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const personaId = String(url.searchParams.get("persona_id") || "female_sutang").trim();
    const persona = await env.DB.prepare(
      "SELECT id, name, system_prompt, is_active FROM personas WHERE id = ? LIMIT 1"
    ).bind(personaId).first();
    if (!persona) return json({ error: "人设不存在" }, 404);
    const drawers = effectivePersonaDrawers(
      personaId,
      await env.KV.get("persona:drawers:" + personaId, "json"),
    );
    const cards = [...drawers.topics, ...drawers.counters, ...drawers.custom];
    const sharedPersona = await loadEffectivePersonaFacts(env.DB, "", personaId);
    const publishedSnapshot = await loadPublishedPersonaSnapshot(env.DB, personaId);
    return json({
      persona: {
        id: persona.id,
        name: persona.name,
        system_prompt: persona.system_prompt || "",
        is_active: persona.is_active === 1,
      },
      facts: sharedPersona.facts,
      shared_version: sharedPersona.version,
      draft_version: sharedPersona.version,
      published_snapshot: publishedSnapshot
        ? {
            id: publishedSnapshot.id,
            version: publishedSnapshot.version,
            source_version: publishedSnapshot.sourceVersion,
            published_at: publishedSnapshot.createdAt,
          }
        : null,
      draft_is_newer: !publishedSnapshot || publishedSnapshot.sourceVersion < sharedPersona.version,
      cards,
      conflicts: detectAgentConfigConflicts(persona, sharedPersona.facts, cards),
      legacy_rules: LEGACY_AGENT_RULES,
      prompt_order: [
        "人设正文",
        "结构化人物事实",
        "本轮关系阶段",
        "可编辑规则",
        "基础规则",
        "知识库命中",
        "本轮接话说明",
        "即时边界",
        "现场感和最后收口",
      ],
    });
  }

  // GET /api/persona-audit - check all shared personas for cross-persona pollution
  if (path === "/api/persona-audit" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    return json(await auditAllPersonas(env.DB, env.KV));
  }

  // PUT /api/persona-facts - edit the shared facts used by every device
  if (path === "/api/persona-facts" && method === "PUT") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const personaId = String(body.persona_id || "female_sutang").trim();
    const persona = await env.DB.prepare(
      "SELECT id FROM personas WHERE id = ? LIMIT 1"
    ).bind(personaId).first();
    if (!persona) return json({ error: "人设不存在" }, 404);
    const validation = validatePersonaFactsInput(body);
    if (!validation.ok) return json({ error: validation.error }, 400);
    const claim = await claimSharedPersonaVersion(env.DB, personaId, body.expected_version);
    if (!claim.ok) return sharedPersonaConflict(claim.currentVersion);
    const facts = normalizePersonaFacts(validation.facts);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE persona_facts SET facts_json = ?, updated_at = ? WHERE persona_id = ?"
      ).bind(JSON.stringify(facts), now, personaId),
      env.DB.prepare(
        "UPDATE pending_replies SET status = 'superseded' WHERE persona_id = ? AND status = 'pending'"
      ).bind(personaId),
    ]);
    return json({
      success: true,
      persona_id: personaId,
      shared_version: claim.version,
      facts,
    });
  }

  // POST /api/persona/publish - freeze the current draft into a shared version.
  if (path === "/api/persona/publish" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const personaId = String(body.persona_id || "").trim();
    if (!personaId) return json({ error: "缺少 persona_id" }, 400);
    const persona = await env.DB.prepare(
      "SELECT id, name, system_prompt FROM personas WHERE id = ? LIMIT 1"
    ).bind(personaId).first();
    if (!persona) return json({ error: "人设不存在" }, 404);

    const draftFacts = await loadEffectivePersonaFacts(env.DB, "", personaId);
    const expectedVersion = Number(body.expected_version || 0);
    if (!expectedVersion || draftFacts.version !== expectedVersion) {
      return sharedPersonaConflict(draftFacts.version);
    }

    const currentPublished = await loadPublishedPersonaSnapshot(env.DB, personaId);
    if (currentPublished && currentPublished.sourceVersion === draftFacts.version) {
      return json({
        success: true,
        already_published: true,
        snapshot_id: currentPublished.id,
        published_version: currentPublished.version,
        source_version: currentPublished.sourceVersion,
      });
    }

    const drawers = effectivePersonaDrawers(
      personaId,
      await env.KV.get(`persona:drawers:${personaId}`, "json"),
    );
    const cardsJson = JSON.stringify({
      topics: drawers.topics,
      counters: drawers.counters,
      custom: drawers.custom,
    });
    const nextVersionRow = await env.DB.prepare(
      "SELECT MAX(version) AS max_version FROM persona_snapshots WHERE persona_id = ?"
    ).bind(personaId).first();
    const nextVersion = Number(nextVersionRow?.max_version || 0) + 1;
    const snapshotId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO persona_snapshots (id, persona_id, version, source_version, name, system_prompt, facts_json, cards_json, created_at, created_by) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'dashboard')"
      ).bind(
        snapshotId,
        personaId,
        nextVersion,
        draftFacts.version,
        String(persona.name || ""),
        String(persona.system_prompt || ""),
        JSON.stringify(draftFacts.facts),
        cardsJson,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO persona_publications (persona_id, snapshot_id, published_at, published_by) " +
        "VALUES (?, ?, ?, 'dashboard') " +
        "ON CONFLICT(persona_id) DO UPDATE SET snapshot_id = excluded.snapshot_id, published_at = excluded.published_at, published_by = excluded.published_by"
      ).bind(personaId, snapshotId, now),
      env.DB.prepare(
        "UPDATE pending_replies SET status = 'superseded' WHERE persona_id = ? AND status = 'pending'"
      ).bind(personaId),
    ]);

    return json({
      success: true,
      persona_id: personaId,
      snapshot_id: snapshotId,
      published_version: nextVersion,
      source_version: draftFacts.version,
      published_at: now,
    });
  }

  // POST /api/rule-preview - temporary protected A/B comparison for rule merges.
  if (path === "/api/rule-preview" && method === "POST") {
    if (!env.RULE_PREVIEW_KEY) return json({ error: "rule_preview_not_configured" }, 503);
    const body = await request.json();
    if (String(body.key || "") !== String(env.RULE_PREVIEW_KEY)) {
      return json({ error: "unauthorized" }, 401);
    }
    try {
      const caseId = String(body.case_id || "").trim();
      const previewCase = RULE_PREVIEW_CASES[caseId];
      if (!previewCase) return json({ error: "unknown case_id" }, 400);
      const scenario = String(body.scenario || "").trim().slice(0, 1000);
      if (!scenario) return json({ error: "scenario 不能为空" }, 400);
      const personaId = String(body.persona_id || "female_sutang").trim();
      const snapshot = await loadPublishedPersonaSnapshot(env.DB, personaId);
      if (!snapshot) return json({ error: "published_persona_not_found" }, 404);
      const basePrompt = [
        snapshot.systemPrompt,
        buildPersonaFactsPrompt(snapshot.facts, {
          contactLabel: personaId === "female_sutang" ? "豆瓣号" : "QQ号",
        }),
        "只输出对客户可见的回复。如果规则要求忽略某类平台内容，只输出 [忽略]。",
      ].filter(Boolean).join("\n\n");
      const runVariant = async (variant) => {
        const rules = variant === "merged" ? previewCase.merged : previewCase.original;
        const systemPrompt = `${basePrompt}\n\n【本次对照规则】\n${rules}`;
        const [lineA, lineB] = await Promise.all([
          runRawRulePreviewLine({ env, line: "a", systemPrompt, userText: scenario }),
          runRawRulePreviewLine({ env, line: "b", systemPrompt, userText: scenario }),
        ]);
        return { line_a: lineA, line_b: lineB };
      };
      const [original, merged] = await Promise.all([
        runVariant("original"),
        runVariant("merged"),
      ]);
      return json({
        success: true,
        case_id: caseId,
        persona_id: personaId,
        scenario,
        original,
        merged,
      });
    } catch (error) {
      return json({
        error: "rule_preview_failed",
        detail: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : "",
      }, 500);
    }
  }

  // GET /api/drawers - dashboard agent cards: code defaults + KV overrides merged
  if (path === "/api/drawers" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const personaId = String(url.searchParams.get("persona_id") || "female_sutang").trim();
    const drawers = effectivePersonaDrawers(
      personaId,
      await env.KV.get("persona:drawers:" + personaId, "json"),
    );
    const topics = drawers.topics;
    const counters = drawers.counters;
    const custom = drawers.custom;
    return json({
      persona_id: personaId,
      shared_version: (await loadEffectivePersonaFacts(env.DB, "", personaId)).version,
      topics,
      counters,
      custom,
      cards: [...topics, ...counters, ...custom],
    });
  }

  // PUT /api/drawers - edit one agent card (stored per persona in KV)
  if (path === "/api/drawers" && method === "PUT") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const personaId = String(body.persona_id || "female_sutang").trim();
    const id = String(body.id || "").trim();
    if (!id) return json({ error: "missing id" }, 400);
    const key = "persona:drawers:" + personaId;
    const stored = parsePersonaDrawers(await env.KV.get(key, "json"));
    const defaults = defaultDrawersForPersona(personaId);
    const base = {
      topics: mergeDrawerCards(defaults.topics || [], stored.topics, "topic", { includeUnknown: false }),
      counters: mergeDrawerCards(defaults.counters || [], stored.counters, "counter", { includeUnknown: false }),
      custom: mergeDrawerCards([], stored.custom, "lore"),
    };
    let found = false;
    for (const list of [base.topics, base.counters, base.custom]) {
      for (const item of list || []) {
        if (item.id !== id) continue;
        if (body.name !== undefined) {
          const name = String(body.name || "").trim().slice(0, 80);
          if (!name) return json({ error: "抽屉名字不能为空" }, 400);
          item.name = name;
        }
        if (body.keywords !== undefined) item.keywords = normalizeDrawerKeywords(body.keywords);
        if (body.kind !== undefined) item.kind = normalizeDrawerKind(body.kind, item.kind || "lore");
        if (body.activation !== undefined) {
          item.activation = normalizeDrawerActivation(body.activation, item.activation || "keyword");
        }
        if (body.replyMode !== undefined) {
          item.replyMode = normalizeDrawerReplyMode(body.replyMode, item.replyMode || "guide");
        }
        if (body.priority !== undefined) {
          item.priority = Math.max(-100, Math.min(100, Number(body.priority) || 0));
        }
        if (body.content !== undefined) {
          const content = String(body.content || "").trim().slice(0, 3000);
          if (!content) return json({ error: "卡片内容不能为空" }, 400);
          item.content = content;
        }
        if (body.enabled !== undefined) item.enabled = !!body.enabled;
        if (body.deleted !== undefined) item.deleted = !!body.deleted;
        found = true;
      }
    }
    if (!found) return json({ error: "unknown drawer id" }, 400);
    const claim = await claimSharedPersonaVersion(env.DB, personaId, body.expected_version);
    if (!claim.ok) return sharedPersonaConflict(claim.currentVersion);
    const forStorage = (list) => list.map((item) => ({
      id: item.id,
      name: item.name,
      keywords: item.keywords || [],
      content: item.content || "",
      kind: item.kind || "lore",
      activation: item.activation || "keyword",
      replyMode: normalizeDrawerReplyMode(item.replyMode, "guide"),
      priority: Number(item.priority || 0),
      enabled: item.enabled !== false,
      deleted: item.deleted === true,
    }));
    await env.KV.put(key, JSON.stringify({
      topics: forStorage(base.topics),
      counters: forStorage(base.counters),
      custom: forStorage(base.custom),
    }));
    return json({
      success: true,
      persona_id: personaId,
      shared_version: claim.version,
      id,
      enabled: body.enabled === undefined ? undefined : !!body.enabled,
    });
  }

  // POST /api/drawers/cards - create one custom agent card
  if (path === "/api/drawers/cards" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const personaId = String(body.persona_id || "female_sutang").trim();
    const name = String(body.name || "").trim().slice(0, 80);
    const content = String(body.content || "").trim().slice(0, 3000);
    if (!name || !content) return json({ error: "卡片名字和内容不能为空" }, 400);
    const claim = await claimSharedPersonaVersion(env.DB, personaId, body.expected_version);
    if (!claim.ok) return sharedPersonaConflict(claim.currentVersion);
    const key = "persona:drawers:" + personaId;
    const stored = parsePersonaDrawers(await env.KV.get(key, "json"));
    const custom = mergeDrawerCards([], stored.custom, "lore");
    const id = "custom_" + crypto.randomUUID().replace(/-/gu, "").slice(0, 16);
    const card = {
      id,
      name,
      content,
      keywords: normalizeDrawerKeywords(body.keywords),
      kind: normalizeDrawerKind(body.kind, "lore"),
      activation: normalizeDrawerActivation(body.activation, "keyword"),
      replyMode: normalizeDrawerReplyMode(body.replyMode, "guide"),
      priority: Math.max(-100, Math.min(100, Number(body.priority) || 0)),
      enabled: body.enabled !== false,
      deleted: false,
      source: "custom",
    };
    const defaults = defaultDrawersForPersona(personaId);
    const topics = mergeDrawerCards(defaults.topics || [], stored.topics, "topic", { includeUnknown: false });
    const counters = mergeDrawerCards(defaults.counters || [], stored.counters, "counter", { includeUnknown: false });
    const forStorage = (list) => list.map((item) => ({
      id: item.id,
      name: item.name,
      keywords: item.keywords || [],
      content: item.content || "",
      kind: item.kind || "lore",
      activation: item.activation || "keyword",
      replyMode: normalizeDrawerReplyMode(item.replyMode, "guide"),
      priority: Number(item.priority || 0),
      enabled: item.enabled !== false,
      deleted: item.deleted === true,
    }));
    await env.KV.put(key, JSON.stringify({
      topics: forStorage(topics),
      counters: forStorage(counters),
      custom: forStorage([...custom, card]),
    }));
    return json({ success: true, card, shared_version: claim.version }, 201);
  }

  // DELETE /api/drawers/cards - delete any card, including a built-in default card
  if (path === "/api/drawers/cards" && method === "DELETE") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const personaId = String(body.persona_id || "female_sutang").trim();
    const id = String(body.id || "").trim();
    if (!id) return json({ error: "missing id" }, 400);
    const key = "persona:drawers:" + personaId;
    const stored = parsePersonaDrawers(await env.KV.get(key, "json"));
    const defaults = defaultDrawersForPersona(personaId);
    const topics = mergeDrawerCards(defaults.topics || [], stored.topics, "topic", { includeUnknown: false });
    const counters = mergeDrawerCards(defaults.counters || [], stored.counters, "counter", { includeUnknown: false });
    const custom = mergeDrawerCards([], stored.custom, "lore").filter((item) => item.deleted !== true);
    let found = false;
    for (const item of [...topics, ...counters, ...custom]) {
      if (item.id === id) {
        item.deleted = true;
        item.enabled = false;
        found = true;
      }
    }
    if (!found) return json({ error: "卡片不存在" }, 404);
    const claim = await claimSharedPersonaVersion(env.DB, personaId, body.expected_version);
    if (!claim.ok) return sharedPersonaConflict(claim.currentVersion);
    const forStorage = (list) => list.map((item) => ({
      id: item.id,
      name: item.name,
      keywords: item.keywords || [],
      content: item.content || "",
      kind: item.kind || "lore",
      activation: item.activation || "keyword",
      replyMode: normalizeDrawerReplyMode(item.replyMode, "guide"),
      priority: Number(item.priority || 0),
      enabled: item.enabled !== false,
      deleted: item.deleted === true,
    }));
    await env.KV.put(key, JSON.stringify({
      topics: forStorage(topics),
      counters: forStorage(counters),
      custom: forStorage(custom),
    }));
    return json({ success: true, id, shared_version: claim.version });
  }

  return null;
}
