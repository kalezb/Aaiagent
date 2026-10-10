import {
  DEFAULT_PERSONA_FACTS,
  factsVersion,
  normalizePersonaFacts,
} from "./_persona_facts";
import { loadRuntimePersonaFacts } from "./_persona_runtime";
import { json } from "./_http_runtime";

export async function activatePersona(db, personaId) {
  const persona = await db.prepare("SELECT id, name FROM personas WHERE id = ?").bind(personaId).first();
  if (!persona) return null;
  await db.batch([
    db.prepare("UPDATE personas SET is_active = 0"),
    db.prepare("UPDATE personas SET is_active = 1 WHERE id = ?").bind(personaId),
  ]);
  return persona;
}

export async function activatePersonaForToken(db, token, personaId) {
  const persona = await db.prepare("SELECT id, name FROM personas WHERE id = ?").bind(personaId).first();
  if (!persona) return null;
  const effectivePersona = await loadRuntimePersonaFacts(db, token, personaId);
  const facts = effectivePersona.facts;
  const updatedAt = Math.floor(Date.now() / 1000);
  await db.batch([
    db.prepare("UPDATE tokens SET active_persona_id = ? WHERE token = ?").bind(personaId, token),
    db.prepare("UPDATE pending_replies SET status = 'superseded' WHERE token = ? AND status = 'pending'").bind(token),
    db.prepare(
      "INSERT INTO user_locations (token, home_city, home_district, work_city, work_district, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(token) DO UPDATE SET home_city = excluded.home_city, home_district = excluded.home_district, work_city = excluded.work_city, work_district = excluded.work_district, updated_at = excluded.updated_at"
    ).bind(token, facts.current_city, facts.current_district, facts.work_city, facts.work_district, updatedAt),
  ]);
  return persona;
}

export async function claimSharedPersonaVersion(db, personaId, expectedVersion) {
  const expected = Number(expectedVersion);
  if (!Number.isFinite(expected) || expected < 1) {
    return { ok: false, currentVersion: 0 };
  }
  const now = Math.floor(Date.now() / 1000);
  const existing = await db.prepare(
    "SELECT version FROM persona_facts WHERE persona_id = ? LIMIT 1"
  ).bind(personaId).first();
  if (!existing) {
    await db.prepare(
      "INSERT OR IGNORE INTO persona_facts (persona_id, facts_json, version, updated_at) VALUES (?, ?, 1, ?)"
    ).bind(personaId, JSON.stringify(normalizePersonaFacts(DEFAULT_PERSONA_FACTS)), now).run();
  }
  const result = await db.prepare(
    "UPDATE persona_facts SET version = version + 1, updated_at = ? WHERE persona_id = ? AND version = ?"
  ).bind(now, personaId, Math.floor(expected)).run();
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
  if (changes === 1) return { ok: true, version: Math.floor(expected) + 1 };
  const current = await db.prepare(
    "SELECT version FROM persona_facts WHERE persona_id = ? LIMIT 1"
  ).bind(personaId).first();
  return { ok: false, currentVersion: factsVersion(current, 0) };
}

export function sharedPersonaConflict(currentVersion) {
  return json({
    error: "这套共享人设已经被其他设备改过，请先刷新再修改",
    code: "persona_version_conflict",
    current_version: Number(currentVersion || 0),
  }, 409);
}
