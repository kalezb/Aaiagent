import { loadAgentRuleState } from "./_agent_rule_runtime";
import { effectivePersonaDrawers, loadEffectivePersonaFacts } from "./_persona_runtime";
import {
  loadProgramRules,
  type ProgramRulesConfig,
} from "./_program_rules";

/**
 * Reads the current rule sources once for one future chat turn.
 *
 * This is deliberately read-only for now. The existing chat path keeps using
 * the same sources it uses today until the callers are switched over in a
 * separate step with regression tests.
 */
export async function loadTurnRuleSnapshot(
  db,
  kv,
  personaId = "female_sutang",
  programRulesOverride: ProgramRulesConfig | null = null,
) {
  const normalizedPersonaId = String(personaId || "female_sutang").trim();
  const [personaRow, personaFacts, programRules, agentRuleState, drawerValue] = await Promise.all([
    db.prepare(
      "SELECT id, name, system_prompt FROM personas WHERE id = ? LIMIT 1"
    ).bind(normalizedPersonaId).first(),
    loadEffectivePersonaFacts(db, "", normalizedPersonaId),
    programRulesOverride || loadProgramRules(kv),
    loadAgentRuleState(db, normalizedPersonaId),
    kv.get(`persona:drawers:${normalizedPersonaId}`, "json"),
  ]);

  return {
    personaId: normalizedPersonaId,
    persona: {
      id: String(personaRow?.id || normalizedPersonaId),
      name: String(personaRow?.name || ""),
      systemPrompt: String(personaRow?.system_prompt || ""),
    },
    personaFacts,
    programRules,
    agentRuleState,
    drawers: effectivePersonaDrawers(normalizedPersonaId, drawerValue),
  };
}
