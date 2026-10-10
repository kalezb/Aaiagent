import {
  DEFAULT_PERSONA_FACTS,
  factsVersion,
  normalizePersonaFacts,
  parsePersonaFacts,
} from "./_persona_facts";
import {
  defaultDrawersForPersona,
  parsePersonaDrawers,
} from "./_persona_drawers";
import { EMPTY_REPLY_FALLBACK } from "./_reply_policy";

export function normalizeDrawerKeywords(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 40);
  }
  return String(value || "")
    .split(/[,，\n]/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 40);
}

const DRAWER_CARD_KINDS = new Set(["identity", "speech", "policy", "lore", "scene", "topic", "counter"]);

export function normalizeDrawerKind(value, fallback = "lore") {
  const kind = String(value || "").trim().toLowerCase();
  return DRAWER_CARD_KINDS.has(kind) ? kind : fallback;
}

export function normalizeDrawerActivation(value, fallback = "keyword") {
  const activation = String(value || "").trim().toLowerCase();
  return activation === "always" ? "always" : fallback === "always" ? "always" : "keyword";
}

export function normalizeDrawerReplyMode(value, fallback = "guide") {
  const mode = String(value || "").trim().toLowerCase();
  return mode === "exact" ? "exact" : mode === "guide" ? "guide" : fallback;
}

export function mergeDrawerCards(
  defaults,
  overrides,
  defaultKind,
  options: { includeUnknown?: boolean } = {},
) {
  const overridesById = new Map();
  const includeUnknown = options.includeUnknown !== false;
  for (const item of overrides || []) {
    if (item?.id) overridesById.set(String(item.id), item);
  }
  return defaults.map((item) => {
    const override = overridesById.get(item.id) || {};
    overridesById.delete(item.id);
    return {
      id: item.id,
      name: override.name ?? item.name,
      keywords: Array.isArray(override.keywords) ? override.keywords : (item.keywords || []),
      content: override.content ?? (item.content || ""),
      kind: normalizeDrawerKind(override.kind ?? item.kind, defaultKind),
      activation: normalizeDrawerActivation(override.activation ?? item.activation, "keyword"),
      replyMode: normalizeDrawerReplyMode(override.replyMode ?? item.replyMode, "guide"),
      priority: Number(override.priority ?? item.priority ?? 0) || 0,
      enabled: override.enabled === undefined ? item.enabled !== false : override.enabled !== false,
      deleted: override.deleted === true,
      source: "default",
    };
  }).concat(includeUnknown ? [...overridesById.values()].map((item) => ({
    id: String(item.id),
    name: String(item.name || "未命名卡片").slice(0, 80),
    keywords: Array.isArray(item.keywords) ? item.keywords : [],
    content: String(item.content || ""),
    kind: normalizeDrawerKind(item.kind, "lore"),
    activation: normalizeDrawerActivation(item.activation, "keyword"),
    replyMode: normalizeDrawerReplyMode(item.replyMode, "guide"),
    priority: Number(item.priority || 0) || 0,
    enabled: item.enabled !== false,
    deleted: item.deleted === true,
    source: "custom",
  })) : []);
}

export function effectivePersonaDrawers(personaId, storedValue) {
  const stored = parsePersonaDrawers(storedValue);
  const defaults = defaultDrawersForPersona(personaId);
  const visible = (list) => (list || []).filter((item) => item.deleted !== true);
  return {
    topics: visible(mergeDrawerCards(defaults.topics || [], stored.topics, "topic", { includeUnknown: false })),
    counters: visible(mergeDrawerCards(defaults.counters || [], stored.counters, "counter", { includeUnknown: false })),
    custom: visible(mergeDrawerCards([], stored.custom, "lore")),
  };
}

export async function loadPublishedPersonaSnapshot(db, personaId) {
  const row = await db.prepare(
    "SELECT s.id, s.persona_id, s.version, s.source_version, s.name, s.system_prompt, s.facts_json, s.cards_json, s.created_at, s.created_by " +
    "FROM persona_publications p JOIN persona_snapshots s ON s.id = p.snapshot_id " +
    "WHERE p.persona_id = ? LIMIT 1"
  ).bind(personaId).first();
  if (!row) return null;
  return {
    id: String(row.id || ""),
    personaId: String(row.persona_id || personaId),
    version: factsVersion(row, 1),
    sourceVersion: Number(row.source_version || 0),
    name: String(row.name || ""),
    systemPrompt: String(row.system_prompt || ""),
    facts: normalizePersonaFacts(parsePersonaFacts(row.facts_json), DEFAULT_PERSONA_FACTS),
    drawers: parsePersonaDrawers(row.cards_json),
    createdAt: Number(row.created_at || 0),
    createdBy: String(row.created_by || "dashboard"),
  };
}

export async function loadEffectivePersonaFacts(db, _token, personaId) {
  const defaultRow = await db.prepare(
    "SELECT facts_json, version FROM persona_facts WHERE persona_id = ? LIMIT 1"
  ).bind(personaId).first();
  const defaultFacts = normalizePersonaFacts(
    parsePersonaFacts(defaultRow?.facts_json),
    DEFAULT_PERSONA_FACTS,
  );
  return {
    facts: defaultFacts,
    version: factsVersion(defaultRow, 1),
    defaultVersion: factsVersion(defaultRow, 1),
    hasOverride: false,
  };
}

export async function loadRuntimePersonaFacts(db, _token, personaId) {
  return {
    ...(await loadEffectivePersonaFacts(db, "", personaId)),
    snapshotId: "",
    published: false,
  };
}

export async function loadForeignIdentityTerms(db, activePersonaId) {
  try {
    const { results } = await db
      .prepare("SELECT id, identity_terms FROM personas WHERE id <> ?")
      .bind(activePersonaId)
      .all();
    const terms = [];
    for (const row of results || []) {
      try {
        const parsed = JSON.parse(String(row.identity_terms || "[]"));
        if (Array.isArray(parsed)) {
          for (const term of parsed) {
            const text = String(term || "").trim();
            if (text) terms.push(text);
          }
        }
      } catch {
        // A broken term list must not block normal chat.
      }
    }
    return [...new Set(terms)];
  } catch {
    return [];
  }
}

export function stripForeignPersonaSegments(value, foreignTerms) {
  const reply = String(value || "").trim();
  if (!reply || !foreignTerms.length) return reply;
  const kept = reply
    .split(/\|\|\||\r?\n/u)
    .map((part) => part.trim())
    .filter((part) => part && !foreignTerms.some((term) => part.includes(term)));
  return kept.length ? kept.join("|||") : EMPTY_REPLY_FALLBACK;
}
