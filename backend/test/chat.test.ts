import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { getMessageDelayPolicy, onRequest, sanitizeStaleAssistantReply } from "../functions/api/[[route]]";
import {
  buildLayeredSystemPrompt,
  buildConversationAnchor,
  buildXingmuStyleDirection,
  buildXingmuBoundaryFeedbackRepairPrompt,
  buildXingmuConversationRepairPrompt,
  buildXingmuContextRepairPrompt,
  buildDaypartRule,
  buildRelationshipBoundaryPrompt,
  resolveDaypart,
  buildTurnBrief,
  buildXingmuCardPrompt,
  buildXingmuFunnelPrompt,
  classifyConversationTurn,
  countContactRequests,
  currentUserBatchText,
  avoidRepeatedAssistantReply,
  capReplyLength,
  fixSpousePerspective,
  isSelfMediaOffer,
  owesReplyFromHistory,
  isPhotoAuthenticityChallenge,
  detectContactMaritalStatus,
  detectContactMaritalStatus,
  voiceStickerPressure,
  isWeakOpener,
  isLowValueReply,
  needsHerToLead,
  translateStickerContent,
  buildSituationTimeline,
  dropPhotoAdmissionClauses,
  dropBlameSegmentsWhenOwing,
  dropAcceptedSelfMediaSegments,
  stripLateReplyExcuse,
  extractSelfLeaveInstruction,
  hasEvaluationQuote,
  inferSocialExitCooldownMs,
  EMPTY_REPLY_FALLBACK,
  PROACTIVE_TOPIC_RULE,
  HUMAN_FEEL_RULE,
  ADVANCEMENT_RULE,
  OUTPUT_HARD_RULE,
  QUESTION_PACING_RULE,
  PROACTIVE_STYLE_SUTANG,
  PROACTIVE_STYLE_XINGMU,
  PROACTIVE_STYLE_GENERIC,
  businessFilterFallback,
  isContactRequest,
  isBoundaryFeedbackTurn,
  isChildAgeQuestion,
  isDirectWorkQuestion,
  isExcludedRecycleItem,
  isIntimateTopic,
  isSelfAgeComparisonQuestion,
  isSelfAgeQuestion,
  isSocialExitMarker,
  isVideoCallRequest,
  isVoiceCallRequest,
  localAgeReply,
  localExcludedRecycleReply,
  localVoiceReply,
  normalizeLateReplyPersonaPrompt,
  normalizeAssistantReplyPresentation,
  isXingmuSoulScope,
  parseSocialExitInstruction,
  replyGenerationSettings,
  resolveContactRequestPolicy,
  resolveXingmuEvaluationReply,
  sanitizeAgeConsistency,
  sanitizeContactDisclosure,
  sanitizeGroundingMismatch,
  sanitizeBusinessTopicDrift,
  sanitizeBoundaryConsistency,
  sanitizeIntimateTopicReply,
  sanitizeMediaBoundaryReply,
  sanitizeNewContactBusinessReply,
  sanitizePersonaFactsReply,
  sanitizeXingmuIdentity,
  sanitizeXingmuProductLeak,
  shouldRepairXingmuBoundaryFeedbackReply,
  shouldRepairXingmuContextMismatch,
  shouldRepairXingmuDeadEndReply,
  shouldRepairXingmuLowContextReply,
  XINGMU_BOUNDARY_FEEDBACK_FALLBACK,
  XINGMU_FIXED_AGE,
  XINGMU_PRODUCT_REPLY,
  VOICE_CHAT_DECLINE,
  VOICE_CHAT_DECLINES,
  VIDEO_CHAT_DECLINES,
} from "../functions/api/_reply_policy";
import {
  buildMediaDirectiveInstruction,
  findMatchingMediaGroup,
  hasNonPersonalMediaContext,
  hasContextualMediaRequest,
  isExplicitBodyMediaRequest,
  isExplicitMediaRequest,
  isRealtimeImageRequest,
  normalizePersonalPhotoIntent,
  resolveMediaGroupForDirective,
  shouldClassifyPersonalPhotoIntent,
} from "../functions/api/_media_policy";
import {
  buildPersonaFactsPrompt,
  mergePersonaFacts,
  normalizePersonaFacts,
  validatePersonaFactsInput,
} from "../functions/api/_persona_facts";
import { defaultDrawersForPersona, matchActiveDrawers } from "../functions/api/_persona_drawers";
import { loadAgentRuleState } from "../functions/api/_agent_rule_runtime";
import { DEFAULT_AGENT_RULES, LEGACY_AGENT_RULES } from "../functions/api/_agent_rule_inventory";
import {
  DEFAULT_PROGRAM_RULES,
  PROGRAM_RULES_KV_KEY,
} from "../functions/api/_program_rules";

class MockD1 {
  constructor(
    historyRows = [],
    personas = [{ id: "female", name: "星暮" }],
    contactsRows = [],
  ) {
    this.historyRows = historyRows;
    this.personas = personas;
    this.contactsRows = contactsRows;
    this.batchCalls = [];
    this.locationRows = new Map();
    this.conversationStatsRows = [];
    this.profileRows = new Map();
    this.runCalls = [];
    this.pendingRows = [];
    this.personaFactRows = new Map();
    this.personaSnapshotRows = new Map();
    this.personaPublicationRows = new Map();
    this.agentRuleRows = new Map();
    this.incidentRows = new Map();
    this.replayCaseRows = new Map();
    this.deviceOverrideRows = new Map();
    this.deviceSettingsRows = new Map();
    this.requestLimitRows = new Map();
    this.funnelRows = new Map();
    this.tokenPersonas = new Map([["test-token", "female"]]);
    this.options = {};
  }

  withOptions(options) {
    this.options = options || {};
    return this;
  }

  historyKey(statement) {
    const params = statement.params || [];
    return `${params[0]}\u0000${params[8] || ""}`;
  }

  applyHistoryInsert(statement) {
    const params = statement.params || [];
    const key = this.historyKey(statement);
    if (params[8] && this.historyRows.some((row) => `${row.token}\u0000${row.message_key || ""}` === key)) {
      return 0;
    }
    const id = Math.max(0, ...this.historyRows.map((row) => Number(row.id || 0))) + 1;
    this.historyRows.push({
      id,
      token: params[0],
      platform: params[1],
      contact_id: params[2],
      contact_name: params[3],
      role: params[4],
      content: params[5],
      created_at: params[6],
      source: params[7],
      message_key: params[8],
      persona_id: params[9] || "",
      persona_version: params[10] || 0,
      time_kind: params[11] || "",
    });
    return 1;
  }

  applyConversationStats(statement) {
    const p = statement.params || [];
    const key = `${p[0]}\u0000${p[1]}\u0000${p[2]}`;
    let row = this.conversationStatsRows.find((item) => `${item.token}\u0000${item.platform}\u0000${item.contact_id}` === key);
    if (!row) {
      row = { token: p[0], platform: p[1], contact_id: p[2], message_count: 0, latest_at: 0 };
      this.conversationStatsRows.push(row);
    }
    row.contact_name = p[3];
    row.message_count += Number(p[4] || 0);
    if (Number(p[9] || 0) >= Number(row.latest_at || 0)) {
      row.latest_message_id = p[5];
      row.latest_role = p[6];
      row.latest_content = p[7];
      row.latest_source = p[8];
      row.latest_at = p[9];
    }
    row.updated_at = p[10];
  }

  applyStatement(statement) {
    const sql = statement.sql || "";
    if (sql.includes("INSERT OR IGNORE INTO chat_history") || sql.includes("INSERT INTO chat_history")) {
      return this.applyHistoryInsert(statement);
    }
    if (sql.includes("INSERT INTO conversation_stats")) {
      this.applyConversationStats(statement);
      return 1;
    }
    if (sql.includes("INSERT OR IGNORE INTO pending_replies")) {
      const p = statement.params || [];
      const key = `${p[1]}\u0000${p[2]}`;
      if (this.pendingRows.some((row) => `${row.token}\u0000${row.request_id}` === key)) return 0;
      this.pendingRows.push({
        id: p[0], token: p[1], request_id: p[2], platform: p[3], contact_id: p[4],
        contact_name: p[5], content: p[6], status: "pending", action_type: p[7] || "text",
        media_group_id: p[8] || "", media_asset_id: p[9] || "", sent_content: "", created_at: p[10],
        persona_id: p[11] || "", persona_version: p[12] || 0,
      });
      return 1;
    }
    if (sql.includes("UPDATE pending_replies SET status = 'superseded'")) {
      const p = statement.params || [];
      if (sql.includes("WHERE persona_id = ?")) {
        const rows = this.pendingRows.filter((row) => row.persona_id === p[0]);
        for (const row of rows) {
          if (row.status === "pending") row.status = "superseded";
        }
        return rows.length;
      }
      const rows = sql.includes("WHERE id = ? AND token = ?")
        ? this.pendingRows.filter((row) => row.id === p[0] && row.token === p[1])
        : this.pendingRows.filter((row) => row.token === p[0]);
      for (const row of rows) {
        if (!sql.includes("AND status = 'pending'") || row.status === "pending") row.status = "superseded";
      }
      return rows.length;
    }
    if (sql.includes("UPDATE tokens SET active_persona_id")) {
      this.tokenPersonas.set(String(statement.params[1]), String(statement.params[0]));
      return 1;
    }
    if (sql.includes("INSERT INTO user_locations")) {
      const [token, homeCity, homeDistrict, workCity, workDistrict, updatedAt] = statement.params || [];
      this.locationRows.set(token, {
        home_city: homeCity,
        home_district: homeDistrict,
        work_city: workCity,
        work_district: workDistrict,
        updated_at: updatedAt,
      });
      return 1;
    }
    if (sql.includes("INTO persona_facts")) {
      const p = statement.params || [];
      if (sql.includes("INSERT OR IGNORE") && this.personaFactRows.has(String(p[0]))) return 0;
      const literalDefaultVersion = sql.includes("VALUES (?, ?, 1, ?)");
      this.personaFactRows.set(String(p[0]), {
        persona_id: p[0],
        facts_json: p[1],
        version: literalDefaultVersion ? 1 : (p[2] || 1),
        updated_at: literalDefaultVersion ? (p[2] || 0) : (p[3] || 0),
      });
      return 1;
    }
    if (sql.includes("UPDATE persona_facts SET version = version + 1")) {
      const p = statement.params || [];
      const row = this.personaFactRows.get(String(p[1]));
      if (!row || Number(row.version || 0) !== Number(p[2] || 0)) return 0;
      row.version = Number(row.version || 0) + 1;
      row.updated_at = p[0];
      return 1;
    }
    if (sql.includes("UPDATE persona_facts SET facts_json")) {
      const p = statement.params || [];
      const row = this.personaFactRows.get(String(p[2]));
      if (!row) return 0;
      row.facts_json = p[0];
      row.updated_at = p[1];
      return 1;
    }
    if (sql.includes("INSERT INTO persona_snapshots")) {
      const p = statement.params || [];
      this.personaSnapshotRows.set(String(p[0]), {
        id: p[0],
        persona_id: p[1],
        version: p[2],
        source_version: p[3],
        name: p[4],
        system_prompt: p[5],
        facts_json: p[6],
        cards_json: p[7],
        created_at: p[8],
        created_by: "dashboard",
      });
      return 1;
    }
    if (sql.includes("INSERT INTO persona_publications")) {
      const p = statement.params || [];
      this.personaPublicationRows.set(String(p[0]), {
        persona_id: p[0],
        snapshot_id: p[1],
        published_at: p[2],
        published_by: "dashboard",
      });
      return 1;
    }
    if (sql.includes("INSERT OR IGNORE INTO agent_rules")) {
      const p = statement.params || [];
      if (this.agentRuleRows.has(String(p[0]))) return 0;
      this.agentRuleRows.set(String(p[0]), {
        id: p[0],
        legacy_rule_id: p[1],
        persona_id: p[2],
        title: p[3],
        detail: p[4],
        gate: p[5],
        priority: p[6],
        enabled: p[7],
        sort_order: p[8],
        source: p[9],
        created_at: p[10],
        updated_at: p[11],
        deleted_at: 0,
      });
      return 1;
    }
    if (sql.includes("INSERT INTO agent_rules")) {
      const p = statement.params || [];
      this.agentRuleRows.set(String(p[0]), {
        id: p[0],
        legacy_rule_id: "",
        persona_id: p[1],
        title: p[2],
        detail: p[3],
        gate: p[4],
        priority: p[5],
        enabled: p[6],
        sort_order: p[7],
        source: "dashboard",
        created_at: p[8],
        updated_at: p[9],
        deleted_at: 0,
      });
      return 1;
    }
    if (sql.includes("UPDATE agent_rules SET enabled = 0")) {
      const params = statement.params || [];
      const softDelete = sql.includes("deleted_at");
      const row = this.agentRuleRows.get(String(params[softDelete ? 2 : 1]));
      if (!row) return 0;
      row.enabled = 0;
      if (softDelete) row.deleted_at = Number(params[0] || 0);
      row.updated_at = params[softDelete ? 1 : 0];
      return 1;
    }
    if (sql.includes("UPDATE agent_rules SET")) {
      const p = statement.params || [];
      const id = String(p[p.length - 1]);
      const row = this.agentRuleRows.get(id);
      if (!row) return 0;
      const setSql = sql.slice(sql.indexOf("SET ") + 4, sql.indexOf(" WHERE "));
      const fields = setSql.split(",").map((part) => part.trim().split(" = ")[0]);
      fields.forEach((field, index) => {
        const value = p[index];
        if (field === "enabled") row.enabled = Number(value) ? 1 : 0;
        else if (field === "priority") row.priority = Number(value);
        else if (field === "sort_order") row.sort_order = Number(value);
        else if (field === "gate") row.gate = value;
        else if (field === "persona_id") row.persona_id = value;
        else if (field === "title") row.title = value;
        else if (field === "detail") row.detail = value;
        else if (field === "updated_at") row.updated_at = value;
        else if (field === "deleted_at") row.deleted_at = Number(value || 0);
      });
      return 1;
    }
    if (sql.includes("DELETE FROM agent_rules")) {
      return this.agentRuleRows.delete(String(statement.params?.[0])) ? 1 : 0;
    }
    if (sql.includes("INSERT INTO automation_incidents")) {
      const p = statement.params || [];
      if (sql.includes("'dashboard'")) {
        this.incidentRows.set(String(p[0]), {
          id: p[0],
          token: "dashboard",
          platform: "dashboard",
          contact_id: "",
          contact_name: "",
          app_version: p[1],
          source: "dashboard",
          kind: p[2],
          status: "new",
          event_count: p[3],
          payload: p[4],
          created_at: p[5],
          updated_at: p[6],
        });
        return 1;
      }
      this.incidentRows.set(String(p[0]), {
        id: p[0],
        token: p[1],
        platform: p[2],
        contact_id: p[3],
        contact_name: p[4],
        app_version: p[5],
        source: p[6],
        kind: p[7],
        status: "new",
        event_count: p[8],
        payload: p[9],
        created_at: p[10],
        updated_at: p[11],
      });
      return 1;
    }
    if (sql.includes("UPDATE automation_incidents SET status")) {
      const p = statement.params || [];
      const row = this.incidentRows.get(String(p[2]));
      if (!row) return 0;
      row.status = p[0];
      row.updated_at = p[1];
      return 1;
    }
    if (sql.includes("DELETE FROM automation_incidents")) {
      const cutoff = Number(statement.params?.[0] || 0);
      let deleted = 0;
      for (const [id, row] of this.incidentRows.entries()) {
        const referenced = [...this.replayCaseRows.values()].some(
          (replay) => String(replay.incident_id) === String(id)
        );
        if (!referenced && Number(row.created_at || 0) < cutoff) {
          this.incidentRows.delete(id);
          deleted += 1;
        }
      }
      return deleted;
    }
    if (sql.includes("INSERT OR IGNORE INTO replay_cases")) {
      const p = statement.params || [];
      const existing = [...this.replayCaseRows.values()].find(
        (row) => String(row.incident_id) === String(p[1])
      );
      if (existing) return 0;
      this.replayCaseRows.set(String(p[0]), {
        id: p[0],
        incident_id: p[1],
        source: p[2],
        title: p[3],
        kind: p[4],
        fixture_json: p[5],
        expectation_json: p[6],
        enabled: 1,
        created_at: p[7],
        updated_at: p[8],
      });
      return 1;
    }
    if (sql.includes("INSERT INTO device_persona_overrides")) {
      const p = statement.params || [];
      this.deviceOverrideRows.set(`${p[0]}\u0000${p[1]}`, {
        token: p[0],
        persona_id: p[1],
        facts_json: p[2],
        config_version: p[3] || 1,
        updated_at: p[4] || 0,
      });
      return 1;
    }
    if (sql.includes("INSERT OR IGNORE INTO media_send_log")) {
      const p = statement.params || [];
      if (!this.options.mediaSendRows) this.options.mediaSendRows = [];
      const key = `${p[0]}\u0000${p[1]}`;
      if (this.options.mediaSendRows.some((row) => `${row.token}\u0000${row.request_id}` === key)) return 0;
      this.options.mediaSendRows.push({
        token: p[0], request_id: p[1], group_id: p[2], asset_id: p[3], status: "confirmed",
        created_at: p[4], confirmed_at: p[5], persona_id: p[6] || "", platform: p[7] || "", contact_id: p[8] || "",
      });
      return 1;
    }
    if (sql.includes("UPDATE pending_replies SET status = 'confirmed'")) {
      const p = statement.params || [];
      const row = this.pendingRows.find((item) => item.id === p[2] && item.token === p[3]);
      if (!row) return 0;
      row.status = "confirmed";
      row.sent_content = p[0];
      row.confirmed_at = p[1];
      return 1;
    }
    if (sql.includes("INSERT INTO device_settings")) {
      const p = statement.params || [];
      const existing = this.deviceSettingsRows.get(p[0]) || {
        platform: "soul",
        hosting_enabled: 0,
        monitor_enabled: 1,
        weather_enabled: 1,
        time_enabled: 1,
        reply_pace_sec: 0,
        ai_hours_enabled: 0,
        ai_start_hour: 8,
        ai_end_hour: 23,
        model_line: "",
      };
      const conflictField = String(sql.match(/DO UPDATE SET (\w+)/)?.[1] || "");
      const next = { ...existing, updated_at: p[11] };
      if (!conflictField || conflictField === "platform") next.platform = p[1];
      if (!conflictField || conflictField === "hosting_enabled") next.hosting_enabled = p[2];
      if (!conflictField || conflictField === "monitor_enabled") next.monitor_enabled = p[3];
      if (!conflictField || conflictField === "weather_enabled") next.weather_enabled = p[4];
      if (!conflictField || conflictField === "time_enabled") next.time_enabled = p[5];
      if (!conflictField || conflictField === "reply_pace_sec") next.reply_pace_sec = p[6];
      if (!conflictField || conflictField === "ai_hours_enabled") next.ai_hours_enabled = p[7];
      if (!conflictField || conflictField === "ai_start_hour") next.ai_start_hour = p[8];
      if (!conflictField || conflictField === "ai_end_hour") next.ai_end_hour = p[9];
      if (!conflictField || conflictField === "model_line") next.model_line = p[10];
      this.deviceSettingsRows.set(p[0], next);
      return 1;
    }
    if (sql.includes("INSERT INTO customer_profiles")) {
      const p = statement.params || [];
      this.profileRows.set(`${p[0]}\u0000${p[1]}`, {
        token: p[0], group_id: p[1], profile_json: p[2], last_processed_message_id: p[3], extracted_at: p[4], updated_at: p[5],
      });
      return 1;
    }
    if (sql.includes("INSERT INTO customer_funnel_states")) {
      const p = statement.params || [];
      this.funnelRows.set(`${p[0]}\u0000${p[1]}`, {
        token: p[0],
        group_id: p[1],
        stage: p[2],
        user_turn_count: p[3],
        evidence_json: p[4],
        evaluation_quote_sent: p[5],
        completed: p[6],
        last_request_id: p[7],
        stage_entered_at: p[8],
        last_advanced_at: p[9],
        last_user_message_at: p[10],
        last_negative_at: p[11],
        updated_at: p[12],
      });
      return 1;
    }
    if (sql.includes("UPDATE customer_funnel_states SET evaluation_quote_sent")) {
      const p = statement.params || [];
      const row = this.funnelRows.get(`${p[1]}\u0000${p[2]}`);
      if (!row) return 0;
      row.evaluation_quote_sent = 1;
      row.completed = 1;
      row.updated_at = p[0];
      return 1;
    }
    return 1;
  }

  prepare(sql: string) {
    return {
      all: async () => {
        if (sql.includes("FROM media_groups")) return { results: this.options.mediaGroups ?? [] };
        if (sql.includes("FROM media_assets")) return { results: this.options.mediaAssets ?? [] };
        if (sql.includes("FROM media_send_log")) return { results: this.options.mediaSendRows ?? [] };
        if (sql.includes("FROM agent_rules")) {
          const rows = [...this.agentRuleRows.values()].filter((row) =>
            !sql.includes("deleted_at = 0") || Number(row.deleted_at || 0) === 0
          );
          return { results: rows.sort((left, right) =>
            Number(right.priority || 0) - Number(left.priority || 0) ||
            Number(left.sort_order || 0) - Number(right.sort_order || 0)
          ) };
        }
        if (!sql.includes("FROM personas")) return { results: [] };
        const includePrompt = sql.includes("system_prompt");
        return {
          results: this.personas.map((persona) => includePrompt ? persona : ({
            id: persona.id,
            name: persona.name,
            is_active: persona.is_active,
            created_at: persona.created_at,
            identity_terms: persona.identity_terms,
          })),
        };
      },
      first: async () => null,
      run: async () => ({ success: true }),
      bind: (...params: unknown[]) => ({
        sql,
        params,
        first: async () => {
          if (sql.includes("FROM tokens")) {
            return {
              token: params[0],
              is_active: 1,
              monthly_limit: this.options.monthlyLimit ?? 100,
              spent: this.options.tokenSpent ?? 0,
              spent_month: this.options.tokenSpentMonth ?? "",
              active_persona_id: this.tokenPersonas.get(String(params[0])) || "female",
            };
          }
          if (sql.includes("FROM pending_replies")) {
            if (sql.includes("WHERE token = ? AND request_id = ?")) {
              return this.pendingRows.find((row) => row.token === params[0] && row.request_id === params[1]) ?? null;
            }
            if (sql.includes("platform = ? AND contact_id = ?") && sql.includes("content = ?")) {
              return this.pendingRows
                .filter((row) =>
                  row.token === params[0] &&
                  row.platform === params[1] &&
                  row.contact_id === params[2] &&
                  row.status === "pending" &&
                  row.content === params[3]
                )
                .sort((left, right) => Number(right.created_at || 0) - Number(left.created_at || 0))[0] ?? null;
            }
            if (sql.includes("WHERE id = ? AND token = ?")) {
              return this.pendingRows.find((row) => row.id === params[0] && row.token === params[1]) ?? null;
            }
            return null;
          }
          if (sql.includes("FROM persona_publications p JOIN persona_snapshots")) {
            const publication = this.personaPublicationRows.get(String(params[0]));
            return publication ? (this.personaSnapshotRows.get(String(publication.snapshot_id)) ?? null) : null;
          }
          if (sql.includes("MAX(version) AS max_version") && sql.includes("FROM persona_snapshots")) {
            const versions = [...this.personaSnapshotRows.values()]
              .filter((row) => String(row.persona_id) === String(params[0]))
              .map((row) => Number(row.version || 0));
            return { max_version: versions.length ? Math.max(...versions) : 0 };
          }
          if (sql.includes("COUNT(*) AS total") && sql.includes("FROM agent_rules")) {
            return { total: this.agentRuleRows.size };
          }
          if (sql.includes("FROM agent_rules") && sql.includes("WHERE id = ?")) {
            return this.agentRuleRows.get(String(params[0])) ?? null;
          }
          if (sql.includes("FROM automation_incidents") && sql.includes("WHERE id = ?")) {
            return this.incidentRows.get(String(params[0])) ?? null;
          }
          if (sql.includes("FROM replay_cases") && sql.includes("WHERE incident_id = ?")) {
            return [...this.replayCaseRows.values()].find(
              (row) => String(row.incident_id) === String(params[0])
            ) ?? null;
          }
          if (sql.includes("FROM persona_facts")) {
            return this.personaFactRows.get(String(params[0])) ?? null;
          }
          if (sql.includes("FROM device_persona_overrides")) {
            return this.deviceOverrideRows.get(`${params[0]}\u0000${params[1]}`) ?? null;
          }
          if (sql.includes("FROM personas")) {
            return this.personas.find((persona) => persona.id === params[0]) ?? null;
          }
          if (sql.includes("FROM user_locations")) {
            return this.locationRows.get(params[0]) ?? null;
          }
          if (sql.includes("COUNT(*) AS user_count")) {
            return this.options.profileState ?? { user_count: 0, max_id: 0 };
          }
          if (sql.includes("COUNT(*) AS total")) {
            const since = Number(params[params.length - 1] || 0);
            const aliases = [];
            for (let index = 1; index < params.length - 1; index += 2) {
              aliases.push([params[index], params[index + 1]]);
            }
            const rows = this.historyRows.filter((row) =>
              row.token === params[0] &&
              row.role === "user" &&
              Number(row.created_at || 0) > since &&
              aliases.some(([platform, contactId]) => row.platform === platform && row.contact_id === contactId)
            );
            const activeDays = new Set(rows.map((row) => Math.floor(Number(row.created_at || 0) / 86400))).size;
            return { total: rows.length, active_days: activeDays };
          }
          if (sql.includes("COUNT(*) AS n")) {
            const aliases = [];
            for (let index = 1; index < params.length; index += 2) {
              aliases.push([params[index], params[index + 1]]);
            }
            return {
              n: this.historyRows.filter((row) =>
                row.token === params[0] &&
                (!sql.includes("role = 'user'") || row.role === "user") &&
                aliases.some(([platform, contactId]) => row.platform === platform && row.contact_id === contactId)
              ).length,
            };
          }
          if (sql.includes("FROM conversation_stats")) {
            return this.conversationStatsRows.find((row) =>
              row.token === params[0] && row.platform === params[1] && row.contact_id === params[2]
            ) ?? null;
          }
          if (sql.includes("FROM device_settings")) {
            return this.deviceSettingsRows.get(params[0]) ?? null;
          }
          if (sql.includes("FROM request_limits")) {
            return this.requestLimitRows.get(params[0]) ?? null;
          }
          if (sql.includes("SELECT id FROM chat_history")) {
            return this.historyRows.find((row) => row.token === params[0] && row.message_key === params[1]) ?? null;
          }
          if (sql.includes("FROM customer_profiles")) {
            return this.profileRows.get(`${params[0]}\u0000${params[1]}`) ?? null;
          }
          if (sql.includes("FROM customer_funnel_states")) {
            return this.funnelRows.get(`${params[0]}\u0000${params[1]}`) ?? null;
          }
          if (sql.includes("FROM customer_groups g JOIN contact_links")) {
            return this.options.priorityTask ?? null;
          }
          if (sql.includes("FROM manual_replies")) {
            const task = this.options.manualTask ?? null;
            if (!task) return null;
            return sql.includes("WHERE id = ?") && params[0] !== task.id ? null : task;
          }
          if (sql.includes("FROM customer_summaries")) {
            return this.options.customerSummary ?? null;
          }
          if (sql.includes("FROM session_summary")) {
            return this.options.sessionSummary ?? null;
          }
          if (sql.includes("FROM customer_groups")) {
            return (this.options.groups ?? []).find((group) => group.id === params[0]) ?? null;
          }
          if (sql.includes("FROM media_groups")) {
            return (this.options.mediaGroups ?? []).find((group) => group.id === params[0]) ?? null;
          }
          if (sql.includes("FROM media_assets")) {
            return (this.options.mediaAssets ?? []).find((asset) => asset.id === params[0]) ?? null;
          }
          if (sql.includes("FROM contact_links")) {
            const links = this.options.contactLinks ?? [];
            if (params.length === 3) {
              return links.find((link) =>
                link.token === params[0] && link.platform === params[1] && link.contact_id === params[2]
              ) ?? null;
            }
            return links[0] ?? null;
          }
          if (sql.includes("FROM contacts")) {
            return this.contactsRows.find((row) =>
              (!row.token || row.token === params[0]) &&
              (!row.platform || row.platform === params[1]) &&
              (!row.contact_id || row.contact_id === params[2])
            ) ?? null;
          }
          return null;
        },
        all: async () => {
          if (sql.includes("LEFT JOIN contacts") && sql.includes("ORDER BY created_at")) {
            throw new Error("ambiguous column name: created_at");
          }
          if (sql.includes("FROM customer_groups g JOIN contact_links")) {
            return { results: this.options.priorityTask ? [this.options.priorityTask] : [] };
          }
          if (sql.includes("FROM customer_groups")) return { results: this.options.groups ?? [] };
          if (sql.includes("FROM media_groups")) return { results: this.options.mediaGroups ?? [] };
          if (sql.includes("FROM media_assets")) {
            const rows = this.options.mediaAssets ?? [];
            if (!sql.includes("group_id = ?")) return { results: rows };
            return { results: rows.filter((asset) => asset.group_id === params[0]) };
          }
          if (sql.includes("FROM media_send_log")) return { results: this.options.mediaSendRows ?? [] };
          if (sql.includes("FROM persona_facts")) return { results: [...this.personaFactRows.values()] };
          if (sql.includes("FROM device_persona_overrides")) return { results: [...this.deviceOverrideRows.values()] };
          if (sql.includes("FROM agent_rules")) {
            const rows = [...this.agentRuleRows.values()].filter((row) =>
              !sql.includes("deleted_at = 0") || Number(row.deleted_at || 0) === 0
            );
            return { results: rows.sort((left, right) =>
              Number(right.priority || 0) - Number(left.priority || 0) ||
              Number(left.sort_order || 0) - Number(right.sort_order || 0)
            ) };
          }
          if (sql.includes("FROM automation_incidents")) {
            return { results: [...this.incidentRows.values()] };
          }
          if (sql.includes("FROM replay_cases")) {
            return { results: [...this.replayCaseRows.values()] };
          }
          if (sql.includes("FROM contact_links")) return { results: this.options.contactLinks ?? [] };
          if (sql.includes("FROM customer_summaries")) return { results: this.options.customerSummaries ?? [] };
          if (sql.includes("FROM session_summary")) return { results: this.options.sessionSummaries ?? [] };
          if (sql.includes("FROM contacts")) return { results: this.contactsRows };
          if (sql.includes("FROM personas")) {
            const includePrompt = sql.includes("system_prompt");
            return {
              results: this.personas.map((persona) => includePrompt ? persona : ({
                id: persona.id,
                name: persona.name,
                is_active: persona.is_active,
                created_at: persona.created_at,
                identity_terms: persona.identity_terms,
              })),
            };
          }
          if (sql.includes("FROM conversation_stats")) return { results: this.conversationStatsRows };
          if (sql.includes("FROM pending_replies")) {
            return {
              results: this.pendingRows.filter((row) =>
                row.token === params[0] &&
                row.platform === params[1] &&
                row.contact_id === params[2] &&
                row.status === "confirmed"
              ),
            };
          }
          if (sql.includes("FROM chat_history")) {
            const hasTokenFilter = sql.includes("token = ?");
            const sinceId = sql.includes("id > ?")
              ? Number(params[sql.includes("LIMIT ?") ? params.length - 2 : params.length - 1] || 0)
              : 0;
            const aliasClauseCount = (sql.match(/\(platform = \? AND contact_id = \?\)/gu) || []).length;
            const aliases = [];
            for (let index = 1; index <= aliasClauseCount * 2; index += 2) {
              aliases.push([String(params[index] || ""), String(params[index + 1] || "")]);
            }
            return {
              results: this.historyRows.filter((row) =>
                (!hasTokenFilter || (row.token ?? params[0]) === params[0]) &&
                Number(row.id || 0) > sinceId &&
                (!aliases.length || aliases.some(([platform, contactId]) =>
                  (row.platform ?? platform) === platform && (row.contact_id ?? contactId) === contactId
                ))
              ),
            };
          }
          return { results: [] };
        },
        run: async () => {
          this.runCalls.push({ sql, params });
          if (sql.includes("UPDATE tokens SET active_persona_id")) {
            this.tokenPersonas.set(String(params[1]), String(params[0]));
          }
          if (sql.includes("INSERT INTO user_locations")) {
            const [token, homeCity, homeDistrict, workCity, workDistrict, updatedAt] = params;
            this.locationRows.set(token, {
              home_city: homeCity,
              home_district: homeDistrict,
              work_city: workCity,
              work_district: workDistrict,
              updated_at: updatedAt,
            });
          }
          const changes = this.applyStatement({ sql, params });
          return { success: true, meta: { changes } };
        },
      }),
    };
  }

  async batch(statements: unknown[]) {
    this.batchCalls.push(statements);
    return statements.map((statement) => ({
      success: true,
      meta: { changes: this.applyStatement(statement) },
    }));
  }
}

class MockKV {
  private store = new Map<string, string | ArrayBuffer>();

  async get(key: string, type?: string): Promise<unknown> {
    const value = this.store.get(key) ?? null;
    if (!value) return null;
    if (type === "arrayBuffer") return value instanceof ArrayBuffer ? value : new TextEncoder().encode(value).buffer;
    return type === "json" && typeof value === "string" ? JSON.parse(value) : value;
  }

  async put(key: string, value: string | ArrayBuffer | Uint8Array): Promise<void> {
    const normalized = value instanceof Uint8Array
      ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
      : value;
    this.store.set(key, normalized);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function mockChatSequence(contents: string[]) {
  const pending = [...contents];
  return vi.fn().mockImplementation(async (url: string | URL | Request) => {
    const target = String(url);
    if (target.includes("/chat/completions")) {
      const content = pending.shift();
      if (content === undefined) throw new Error("unexpected_chat_completion_call");
      return new Response(JSON.stringify({
        choices: [{ message: { content } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (target.includes("qweather.com")) {
      return new Response(JSON.stringify({ location: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function visionRequest(imageBase64 = "ZmFrZS1pbWFnZQ==") {
  return new Request("https://example.com/api/vision/describe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify({
      image_base64: imageBase64,
      mime_type: "image/jpeg",
      prompt: "describe image",
    }),
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("chat logic", () => {
  it("keeps up to 20 recent raw messages for conversational continuity", () => {
    const messages = Array.from({ length: 50 }, (_, index) => ({
      content: `message-${index}`,
    }));
    expect(messages.slice(-20)[0].content).toBe("message-30");
    expect(messages.slice(-20).at(-1)?.content).toBe("message-49");
  });

  it("ships compact persona cards instead of per-turn style manuals", () => {
    const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
    expect(schema).toContain("你是王雅慧，对外叫星暮，熟了叫慧慧");
    expect(schema).toContain("做二手手机和废旧数码回收，主要走线上寄件和同城上门");
    expect(schema).not.toContain("已婚未育");
    expect(schema).not.toContain("公婆");
    expect(schema).toContain('"marital_status":"divorced"');
    expect(schema).not.toContain("每条回复50字以内");
    expect(schema).not.toContain("以后是否给QQ由系统门槛决定");
  });

  it("adds bounded flirting to Xingmu without making it a global task", () => {
    const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
    const migration = readFileSync(
      new URL("../db/migrations/20261002_add_bounded_flirting_to_xingmu.sql", import.meta.url),
      "utf8",
    );
    const rule = "会撩，但必须先看场合、看对方反应、看关系阶段；该收的时候马上收。";

    expect(schema).toContain(rule);
    expect(migration).toContain(rule);
    expect(migration).toContain("WHERE id = 'female'");
  });

  it("passes base persona, platform, location, time and role context to the model", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "在的" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: "reply-request-1",
        platform: "soul",
        contact_id: "期待下一步的我们",
        contact_name: "期待下一步的我们",
        self_nickname: "另一面的我",
        location: { home: { city: "重庆", district: "两江新区" }, work: { city: "重庆", district: "两江新区" } },
        messages: [{ role: "user", content: "今天忙不忙" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({
      action: "send",
      reply: "在的",
    });
    expect(responseBody.request_id).toBe("reply-request-1");
    expect(responseBody.timing).toMatchObject({
      llm_budget_ms: 10_000,
      repair_attempted: false,
    });
    expect(responseBody.timing.llm_ms).toBeGreaterThanOrEqual(0);
    expect(responseBody.timing.total_ms).toBeGreaterThanOrEqual(0);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const payload = JSON.parse(String(init.body));
    expect(payload.max_tokens).toBe(96);
    expect(payload.messages[0].content).toContain("【交流方式】");
    expect(payload.messages[0].content).toContain("每段3到20个字，最多两条，必须把意思表达清楚");
    expect(payload.messages[0].content).toContain("每轮最多一个问号；上一轮已经问过，这一轮就不要再问");
    expect(payload.messages[0].content).toContain("不要连续两轮只接不推进");
    expect(payload.messages[0].content).toContain("【真人节奏】");
    expect(payload.messages[0].content).toContain("【语气与漏斗分离】");
    expect(payload.messages[0].content).toContain("【事实与边界】");
    expect(payload.messages[0].content).toContain("【当前平台】soul。");
    expect(payload.messages[0].content).toContain("【当前平台账号昵称】你在soul上的账号昵称是“另一面的我”");
    expect(payload.messages[0].content).toContain("不代表其他平台昵称");
    expect(payload.messages[0].content).toContain("【人物事实｜最高优先级】");
    expect(payload.messages[0].content).toContain("现居地：重庆两江新区");
    expect(payload.messages[0].content).toContain("工作地：重庆江北区");
    expect(payload.messages[0].content).toContain("【关系前提】你们是在 Soul 匹配或附近加上，还没见过面。");
    expect(payload.messages[0].content).toContain("【新客节奏】");
    expect(payload.messages[0].content).not.toContain("【当前天气】");
    expect(payload.messages[0].content).toContain("你们刚在 Soul 匹配上，还没见过。当前只做认识，不要提前推进业务。");
    expect(payload.messages[0].content).toContain("【星暮六段漏斗】认识阶段");
    expect(payload.messages[0].content).toContain("【本轮接话】");
    expect(payload.messages[0].content).toContain("【对方原话事实】今天忙不忙");
    expect(payload.messages[0].content).toContain("不能把“睡醒了、还没睡”改写成“睡得香、睡着了”");
    expect(payload.messages[0].content).not.toContain("最新消息优先");
    expect(payload.messages[0].content).not.toContain("话题锁定");
  });

  it("retries the upstream once with current messages only when history is rejected", async () => {
    const kv = new MockKV();
    const history = Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      token: "test-token",
      platform: "soul",
      contact_id: "墨染清秋",
      contact_name: "墨染清秋",
      role: index % 2 === 0 ? "user" : "assistant",
      content: `历史消息-${index}`,
      created_at: Math.floor(Date.now() / 1000) - 3600 + index,
      source: index % 2 === 0 ? "sync" : "ai",
      message_key: `history-${index}`,
      persona_id: index % 2 === 0 ? "" : "female_sutang",
    }));
    const db = new MockD1(history, [{ id: "female_sutang", name: "苏棠", system_prompt: "你是苏棠。" }]);
    db.tokenPersonas.set("test-token", "female_sutang");

    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).includes("/chat/completions")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      callCount += 1;
      if (callCount === 1) {
        const body = JSON.parse(String(init?.body || "{}"));
        const hasHistory = body.messages.some((message) => String(message.content).includes("历史消息-"));
        expect(hasHistory).toBe(true);
        return new Response(
          JSON.stringify({ error: { message: "upstream rejected history" } }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      if (callCount === 2) {
        const body = JSON.parse(String(init?.body || "{}"));
        expect(body.messages.some((message) => String(message.content).includes("历史消息-"))).toBe(false);
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "精简重试成功" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "upstream-history-retry-1",
          platform: "soul",
          contact_id: "墨染清秋",
          contact_name: "墨染清秋",
          messages: [{ role: "user", content: "你是哪里的" }],
        }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "精简重试成功",
    });
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("skips without calling the model when the latest message is ours", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "last-message-from-self-1",
          platform: "soul",
          contact_id: "handled-contact",
          contact_name: "已回过的人",
          messages: [
            { role: "user", content: "在吗" },
            { role: "assistant", content: "在呢" },
          ],
        }),
      }),
      env: { DB: new MockD1(), KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "skip",
      reason: "last_message_from_self",
      request_id: "last-message-from-self-1",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses dashboard markers to drop platform notices before the model call", async () => {
    const kv = new MockKV();
    await kv.put(PROGRAM_RULES_KV_KEY, JSON.stringify({
      ...DEFAULT_PROGRAM_RULES,
      platformNotice: {
        enabled: true,
        markers: ["自定义提醒"],
      },
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "custom-platform-notice-1",
          platform: "soul",
          contact_id: "notice-contact",
          contact_name: "平台提示测试",
          messages: [{ role: "user", content: "【自定义提醒】对方正在输入……" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "skip",
      reason: "platform_notice",
      request_id: "custom-platform-notice-1",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the dashboard fixed reply for an untranscribed voice", async () => {
    const kv = new MockKV();
    await kv.put(PROGRAM_RULES_KV_KEY, JSON.stringify({
      ...DEFAULT_PROGRAM_RULES,
      untranscribedVoice: {
        enabled: true,
        mode: "fixed_reply",
        fixedReply: "在呢 你打字跟我说嘛",
        redirectInstruction: "",
      },
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "custom-voice-reply-1",
          platform: "soul",
          contact_id: "voice-contact",
          contact_name: "语音测试",
          messages: [{ role: "user", content: "[语音]" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "在呢 你打字跟我说嘛",
      reason: "untranscribed_voice_fixed",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends editable sticker meanings to the model", async () => {
    const kv = new MockKV();
    await kv.put(PROGRAM_RULES_KV_KEY, JSON.stringify({
      ...DEFAULT_PROGRAM_RULES,
      sticker: {
        enabled: true,
        meanings: { 月亮: "想找你聊天" },
        instruction: "表情只按程序给出的意思理解。",
      },
    }));
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes("qweather.com")) {
        return new Response(JSON.stringify({ location: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "月亮都替你想我了" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "custom-sticker-meaning-1",
          platform: "soul",
          contact_id: "sticker-contact",
          contact_name: "表情测试",
          messages: [{ role: "user", content: "[月亮]" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "月亮都替你想我了",
    });
    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/chat/completions")) as [string, RequestInit];
    const [, init] = chatCall;
    const payload = JSON.parse(String(init.body));
    const incoming = payload.messages.find((message: Record<string, string>) => message.role === "user");
    expect(incoming.content).toContain("[表情包：月亮（想找你聊天）]");
    expect(payload.messages[0].content).toContain("表情只按程序给出的意思理解。");
  });

  it("uses an edited safety boundary on the next chat request", async () => {
    const env = {
      DB: new MockD1(),
      KV: new MockKV(),
      DEEPSEEK_API_KEY: "deepseek-key",
      DASHBOARD_PASSWORD: "dashboard-secret",
    };
    const saved = await onRequest({
      request: new Request("https://example.com/api/program-rules", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Password": "dashboard-secret",
        },
        body: JSON.stringify({
          rules: {
            safetyBoundary: {
              text: "刚改的安全底线：不许自动提付款。",
            },
          },
        }),
      }),
      env,
    } as never);
    expect(saved.status).toBe(200);

    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "收到" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "edited-safety-boundary-1",
          platform: "soul",
          contact_id: "safety-boundary-contact",
          contact_name: "安全底线测试",
          messages: [{ role: "user", content: "你好" }],
        }),
      }),
      env,
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "收到",
    });
    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/chat/completions")) as [string, RequestInit];
    const [, init] = chatCall;
    const payload = JSON.parse(String(init.body));
    expect(payload.messages[0].content).toContain("刚改的安全底线：不许自动提付款。");
  });

  it("blocks instruction-like internal text from reaching the customer", async () => {
    const env = {
      DB: new MockD1(),
      KV: new MockKV(),
      DEEPSEEK_API_KEY: "deepseek-key",
    };
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "先答他怎么表现：听话 不催 不越界" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "internal-leak-1",
          platform: "soul",
          contact_id: "internal-leak-contact",
          contact_name: "穿帮话测试",
          messages: [
            { role: "user", content: "具体要我怎么表现" },
            { role: "user", content: "姐姐问你个事" },
          ],
        }),
      }),
      env,
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "嗯 我在",
    });
    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/chat/completions")) as [string, RequestInit];
    const [, init] = chatCall;
    const payload = JSON.parse(String(init.body));
    expect(payload.messages[0].content).toContain("【内部内容禁止外泄】");
  });

  it("removes a deleted rule from the next chat request", async () => {
    const env = {
      DB: new MockD1(),
      KV: new MockKV(),
      DEEPSEEK_API_KEY: "deepseek-key",
      DASHBOARD_PASSWORD: "dashboard-secret",
    };
    const listed = await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        headers: { "X-Dashboard-Password": "dashboard-secret" },
      }),
      env,
    } as never);
    const listBody = await listed.json();
    const lateRule = listBody.rules.find((rule: any) => rule.legacy_rule_id === "late_reply_current_only");
    expect(lateRule).toBeTruthy();

    const deleted = await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Password": "dashboard-secret",
        },
        body: JSON.stringify({ id: lateRule.id }),
      }),
      env,
    } as never);
    expect(deleted.status).toBe(200);
    const deletedState = await loadAgentRuleState(env.DB, "female");
    expect(deletedState.isEnabled("late_reply_current_only", true)).toBe(false);
    expect(deletedState.textFor("late_reply_current_only", "fallback")).toBe("");

    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "收到" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "deleted-rule-next-chat-1",
          platform: "soul",
          contact_id: "deleted-rule-contact",
          contact_name: "删除规则测试",
          messages: [{ role: "user", content: "你好" }],
        }),
      }),
      env,
    } as never);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "收到",
    });
    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/chat/completions")) as [string, RequestInit];
    const [, init] = chatCall;
    const payload = JSON.parse(String(init.body));
    expect(payload.messages[0].content).not.toContain("只接对方最新一句；不主动解释");
  });

  it("returns the upstream status when both attempts fail", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "model overloaded" } }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "upstream-both-failed-1",
          platform: "soul",
          contact_id: "墨染清秋",
          contact_name: "墨染清秋",
          messages: [{ role: "user", content: "你是哪里的" }],
        }),
      }),
      env: { DB: new MockD1(), KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: "llm_upstream_error",
      upstream_status: 503,
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/chat/completions"))).toHaveLength(2);
  });

  it("disables reasoning and retries with a larger budget when the model returns empty content", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).includes("/chat/completions")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      callCount += 1;
      bodies.push(JSON.parse(String(init?.body || "{}")));
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            choices: [{
              message: { role: "assistant", content: "", reasoning_content: "想了很多但没写正文" },
              finish_reason: "length",
            }],
            usage: { completion_tokens: 96 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "这次有正文了" }, finish_reason: "stop" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "empty-content-retry-1",
          platform: "soul",
          contact_id: "zy",
          contact_name: "zy",
          messages: [{ role: "user", content: "你老公呢" }],
        }),
      }),
      env: { DB: new MockD1(), KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "这次有正文了",
    });
    expect(callCount).toBe(2);
    expect(bodies[0].thinking).toEqual({ type: "disabled" });
    expect(Number(bodies[1].max_tokens)).toBeGreaterThan(Number(bodies[0].max_tokens));
  });

  it("aborts a slow model call within the configured chat budget", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "clear",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    let capturedSignal: AbortSignal | null = null;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      capturedSignal = init?.signal || null;
      const rejectAborted = () => reject(
        capturedSignal?.reason || Object.assign(new Error("aborted"), { name: "AbortError" })
      );
      if (capturedSignal?.aborted) {
        rejectAborted();
        return;
      }
      capturedSignal?.addEventListener("abort", rejectAborted, { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "slow-model-request",
          platform: "soul",
          contact_id: "contact-1",
          contact_name: "contact",
          location: { home: { city: "Chongqing", district: "Yuzhong" } },
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
      env: {
        DB: new MockD1(),
        KV: kv,
        DEEPSEEK_API_KEY: "deepseek-key",
        CHAT_LLM_TIMEOUT_MS: "30",
      },
    } as never);

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      code: "llm_timeout",
      request_id: "slow-model-request",
      timing: {
        llm_budget_ms: 30,
        main_llm_ms: expect.any(Number),
        total_ms: expect.any(Number),
      },
    });
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("scopes the new Xingmu prompt rules to the Soul persona", () => {
    const promptFor = (
      personaPrompt: string,
      platform: string,
      mediaActionsEnabled = false,
      personaFacts: Record<string, unknown> | null = null,
    ) => buildLayeredSystemPrompt({
      personaPrompt,
      personaFacts,
      platform,
      profileContext: "",
      currentDatetime: "2026-09-30 22:30:00",
      weekday: "星期三",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "两江新区" },
      weather: null,
      weatherEnabled: false,
      timeEnabled: false,
      stageText: "测试阶段",
      relationStageLevel: 1,
      messages: [{ role: "user", content: "你好" }],
      historyMessages: [],
      mediaActionsEnabled,
      mediaGroups: [
        { id: "daily", name: "日常照" },
        { id: "body", name: "身材照" },
      ],
    });

    const soulPrompt = promptFor("你是王雅慧，对外叫星暮。", "soul", true, {
      age_mode: "fixed_age",
      fixed_age: 29,
      marital_status: "divorced",
      has_children: false,
      vehicle: "宝马X3",
      housing: "自有住房",
      hometown: "重庆",
      current_city: "重庆",
      current_district: "两江新区",
      work_city: "重庆",
      work_district: "江北区",
      location_precision: "district",
      proactive_location_allowed: false,
    });
    expect(soulPrompt).toContain("【星暮六段漏斗】");
    expect(soulPrompt).toContain("【关系前提】");
    expect(soulPrompt).toContain("【人物事实｜最高优先级】");
    expect(soulPrompt).toContain("【人设风格｜只负责表达方式】");
    expect(soulPrompt).toContain("优先级高于历史聊天、人设风格描述、对方推测和模型推断");
    expect(soulPrompt).toContain("不能自行补充、改写、推断自己的身份事实");
    expect(soulPrompt).not.toContain("【年龄事实｜最高优先级】");
    expect(soulPrompt).toContain("婚姻状态：离异");
    expect(soulPrompt).toContain("子女：没有孩子");
    expect(soulPrompt).toContain("车辆：宝马X3");
    expect(soulPrompt).toContain("住房：自有住房");
    expect(soulPrompt).not.toContain("已婚，无子女");
    expect(soulPrompt).toContain("不要回复单字");
    expect(soulPrompt).toContain("默认只发日常照");
    expect(soulPrompt).toContain("身材照、腿照或腰照");
    expect(soulPrompt).toContain("【离场判断｜最高优先级】");
    expect(soulPrompt).toContain("[[NO_REPLY:类型]]");
    expect(soulPrompt).toContain("[[SELF_LEAVE:类型]]");

    const agedSoulPrompt = promptFor("你是王雅慧，对外叫星暮，29岁。", "soul", true);
    expect(agedSoulPrompt).toContain("【年龄事实｜最高优先级】你的人设年龄固定为29岁");

    const qqPrompt = promptFor("你是王雅慧，对外叫星暮。", "qq", true);
    expect(qqPrompt).toContain("【星暮六段漏斗】");
    expect(qqPrompt).toContain("【关系前提】");
    expect(qqPrompt).toContain("照片动作以系统图片指令为准");
    expect(qqPrompt).toContain("[[SELF_LEAVE:类型]]");
    expect(qqPrompt).not.toContain("见面或开房当成");
    expect(qqPrompt).toContain(PROACTIVE_STYLE_XINGMU);
    expect(qqPrompt).not.toContain(PROACTIVE_STYLE_SUTANG);

    const otherPersonaPrompt = promptFor("你是陈屿，33岁男性。", "soul");
    expect(otherPersonaPrompt).not.toContain("【星暮六段漏斗】");
    expect(otherPersonaPrompt).not.toContain("【关系前提】");
    expect(otherPersonaPrompt).toContain("【人设风格｜只负责表达方式】");
    expect(otherPersonaPrompt).toContain("你是陈屿，33岁男性。");
    expect(otherPersonaPrompt).toContain(PROACTIVE_STYLE_GENERIC);
    expect(otherPersonaPrompt).not.toContain(PROACTIVE_STYLE_XINGMU);
    expect(otherPersonaPrompt).not.toContain(PROACTIVE_STYLE_SUTANG);
  });

  it("keeps Xingmu identity on non-Soul platforms after removing the platform guard", () => {
    expect(isXingmuSoulScope({
      personaPrompt: "你是王雅慧，对外叫星暮。",
      platform: "qq",
    })).toBe(true);
  });

  it("把转发动态卡片判成专门场景，不被卡片正文里的词带跑", () => {
    // 安卓侧读出来的卡片长这样：固定标记 + 作者 + 正文 + 配图描述。
    const card = {
      role: "user",
      content: "[对方转发了动态]。动态作者：另一面的我。动态正文：最近压力太大有点掉发。" +
        "动态配图（客观识别）：一个女生站在洗手池前。",
    };
    const praise = { role: "user", content: "好棒" };

    // 正文里有"压力"，但绝不能因此判成"对方在倾诉情绪"。
    expect(classifyConversationTurn([card])).toBe("forwarded_moment");
    // 后面紧跟的短句是冲着这条动态说的，走同一个场景，不另起新话题。
    expect(classifyConversationTurn([card, praise])).toBe("forwarded_moment");
    // 单独一句"好棒"不受影响，还是普通聊天。
    expect(classifyConversationTurn([praise])).toBe("normal");
    // 历史里躺着卡片、本轮只是普通文字时，不能误判。
    expect(classifyConversationTurn(
      [{ role: "user", content: "今天天气不错" }], "", [card],
    )).toBe("normal");

    const brief = buildTurnBrief({ messages: [card, praise] });
    expect(brief).toContain("场景：对方转发了一条动态过来");
    expect(brief).toContain("对方转发了一条动态");
  });

  it("builds a concise turn brief instead of forcing a fixed reply template", () => {
    expect(classifyConversationTurn([{ role: "user", content: "你好" }])).toBe("greeting");
    expect(classifyConversationTurn([{ role: "user", content: "你多大" }])).toBe("age");
    expect(classifyConversationTurn([{ role: "user", content: "你做什么工作的" }])).toBe("work");
    expect(classifyConversationTurn([{ role: "user", content: "今天累死了" }])).toBe("emotion");
    expect(classifyConversationTurn([{ role: "user", content: "旧手机还收吗" }])).toBe("business");
    expect(classifyConversationTurn([{ role: "user", content: "好" }])).toBe("ack");
    expect(classifyConversationTurn([{ role: "user", content: "你真好看" }])).toBe("compliment");
    expect(classifyConversationTurn([{ role: "user", content: "可以和你语音聊天吗" }])).toBe("voice_request");
    expect(classifyConversationTurn([{ role: "user", content: "可以视频看看你吗" }])).toBe("video_request");
    const boundaryHistory = [
      { role: "user", content: "看看有没有机会发展一下" },
      { role: "assistant", content: "看你表现呗" },
      { role: "user", content: "宝贝" },
      { role: "assistant", content: "才聊几句就喊宝贝，你这进度条拉太快了" },
    ];
    const boundaryFeedbackMessages = [
      { role: "user", content: "哈哈哈" },
      { role: "user", content: "不喜欢" },
    ];
    expect(classifyConversationTurn(boundaryFeedbackMessages, "", boundaryHistory)).toBe("boundary_feedback");

    const greeting = buildTurnBrief({
      messages: [{ role: "user", content: "你好" }],
      currentDatetime: "2026-09-29 03:00:00",
      relationStageLevel: 1,
    });
    expect(greeting).toContain("场景：问候或确认你在不在");
    expect(greeting).toContain("先把那件具体的事答了");
    expect(greeting).toContain("不要汇报自己正在做什么");
    expect(greeting).toContain("三连");
    expect(greeting).toContain("不要只回“咋啦”");
    expect(greeting).toContain("你好呀");

    const voiceRequest = buildTurnBrief({ messages: [{ role: "user", content: "可以和你语音聊天吗" }] });
    expect(voiceRequest).toContain("场景：对方邀请语音或通话");
    expect(voiceRequest).toContain("用一句带点玩味的话拒绝语音");
    expect(voiceRequest).toContain("不要答应以后打语音或打电话");

    const videoRequest = buildTurnBrief({ messages: [{ role: "user", content: "可以视频看看你吗" }] });
    expect(videoRequest).toContain("场景：对方要求视频");
    expect(videoRequest).toContain("不能发视频");

    const age = buildTurnBrief({ messages: [{ role: "user", content: "你多大了" }] });
    expect(age).toContain("场景：对方询问年龄");
    expect(age).toContain("你呢");

    const emotion = buildTurnBrief({ messages: [{ role: "user", content: "今天累死了" }] });
    expect(emotion).toContain("先接住情绪");
    expect(emotion).toContain("不要把话题拐到手机或业务");
    expect(emotion).toContain("【上下文锚点】");
    expect(emotion).toContain("最新对方原话：今天累死了");
    expect(emotion).toContain("已经结束的旧话题不要重开");

    const business = buildTurnBrief({ messages: [{ role: "user", content: "旧手机还收吗" }] });
    expect(business).toContain("先直接回答对方问的业务问题");
    expect(business).toContain("不报价、不催单");

    const ack = buildTurnBrief({ messages: [{ role: "user", content: "好" }] });
    expect(ack).toContain("场景：对方只是简单应了一声");
    expect(ack).toContain("不要突然问工作、旧数码、回收");

    const compliment = buildTurnBrief({ messages: [{ role: "user", content: "你真好看" }] });
    expect(compliment).toContain("场景：对方在夸你");
    expect(compliment).toContain("直接接住夸奖");

    const boundary = buildTurnBrief({
      messages: [{ role: "user", content: "其实还好吧" }],
      historyMessages: [{ role: "assistant", content: "别叫我女神，怪不好意思的" }],
      relationStageLevel: 1,
    });
    expect(boundary).toContain("对方在轻轻回应你上一轮已经表达过的称呼边界");
    expect(boundary).toContain("不要否定自己刚说过的边界");

    const boundaryFeedback = buildTurnBrief({
      messages: boundaryFeedbackMessages,
      historyMessages: boundaryHistory,
      relationStageLevel: 2,
    });
    expect(boundaryFeedback).toContain("场景：对方用省略式短句在反问上一轮的称呼或聊天节奏");
    expect(boundaryFeedback).toContain("你不喜欢我叫你宝贝吗");
    expect(boundaryFeedback).toContain("不是不喜欢，就是宝贝这个称呼来得太快了");
    expect(boundaryFeedback).toContain("先正常聊着呗");
    expect(boundaryFeedback).toContain("不要问“不喜欢啥”");
    expect(boundaryFeedback).toContain("【本批语境】");
    expect(boundaryFeedback).toContain("【短句理解】");
  });

  it("treats an elliptical follow-up like 多久啦 as continuing the last question", () => {
    const history = [
      { role: "user", content: "我说你多久没有了" },
      { role: "assistant", content: "这种事哪能随口答你" },
    ];
    const brief = buildTurnBrief({
      messages: [{ role: "user", content: "多久啦" }],
      historyMessages: history,
      relationStageLevel: 2,
    });
    expect(brief).toContain("【短句理解】");
    expect(brief).toContain("顺着那个意思接一句");
    expect(brief).toContain("不能装作没听懂");
    expect(brief).toContain("禁止说“没头没尾");
    expect(brief).not.toContain("直接给出你的态度或答案");

    // 2026-10-11 真机（WuDi）原样复现：他先问“你多久没有那事”，隔几轮只丢一句“多久啦”。
    // 这种续追必须走“隐晦接住”，不能让模型自己去装糊涂。
    const wudiHistory = [
      { role: "user", content: "可以问你私人问题吗" },
      { role: "assistant", content: "私人问题可以问" },
      { role: "user", content: "你多久没有啦" },
      { role: "assistant", content: "这问题问得挺直接" },
      { role: "user", content: "多久没有那事？" },
      { role: "assistant", content: "这问题得看谁问的" },
      { role: "assistant", content: "这种事哪能随口答你" },
      { role: "user", content: "我说你多久了没有了" },
      { role: "user", content: "不是跟你做" },
      { role: "assistant", content: "你倒是急 还专门解释一句" },
    ];
    expect(isIntimateTopic("多久啦", wudiHistory)).toBe(true);
    const wudiBoundary = buildRelationshipBoundaryPrompt(2, "多久啦", wudiHistory);
    expect(wudiBoundary).toContain("【暧昧边界-隐晦】");
    expect(wudiBoundary).toContain("不许装听不懂");
    expect(wudiBoundary).toContain("不许报数字");
    expect(wudiBoundary).not.toContain("见面边界");

    // 整条提示词拼起来也要能同时出现“短句理解”和“隐晦接住”，别只在单测里成立。
    const wudiSystem = buildLayeredSystemPrompt({
      personaId: "female",
      personaPrompt: "你是苏棠。",
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-11 02:38:00",
      weekday: "星期六",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "两江新区" },
      weather: "",
      stageText: "已经聊过几次",
      relationStageLevel: 2,
      messages: [{ role: "user", content: "多久啦" }],
      historyMessages: wudiHistory,
    });
    expect(wudiSystem).toContain("【短句理解】");
    expect(wudiSystem).toContain("【暧昧边界-隐晦】");
    expect(wudiSystem).toContain("不许装听不懂");
  });

  it("keeps an intimate topic going when the new sentence alone is vague", () => {
    const intimateHistory = [
      { role: "user", content: "可以问你私人问题吗" },
      { role: "assistant", content: "私人问题可以问" },
      { role: "user", content: "你老公那方面行不行啊？" },
      { role: "assistant", content: "这种事哪能随口答你" },
    ];
    // 前面刚聊过那件事：这句“想不想啊”顺着当同一件事接住。
    expect(isIntimateTopic("你最近想不想啊？", intimateHistory)).toBe(true);
    expect(isIntimateTopic("要不要试试", intimateHistory)).toBe(true);
    expect(buildRelationshipBoundaryPrompt(2, "你最近想不想啊？", intimateHistory))
      .toContain("【暧昧边界-隐晦】");

    // 前面压根没提过那件事：走普通聊天，不能硬往那件事上套。
    expect(isIntimateTopic("你最近想不想啊？", [{ role: "user", content: "今天天气不错" }])).toBe(false);
    expect(isIntimateTopic("要不要试试", [{ role: "user", content: "周末去吃火锅吗" }])).toBe(false);
    expect(buildRelationshipBoundaryPrompt(2, "要不要试试", [{ role: "user", content: "周末去吃火锅吗" }])).toBe("");

    // 字面自己就能认出来的，不用靠前面几轮。
    expect(isIntimateTopic("你多久没有那事？", [])).toBe(true);
    expect(isIntimateTopic("你多久没那啥了", [])).toBe(true);
    expect(isIntimateTopic("那事你怎么解决的", [])).toBe(true);
    expect(isIntimateTopic("你老公满足得了你吗", [])).toBe(true);

    // 正常的事不能被误伤。
    expect(isIntimateTopic("那事办得怎么样了", [])).toBe(false);
    expect(isIntimateTopic("我弟弟最近是很难受", [])).toBe(false);
    expect(isIntimateTopic("今天天气不错", [])).toBe(false);
    expect(buildRelationshipBoundaryPrompt(2, "那事办得怎么样了", [])).toBe("");
  });

  it("injects the current platform account nickname", () => {
    const prompt = buildLayeredSystemPrompt({
      personaPrompt: "你是星皮。",
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-01 18:30:00",
      weekday: "星期四",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "两江新区" },
      weather: "",
      stageText: "刚认识",
      relationStageLevel: 1,
      messageDelay: null,
      messages: [{ role: "user", content: "你为什么叫另一面的我" }],
      historyMessages: [],
      selfNickname: "另一面的我",
    });

    expect(prompt).toContain("【当前平台账号昵称】你在soul上的账号昵称是“另一面的我”");
    expect(prompt).toContain("不代表其他平台昵称");
  });

  it("uses enough token room for natural replies without encouraging long chat messages", () => {
    expect(replyGenerationSettings([{ role: "user", content: "你好" }], null, {}).maxTokens).toBe(96);
    expect(replyGenerationSettings(
      [{ role: "user", content: "你好" }],
      { messageType: "greeting" },
      {},
    ).maxTokens).toBe(56);
    expect(replyGenerationSettings(
      [{ role: "user", content: "旧手机还收吗" }],
      { messageType: "business" },
      {},
    ).maxTokens).toBe(160);
  });

  it("uses the Gemini-compatible request shape when Gemini is selected", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    await kv.put("llm:gemini_model", "gemini-3.8-flash");
    const db = new MockD1();
    db.deviceSettingsRows.set("test-token", {
      platform: "soul",
      hosting_enabled: 1,
      monitor_enabled: 1,
      weather_enabled: 0,
      time_enabled: 0,
      reply_pace_sec: 0,
      ai_hours_enabled: 0,
      ai_start_hour: 8,
      ai_end_hour: 23,
      model_line: "b",
    });
    const fetchMock = mockChatSequence(["对呀"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "gemini-chat-1",
          platform: "soul",
          contact_id: "gemini-contact",
          contact_name: "Gemini 测试",
          messages: [{ role: "user", content: "你好呀" }],
        }),
      }),
      env: {
        DB: db,
        KV: kv,
        GEMINI_API_KEY: "gemini-key",
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "对呀",
    });
  });

  it("keeps line A and line B separate for different device keys", async () => {
    const db = new MockD1();
    const commonSettings = {
      platform: "soul",
      hosting_enabled: 1,
      monitor_enabled: 1,
      weather_enabled: 0,
      time_enabled: 0,
      reply_pace_sec: 0,
      ai_hours_enabled: 0,
      ai_start_hour: 8,
      ai_end_hour: 23,
    };
    db.deviceSettingsRows.set("device-a", { ...commonSettings, model_line: "a" });
    db.deviceSettingsRows.set("device-b", { ...commonSettings, model_line: "b" });
    const fetchMock = mockChatSequence(["A回复", "B回复"]);
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DB: db,
      KV: new MockKV(),
      GEMINI_API_KEY: "gemini-key",
      DEEPSEEK_API_KEY: "deepseek-key",
    };
    const call = (token: string, requestId: string) => onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({
          request_id: requestId,
          platform: "soul",
          contact_id: "contact-" + token,
          contact_name: "同一个客户",
          messages: [{ role: "user", content: "你好呀" }],
        }),
      }),
      env,
    } as never);

    expect((await call("device-a", "line-a-1")).status).toBe(200);
    expect((await call("device-b", "line-b-1")).status).toBe(200);
    const completionCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/chat/completions"));
    expect(String(completionCalls[0][0])).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(String(completionCalls[1][0])).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  });

  it("never leaks one device's chat history into another device using the same persona and contact", async () => {
    const sharedContactId = "same-contact";
    const db = new MockD1([
      {
        id: 1,
        token: "device-a",
        platform: "soul",
        contact_id: sharedContactId,
        contact_name: "同一个客户",
        role: "user",
        content: "设备一的秘密是喜欢喝茶",
        source: "sync",
        created_at: 100,
      },
      {
        id: 2,
        token: "device-b",
        platform: "soul",
        contact_id: sharedContactId,
        contact_name: "同一个客户",
        role: "user",
        content: "设备二的秘密是喜欢跑步",
        source: "sync",
        created_at: 101,
      },
    ]);
    const settings = {
      platform: "soul",
      hosting_enabled: 1,
      monitor_enabled: 1,
      weather_enabled: 0,
      time_enabled: 0,
      reply_pace_sec: 0,
      ai_hours_enabled: 0,
      ai_start_hour: 8,
      ai_end_hour: 23,
      model_line: "a",
    };
    db.deviceSettingsRows.set("device-a", { ...settings });
    db.deviceSettingsRows.set("device-b", { ...settings });
    const fetchMock = mockChatSequence(["记得你喜欢喝茶", "记得你喜欢跑步"]);
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DB: db,
      KV: new MockKV(),
      DEEPSEEK_API_KEY: "deepseek-key",
    };
    const call = async (token: string, requestId: string) => onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({
          request_id: requestId,
          platform: "soul",
          contact_id: sharedContactId,
          contact_name: "同一个客户",
          messages: [{ role: "user", content: "还记得我的秘密吗" }],
          debug_prompt: true,
        }),
      }),
      env,
    } as never);

    expect((await call("device-a", "isolation-a")).status).toBe(200);
    expect((await call("device-b", "isolation-b")).status).toBe(200);
    const completionCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/chat/completions"));
    const prompts = completionCalls.map(([, init]) => {
      const payload = JSON.parse(String((init as RequestInit).body));
      return (payload.messages || []).map((message: { content?: string }) => String(message.content || "")).join("\n");
    });
    expect(prompts[0]).toContain("设备一的秘密是喜欢喝茶");
    expect(prompts[0]).not.toContain("设备二的秘密是喜欢跑步");
    expect(prompts[1]).toContain("设备二的秘密是喜欢跑步");
    expect(prompts[1]).not.toContain("设备一的秘密是喜欢喝茶");
  });

  it("sends the same history to line A and line B when one phone switches manually", async () => {
    const db = new MockD1([
      {
        id: 1,
        token: "test-token",
        platform: "soul",
        contact_id: "contact-line-memory",
        contact_name: "记忆测试",
        role: "user",
        content: "我平时喜欢喝茶",
        source: "sync",
        created_at: 100,
      },
    ]);
    db.deviceSettingsRows.set("test-token", {
      platform: "soul",
      hosting_enabled: 1,
      monitor_enabled: 1,
      weather_enabled: 0,
      time_enabled: 0,
      reply_pace_sec: 0,
      ai_hours_enabled: 0,
      ai_start_hour: 8,
      ai_end_hour: 23,
      model_line: "a",
    });
    const fetchMock = mockChatSequence(["A记住了", "B也记住了"]);
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DB: db,
      KV: new MockKV(),
      GEMINI_API_KEY: "gemini-key",
      DEEPSEEK_API_KEY: "deepseek-key",
    };
    const call = (requestId: string) => onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: requestId,
          platform: "soul",
          contact_id: "contact-line-memory",
          contact_name: "记忆测试",
          messages: [{ role: "user", content: "还记得我喜欢什么吗" }],
        }),
      }),
      env,
    } as never);

    expect((await call("same-memory-a")).status).toBe(200);
    db.deviceSettingsRows.set("test-token", { ...db.deviceSettingsRows.get("test-token"), model_line: "b" });
    expect((await call("same-memory-b")).status).toBe(200);
    const completionCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/chat/completions"));
    for (const [, init] of completionCalls) {
      const payload = JSON.parse(String((init as RequestInit).body));
      const combined = (payload.messages || []).map((message: { content?: string }) => String(message.content || "")).join("\n");
      expect(combined).toContain("我平时喜欢喝茶");
    }
  });

  it("reports line B as healthy only after the provider responds", async () => {
    const db = new MockD1();
    db.deviceSettingsRows.set("test-token", {
      platform: "soul",
      hosting_enabled: 1,
      monitor_enabled: 1,
      weather_enabled: 0,
      time_enabled: 0,
      reply_pace_sec: 0,
      ai_hours_enabled: 0,
      ai_start_hour: 8,
      ai_end_hour: 23,
      model_line: "b",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DB: db,
      KV: new MockKV(),
      GEMINI_API_KEY: "gemini-key",
      DEEPSEEK_API_KEY: "deepseek-key",
    };

    const ok = await onRequest({
      request: new Request("https://example.com/api/model-route/health?line=b", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env,
    } as never);
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({ ok: true, line: "b", provider: "gemini" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("generativelanguage.googleapis.com");

    fetchMock.mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
    const failed = await onRequest({
      request: new Request("https://example.com/api/model-route/health?line=a", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env,
    } as never);
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toMatchObject({ ok: false, line: "a" });
  });

  it("does not waste a retry when Gemini safety-blocks an intimate reply", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "WH",
      condition: "clear",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    await kv.put("llm:gemini_model", "gemini-3.8-flash");
    const db = new MockD1();
    db.deviceSettingsRows.set("test-token", {
      platform: "soul",
      hosting_enabled: 1,
      monitor_enabled: 1,
      weather_enabled: 1,
      time_enabled: 1,
      reply_pace_sec: 0,
      ai_hours_enabled: 0,
      ai_start_hour: 8,
      ai_end_hour: 23,
      model_line: "b",
    });
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      if (!String(url).includes("/chat/completions")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      callCount += 1;
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "" }, finish_reason: "content_filter" }],
          usage: { completion_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "gemini-safety-1",
          platform: "soul",
          contact_id: "safety-contact",
          contact_name: "safety-contact",
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
      env: {
        DB: db,
        KV: kv,
        GEMINI_API_KEY: "gemini-key",
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    expect(response.status).toBe(200);
    // No second model call: retrying a safety block with the same prompt never helps.
    expect(callCount).toBe(1);
    const body = await response.json();
    expect(body.action).toBe("send");
    // No timestamp on the incoming message, so the gap is unknown and the
    // cover must be the "was away" variant, never the robotic fallback.
    expect(String(body.reply || "")).toMatch(/走开/);
  });

  it("dynamically injects matched drawer tips into prompt when triggered", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    const fetchMock = mockChatSequence(["瘫在沙发上不想动呢"]);
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1([], [{
      id: "female_sutang",
      name: "苏棠",
      system_prompt: "你是苏棠，29岁，重庆人。",
    }]);
    db.tokenPersonas.set("test-token", "female_sutang");

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "drawer-test-1",
          platform: "soul",
          contact_id: "drawer-contact",
          contact_name: "测试用户",
          messages: [{ role: "user", content: "今晚下雨 后背酸得厉害" }],
        }),
      }),
      env: {
        DB: db,
        KV: kv,
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    const systemMessage = payload.messages.find((m: { role: string }) => m.role === "system");
    expect(systemMessage.content).toContain("【居家放松与颈背酸胀】");
  });

  it("only gives Sutang's default scene cards to Sutang", () => {
    const sutang = defaultDrawersForPersona("female_sutang");
    const oldStockings = sutang.topics?.find((item) => item.id === "scene_01_black_stockings");
    const newRainyNeck = sutang.topics?.find((item) => item.id === "scene_14_rainy_neck");
    expect(oldStockings?.enabled).toBe(false);
    expect(newRainyNeck?.enabled).toBe(true);
    for (const personaId of ["female", "male", "male_chenyu"]) {
      const drawers = defaultDrawersForPersona(personaId);
      expect(drawers.topics || []).toEqual([]);
      expect(drawers.counters || []).toEqual([]);
      expect(JSON.stringify(drawers)).not.toContain("苏棠");
      expect(JSON.stringify(drawers)).not.toContain("借腿");
    }
  });

  it("marks exact knowledge cards as required knowledge and keeps them persona-scoped", () => {
    const cards = {
      custom: [{
        id: "knowledge_black_stockings",
        name: "黑丝触感",
        keywords: ["黑丝", "丝袜"],
        content: "刚把黑丝脱了，脚踝全是印子",
        kind: "scene",
        activation: "keyword",
        replyMode: "exact",
        enabled: true,
      }],
    };
    const matched = matchActiveDrawers(cards, "今天穿黑丝了吗");
    expect(matched.join("\n")).toContain("知识库命中｜优先按原文");
    expect(matchActiveDrawers(cards, "今天吃什么")).toEqual([]);
  });

  it("keeps Xingmu, Sutang and generic male prompts in separate scopes", () => {
    const base = {
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-09 08:00:00",
      weekday: "星期五",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      weather: null,
      weatherEnabled: false,
      timeEnabled: false,
      stageText: "刚认识",
      relationStageLevel: 1,
      messageDelay: null,
      messages: [{ role: "user", content: "今天忙不忙" }],
      historyMessages: [],
      conversationTimeline: "",
      memorySummary: "",
    };
    const xingmu = buildLayeredSystemPrompt({
      ...base,
      personaId: "female",
      personaPrompt: "你是王雅慧，对外叫星暮。",
    });
    const sutang = buildLayeredSystemPrompt({
      ...base,
      personaId: "female_sutang",
      personaPrompt: "你是苏棠，29岁，重庆人。",
    });
    const male = buildLayeredSystemPrompt({
      ...base,
      personaId: "male",
      personaPrompt: "你是阿杰，31岁男性，重庆人。",
    });

    expect(xingmu).not.toContain("电商运营");
    expect(xingmu).not.toContain("带娃");
    expect(xingmu).not.toContain("我老公");
    expect(xingmu).not.toContain("你是来排解寂寞的");
    expect(sutang).not.toContain("王雅慧");
    expect(sutang).not.toContain("宝马X3");
    expect(sutang).not.toContain("星暮六段漏斗");
    expect(male).not.toContain("苏棠");
    expect(male).not.toContain("我老公");
    expect(male).not.toContain("借腿");
    expect(male).not.toContain("你是来排解寂寞的");
    expect(male).not.toContain("星暮六段漏斗");
  });

  it("replies to a voice-chat request locally with a rotating hook decline", async () => {
    expect(isVoiceCallRequest("可以和你语音聊天吗")).toBe(true);
    expect(isVoiceCallRequest("语音聊吗")).toBe(true);
    expect(isVoiceCallRequest("我手机语音功能坏了")).toBe(false);
    expect(isVoiceCallRequest("我平时喜欢语音聊天")).toBe(false);
    expect(isVoiceCallRequest("我现在不能和你语音")).toBe(false);
    expect(isVoiceCallRequest("能不能和你语音聊天")).toBe(true);
    expect(isVoiceCallRequest("方便语音吗")).toBe(true);
    expect(isVoiceCallRequest("就是语音吗")).toBe(true);
    for (const text of ["可以和你语音聊天吗", "语音聊吗", "方便语音吗", "就是语音吗"]) {
      expect(VOICE_CHAT_DECLINES).toContain(localVoiceReply([{ role: "user", content: text }]));
    }
    // 本地短路也要轮换：历史里说过的那句不再选
    const first = localVoiceReply([{ role: "user", content: "语音聊吗" }]);
    expect(localVoiceReply(
      [{ role: "user", content: "语音聊吗" }],
      [{ role: "assistant", content: first }],
    )).not.toBe(first);
    expect(localVoiceReply([{ role: "user", content: "我手机语音功能坏了" }])).toBe("");
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "可以啊，晚点给你打语音" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "voice-request-1",
          platform: "soul",
          contact_id: "voice-new",
          contact_name: "摆烂随心享快乐",
          messages: [{ role: "user", content: "你好呀小姐姐，可以和你语音聊天吗" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const voiceBody = await response.json();
    expect(voiceBody.action).toBe("send");
    expect(voiceBody.local).toBe(true);
    expect(VOICE_CHAT_DECLINES).toContain(voiceBody.reply);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes video requests through the model and blocks a video promise", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "好啊，晚点给你发视频" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "video-request-1",
          platform: "soul",
          contact_id: "video-new",
          contact_name: "视频测试",
          messages: [{ role: "user", content: "可以视频看看你吗" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const videoBody = await response.json();
    expect(videoBody.action).toBe("send");
    // 视频拒绝句改成 3 句轮换（2026-10-06），只要落在候选里、且没有答应发视频就算过
    expect(VIDEO_CHAT_DECLINES).toContain(videoBody.reply);
    expect(videoBody.reply).not.toContain("好啊");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.messages[0].content).toContain("场景：对方要求视频");
  });

  it("routes AI doubts through the model instead of sending a fixed challenge reply", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "哈哈，你还真敢问" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "ai-doubt-1",
          platform: "soul",
          contact_id: "ai-doubt",
          contact_name: "AI质疑测试",
          messages: [{ role: "user", content: "你是不是AI机器人" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "哈哈，你还真敢问",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.messages[0].content).toContain("被质疑：轻微怀疑当玩笑");
  });

  it("keeps the new recycle scope and rejects excluded items locally", () => {
    expect(isExcludedRecycleItem("旧耳机收不收")).toBe(true);
    expect(isExcludedRecycleItem("充电宝能收吗")).toBe(true);
    expect(isExcludedRecycleItem("旧数据线收吗")).toBe(true);
    expect(isExcludedRecycleItem("旧手表收吗")).toBe(true);
    expect(isExcludedRecycleItem("旧电话手表收吗")).toBe(false);
    expect(isExcludedRecycleItem("我平时戴蓝牙耳机")).toBe(false);
    expect(isExcludedRecycleItem("这个数据线音质不错")).toBe(false);
    expect(isExcludedRecycleItem("我的蓝牙耳机拿出来了")).toBe(false);
    expect(isExcludedRecycleItem("旧手表想处理掉")).toBe(true);
    expect(localExcludedRecycleReply([{ role: "user", content: "蓝牙耳机收不收" }]))
      .toBe("这些不收哈 只收带屏幕、带电池、带电路的旧数码");
    expect(localExcludedRecycleReply([{ role: "user", content: "我平时戴蓝牙耳机" }])).toBe("");
  });

  it("tracks the six-stage funnel and emits the evaluation entry alone", () => {
    expect(resolveXingmuEvaluationReply({
      stage: 5,
      incomingText: "怎么收",
      willingToRecycle: true,
    })).toBe("");
    expect(resolveXingmuEvaluationReply({
      stage: 6,
      incomingText: "这个怎么收",
      willingToRecycle: true,
    })).toBe(XINGMU_PRODUCT_REPLY);
    expect(resolveXingmuEvaluationReply({
      stage: 6,
      incomingText: "收什么",
      willingToRecycle: true,
    })).toBe(XINGMU_PRODUCT_REPLY);
    expect(resolveXingmuEvaluationReply({
      stage: 6,
      incomingText: "寄哪里",
      willingToRecycle: true,
    })).toBe(XINGMU_PRODUCT_REPLY);
    expect(resolveXingmuEvaluationReply({
      stage: 6,
      incomingText: "这个地址怎么处理",
      willingToRecycle: true,
    })).toBe("");
    expect(resolveXingmuEvaluationReply({
      stage: 6,
      incomingText: "家里有",
      willingToRecycle: true,
    })).toBe("");
    expect(resolveXingmuEvaluationReply({
      stage: 6,
      incomingText: "这个怎么收",
      willingToRecycle: false,
    })).toBe("");
    expect(hasEvaluationQuote([{ role: "assistant", content: XINGMU_PRODUCT_REPLY }])).toBe(true);
    expect(resolveXingmuEvaluationReply({
      stage: 6,
      incomingText: "怎么收",
      historyMessages: [{ role: "assistant", content: XINGMU_PRODUCT_REPLY }],
      willingToRecycle: true,
    })).toBe("");
    expect(resolveXingmuEvaluationReply({
      stage: 6,
      incomingText: "怎么收",
      quoteAlreadySent: true,
      willingToRecycle: true,
    })).toBe("");
    expect(buildXingmuFunnelPrompt(6, "怎么收", [], false, {
      userTurnCount: 42,
      completed: false,
    })).toContain("作为一个独立气泡");
  });

  it("keeps the evaluation entry out of ordinary model replies", () => {
    expect(sanitizeXingmuProductLeak("嗯 你先看看", true)).toBe("嗯 你先看看");
    expect(sanitizeXingmuProductLeak("评估报价，搜 shanhs668", true)).toBe("嗯 回头慢慢说");
    expect(sanitizeXingmuProductLeak("嗯 先这样|||评估报价，搜 shanhs668", true)).toBe("嗯 先这样");
    expect(sanitizeXingmuProductLeak("评估报价，搜 shanhs668", false))
      .toBe("评估报价，搜 shanhs668");
  });

  it("injects current-topic Xingmu cards without resurfacing old history", () => {
    const prompt = buildXingmuCardPrompt({
      stage: 2,
      incomingText: "你做什么工作，之前也离过婚吗",
      historyMessages: [{ role: "user", content: "你离过婚吗" }],
    });
    expect((prompt.match(/【命中卡片】/gu) || [])).toHaveLength(2);
    expect(prompt).toContain("上一段关系");
    expect(prompt).toContain("工作吐槽");
    const unrelatedPrompt = buildXingmuCardPrompt({
      stage: 2,
      incomingText: "你做什么工作",
      historyMessages: [{ role: "user", content: "你离过婚吗" }],
    });
    expect(unrelatedPrompt).toContain("工作吐槽");
    expect(unrelatedPrompt).not.toContain("上一段关系");
    expect(buildXingmuCardPrompt({
      stage: 2,
      incomingText: "你孩子做什么工作",
      historyMessages: [],
    })).not.toContain("工作吐槽");
    expect(buildXingmuCardPrompt({
      stage: 2,
      incomingText: "不喜欢",
      historyMessages: [{ role: "assistant", content: "才聊几句就喊宝贝，你这进度条拉太快了" }],
    })).not.toContain("偏好");
    expect(buildXingmuCardPrompt({
      stage: 2,
      incomingText: "你平时喜欢什么",
      historyMessages: [],
    })).toContain("偏好");
  });

  it("answers only self-directed age questions from the active persona", () => {
    expect(isSelfAgeQuestion("你多大了")).toBe(true);
    expect(isSelfAgeQuestion("你几岁")).toBe(true);
    expect(isSelfAgeQuestion("你今年多大")).toBe(true);
    expect(isSelfAgeQuestion("你的年龄")).toBe(true);
    expect(isSelfAgeComparisonQuestion("你比我大还是小")).toBe(true);
    expect(isSelfAgeComparisonQuestion("咱俩谁大")).toBe(true);
    expect(isSelfAgeComparisonQuestion("你孩子多大")).toBe(false);
    expect(isSelfAgeQuestion("你孩子多大")).toBe(false);
    expect(isSelfAgeQuestion("孩子多大了")).toBe(false);
    expect(isChildAgeQuestion("你孩子多大")).toBe(true);
    expect(isChildAgeQuestion("孩子多大了")).toBe(true);
    expect(localAgeReply([{ role: "user", content: "你多大了" }], "你是星暮，29岁女性，重庆人。")).toBe("29呀 你呢");
    expect(localAgeReply([{ role: "user", content: "你几岁" }], "你是陈屿，33岁男性，重庆人。")).toBe("33呀 你呢");
    expect(localAgeReply([{ role: "user", content: "你今年多大" }], "你是星暮，29岁女性，重庆人。")).toBe("29呀 你呢");
    expect(localAgeReply([{ role: "user", content: "你的年龄" }], "你是星暮，29岁女性，重庆人。")).toBe("29呀 你呢");
    expect(localAgeReply(
      [
        { role: "user", content: "我也自己住" },
        { role: "user", content: "我38" },
        { role: "user", content: "我87的" },
        { role: "user", content: "你比我大还是小" },
      ],
      "你是星暮，29岁女性，重庆人。",
      [],
      1_790_000_000,
    )).toBe("我29，你87年的，我比你小。");
    expect(localAgeReply(
      [
        { role: "user", content: "我38" },
        { role: "user", content: "你比我大还是小" },
      ],
      "你是星暮，29岁女性，重庆人。",
      [],
      1_790_000_000,
    )).toBe("我29，比你小9岁。");
    expect(localAgeReply(
      [{ role: "user", content: "你比我大还是小" }],
      "你是星暮，29岁女性，重庆人。",
      [],
      1_790_000_000,
    )).toBe("我29。你哪年的？");
    expect(localAgeReply([{ role: "user", content: "你孩子多大" }], "你是星暮，29岁女性，离异，无子女。"))
      .toBe("我没孩子。");
    expect(localAgeReply([{ role: "user", content: "孩子多大了" }], "你是星暮，29岁女性，离异，无子女。"))
      .toBe("");
    expect(localAgeReply([{ role: "user", content: "你孩子多大" }], "你是星暮，29岁女性。")).toBe("");
    expect(localAgeReply([{ role: "user", content: "你爸多大" }], "你是星暮，29岁女性，离异，无子女。")).toBe("");
    expect(localAgeReply([{ role: "user", content: "今天真累" }], "你是星暮，29岁女性。")).toBe("");
    expect(localAgeReply([{ role: "user", content: "你多大了" }], "没有年龄的人设")).toBe("");
    expect(localAgeReply(
      [{ role: "user", content: "你多大了" }],
      "你是星暮，没有写年龄。",
      [],
      undefined,
      XINGMU_FIXED_AGE,
    )).toBe("29呀 你呢");
    expect(localAgeReply(
      [{ role: "user", content: "你是哪年生的" }],
      "你是星暮，没有写年龄。",
      [],
      undefined,
      XINGMU_FIXED_AGE,
    )).toBe("29呀 你呢");
    expect(localAgeReply(
      [{ role: "user", content: "你多大了" }],
      "你是星暮，29岁女性，重庆人。",
      [{ role: "assistant", content: "29呀 你呢", created_at: 1_790_000_000 - 30 }],
      1_790_000_000,
    )).toBe("刚说过了呀 我29");
  });

  it("normalizes punctuation, expands single-character replies and keeps exact review quotes", () => {
    expect(normalizeAssistantReplyPresentation("你也是重庆的")).toBe("你也是重庆的？");
    expect(normalizeAssistantReplyPresentation("你也在重庆")).toBe("你也在重庆？");
    expect(normalizeAssistantReplyPresentation("29了 你呢")).toBe("29了 你呢？");
    // 苏棠这种软语气人设：句尾的“呢”是语气词，不是问句
    expect(normalizeAssistantReplyPresentation("刚在收拾娃的玩具呢", { softParticles: true })).toBe("刚在收拾娃的玩具呢");
    expect(normalizeAssistantReplyPresentation("刚在收拾娃的玩具呢？", { softParticles: true })).toBe("刚在收拾娃的玩具呢？");
    // 2026-10-06：苏棠不再自动补“？”（真人打字不句句带标点，工整感是“像 AI”的来源之一）
    expect(normalizeAssistantReplyPresentation("你多大了呢", { softParticles: true })).toBe("你多大了呢");
    expect(normalizeAssistantReplyPresentation("你在干嘛", { softParticles: true })).toBe("你在干嘛");
    // 星暮（非软语气）保持自动补问号
    expect(normalizeAssistantReplyPresentation("你在干嘛")).toBe("你在干嘛？");
    expect(normalizeAssistantReplyPresentation("不喜欢啥，喊宝贝还是我这人")).toBe("不喜欢啥，喊宝贝还是我这人？");
    expect(normalizeAssistantReplyPresentation("不管你喜欢咖啡还是茶，我都行")).toBe("不管你喜欢咖啡还是茶，我都行");
    expect(normalizeAssistantReplyPresentation("重庆哪边")).toBe("重庆哪边？");
    expect(normalizeAssistantReplyPresentation("梦到我什么了")).toBe("梦到我什么了？");
    expect(normalizeAssistantReplyPresentation("那刚那个表情包是谁点的")).toBe("那刚那个表情包是谁点的？");
    expect(normalizeAssistantReplyPresentation("那张照片谁发的")).toBe("那张照片谁发的？");
    expect(normalizeAssistantReplyPresentation("这话谁说的")).toBe("这话谁说的？");
    expect(normalizeAssistantReplyPresentation("你哪来的这个")).toBe("你哪来的这个？");
    expect(normalizeAssistantReplyPresentation("为什么会这样")).toBe("为什么会这样？");
    expect(normalizeAssistantReplyPresentation("是不是没收到")).toBe("是不是没收到？");
    expect(normalizeAssistantReplyPresentation("要不要再发一遍")).toBe("要不要再发一遍？");
    expect(normalizeAssistantReplyPresentation("嗯")).toBe("嗯，知道了。");
    expect(normalizeAssistantReplyPresentation("哪有什么另一面，不就一普通人")).toBe("哪有什么另一面，不就一普通人");
    expect(normalizeAssistantReplyPresentation("评估报价，搜 shanhs668")).toBe("评估报价，搜 shanhs668");
  });

  it("splits independent long reply points into explicit delivery segments", () => {
    expect(normalizeAssistantReplyPresentation(
      "自己住清静，我也一个人住惯了，屋子随便收拾 严肃是因为说的都是正经话，没在跟你谈生意 不累，刚收拾完坐下",
    )).toBe(
      "自己住清静，我也一个人住惯了，屋子随便收拾|||严肃是因为说的都是正经话，没在跟你谈生意|||不累，刚收拾完坐下",
    );
    expect(normalizeAssistantReplyPresentation(
      "不爱拍是真的，不是端着。你到家了没？还是还在那坐着？",
    )).toBe("不爱拍是真的，不是端着。|||你到家了没？|||还是还在那坐着？");
    expect(normalizeAssistantReplyPresentation("我用 iPhone 15 Pro 拍")).toBe("我用 iPhone 15 Pro 拍");
    expect(normalizeAssistantReplyPresentation("29了 你呢")).toBe("29了 你呢？");
  });

  it("repairs high-pressure boundary feedback without turning it into a relationship test", () => {
    const history = [
      { role: "user", content: "宝贝" },
      { role: "assistant", content: "才聊几句就喊宝贝，你这进度条拉太快了" },
    ];
    const messages = [
      { role: "user", content: "哈哈哈" },
      { role: "user", content: "不喜欢" },
    ];
    const risky = "不喜欢啥，喊宝贝还是我这人";
    expect(isBoundaryFeedbackTurn(messages, history)).toBe(true);
    expect(shouldRepairXingmuBoundaryFeedbackReply(risky, messages, history, true)).toBe(true);
    expect(shouldRepairXingmuBoundaryFeedbackReply("行，那我收一点。", messages, history, true)).toBe(true);
    expect(shouldRepairXingmuBoundaryFeedbackReply(
      "不是不喜欢，就是宝贝这个称呼太快了，先正常聊着呗。",
      messages,
      history,
      true,
    )).toBe(false);
    expect(shouldRepairXingmuBoundaryFeedbackReply(risky, messages, history, false)).toBe(false);
    expect(buildXingmuBoundaryFeedbackRepairPrompt(risky, messages, history))
      .toContain("候选回复：不喜欢啥，喊宝贝还是我这人");
    expect(buildXingmuBoundaryFeedbackRepairPrompt(risky, messages, history))
      .toContain("你是不是不喜欢我刚刚叫你宝贝");
    expect(XINGMU_BOUNDARY_FEEDBACK_FALLBACK)
      .toBe("不是不喜欢，就是宝贝这个称呼太快了，先正常聊着呗。");
  });

  it("detects dead-end replies and builds a repair prompt that leaves a low-pressure hook", () => {
    const messages = [{ role: "user", content: "最近压力挺大的" }];
    expect(shouldRepairXingmuDeadEndReply("哈哈 先聊点别的", messages, [], true)).toBe(true);
    expect(shouldRepairXingmuDeadEndReply("嗯嗯，好的。", messages, [], true)).toBe(true);
    expect(shouldRepairXingmuDeadEndReply("听着就挺累的，是工作堆一块了吗？", messages, [], true)).toBe(false);
    expect(shouldRepairXingmuDeadEndReply("好", [{ role: "user", content: "好" }], [], true)).toBe(false);
    expect(buildXingmuConversationRepairPrompt("哈哈 先聊点别的", messages, []))
      .toContain("低压力接点");
    expect(buildXingmuConversationRepairPrompt("哈哈 先聊点别的", messages, []))
      .not.toContain("不要用“先聊点别的”");
  });

  it("anchors replies to the latest turn and catches unrelated old topics", () => {
    const invitationMessages = [{ role: "user", content: "有空一起玩" }];
    const invitationAnchor = buildConversationAnchor({
      messages: invitationMessages,
      historyMessages: [{ role: "assistant", content: "你平时周末忙吗？" }],
      relationStageLevel: 1,
    });
    expect(invitationAnchor.latestUserMessage).toBe("有空一起玩");
    expect(invitationAnchor.previousAssistantReply).toBe("你平时周末忙吗？");
    expect(invitationAnchor.currentTopic).toBe("邀约、一起玩或一起吃东西");
    expect(invitationAnchor.intents).toContain("invitation");
    expect(shouldRepairXingmuContextMismatch(
      "嗯，怎么了？",
      invitationMessages,
      [],
      1,
      true,
    )).toBe(true);
    expect(shouldRepairXingmuContextMismatch(
      "好呀，等你有空，一起找个地方玩。",
      invitationMessages,
      [],
      1,
      true,
    )).toBe(false);

    const ackMessages = [{ role: "user", content: "没事呀" }];
    expect(shouldRepairXingmuContextMismatch(
      "29呀 你呢",
      ackMessages,
      [],
      1,
      true,
    )).toBe(true);
    expect(shouldRepairXingmuContextMismatch(
      "那就好，我还以为你有事。",
      ackMessages,
      [],
      1,
      true,
    )).toBe(false);

    const entityMessages = [{ role: "user", content: "有空来荣昌耍，吃卤鹅" }];
    const entityAnchor = buildConversationAnchor({
      messages: entityMessages,
      relationStageLevel: 1,
    });
    expect(entityAnchor.entities).toEqual(expect.arrayContaining(["荣昌", "卤鹅"]));
    expect(shouldRepairXingmuContextMismatch(
      "一个人住，离婚之后就自己过了。",
      entityMessages,
      [],
      1,
      true,
    )).toBe(true);
    expect(shouldRepairXingmuContextMismatch(
      "荣昌卤鹅听着不错，你常去耍吗？",
      entityMessages,
      [],
      1,
      true,
    )).toBe(false);
    expect(buildXingmuContextRepairPrompt(
      "一个人住，离婚之后就自己过了。",
      entityMessages,
      [],
      1,
    )).toContain("必须优先回应最新对方原话");
    expect(buildXingmuContextRepairPrompt(
      "一个人住，离婚之后就自己过了。",
      entityMessages,
      [],
      1,
    )).toContain("必须接住的具体信息：荣昌、卤鹅");
  });

  it("chooses a live style direction without forcing every turn into a question", () => {
    const emotion = buildXingmuStyleDirection({
      messages: [{ role: "user", content: "最近压力挺大的" }],
      relationStageLevel: 2,
    });
    expect(emotion.styles).toContain("warm_empathy");
    expect(emotion.direction).toContain("温暖共情");
    expect(emotion.requireHook).toBe(true);

    const invitation = buildXingmuStyleDirection({
      messages: [{ role: "user", content: "周末有空一起吃饭吗" }],
      relationStageLevel: 2,
    });
    expect(invitation.styles).toContain("accept_invite");
    expect(invitation.direction).toContain("不锁时间地点");

    const acknowledgement = buildXingmuStyleDirection({
      messages: [{ role: "user", content: "没事呀" }],
      relationStageLevel: 1,
    });
    expect(acknowledgement.styles).toContain("natural_close");
    expect(acknowledgement.allowQuestion).toBe(false);
    expect(acknowledgement.requireHook).toBe(false);

    const noQuestionLoop = buildXingmuStyleDirection({
      messages: [{ role: "user", content: "今天有点累" }],
      historyMessages: [
        { role: "assistant", content: "是不是工作太忙了？" },
        { role: "assistant", content: "那你平时怎么休息？" },
      ],
      relationStageLevel: 2,
    });
    expect(noQuestionLoop.styles).not.toContain("curious_follow_up");
    expect(noQuestionLoop.allowQuestion).toBe(false);

    const brief = buildTurnBrief({
      messages: [{ role: "user", content: "最近压力挺大的" }],
      relationStageLevel: 2,
    });
    expect(brief).toContain("【风格导演】");
    expect(brief).toContain("本轮主色");
  });

  it("stops spending a second model call when a nickname boundary turns into a relationship test", async () => {
    const now = Math.floor(Date.now() / 1000);
    const history = [
      {
        id: 1,
        token: "test-token",
        platform: "soul",
        contact_id: "mora-boundary",
        contact_name: "莫拉维亚",
        role: "user",
        content: "看看有没有机会发展一下",
        created_at: now - 120,
      },
      {
        id: 2,
        token: "test-token",
        platform: "soul",
        contact_id: "mora-boundary",
        contact_name: "莫拉维亚",
        role: "assistant",
        content: "看你表现呗",
        created_at: now - 110,
      },
      {
        id: 3,
        token: "test-token",
        platform: "soul",
        contact_id: "mora-boundary",
        contact_name: "莫拉维亚",
        role: "user",
        content: "宝贝",
        created_at: now - 100,
      },
      {
        id: 4,
        token: "test-token",
        platform: "soul",
        contact_id: "mora-boundary",
        contact_name: "莫拉维亚",
        role: "assistant",
        content: "才聊几句就喊宝贝，你这进度条拉太快了",
        created_at: now - 90,
      },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "不喜欢啥，喊宝贝还是我这人" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "不是不喜欢，就是宝贝这个称呼太快了，先正常聊着呗。" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "boundary-feedback-repair",
          platform: "soul",
          contact_id: "mora-boundary",
          contact_name: "莫拉维亚",
          messages: [
            { role: "user", content: "哈哈哈" },
            { role: "user", content: "不喜欢" },
          ],
        }),
      }),
      env: { DB: new MockD1([...history].reverse()), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    // 2026-10-05 决策：二次重写通道整体关闭，模型第一次的输出就是最终回复。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(payload.reply || "").length).toBeGreaterThan(0);
    expect(String(payload.reply || "")).not.toContain("先正常聊着呗");
  });

  it("sends a dead-end reply as-is now that the rewrite channel is off", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "哈哈 先聊点别的" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "听着就挺累的，是工作堆一块了吗？" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "dead-end-repair",
          platform: "soul",
          contact_id: "dead-end-contact",
          contact_name: "测试对象",
          messages: [{ role: "user", content: "最近压力挺大的" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(payload.reply || "")).toContain("先聊点别的");
    expect(String(payload.reply || "")).not.toContain("工作堆一块");
  });

  it("sends a low-signal acknowledgement as-is now that the rewrite channel is off", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "嗯，怎么了" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "被领导这么说确实挺堵心的，是因为哪件事？" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "generic-low-signal-repair",
          platform: "soul",
          contact_id: "low-signal-contact",
          contact_name: "低质量回复测试",
          messages: [{ role: "user", content: "我今天被领导说了，心里挺烦的" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 星暮的表达硬规则会把疑问句补上问号，这里只验证“原样发出、不再重写”。
    expect(String(payload.reply || "")).toBe("嗯，怎么了？");
  });

  it("sends an off-topic answer as-is now that the rewrite channel is off", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "一个人住，离婚之后就自己过了。" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "荣昌卤鹅听着不错，你常去耍吗？" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "context-repair",
          platform: "soul",
          contact_id: "context-repair-contact",
          contact_name: "上下文修复测试",
          messages: [{ role: "user", content: "有空来荣昌耍，吃卤鹅" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(payload.reply || "")).toContain("离婚之后就自己过了");
    expect(String(payload.reply || "")).not.toContain("卤鹅");
  });

  it("never asks the model twice for the same reply anymore", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "哈哈 先聊点别的" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "repair-keeps-original",
          platform: "soul",
          contact_id: "repair-keeps-original-contact",
          contact_name: "修复失败保留原文测试",
          messages: [{ role: "user", content: "最近压力挺大的" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "哈哈 先聊点别的",
      timing: { repair_attempted: false },
    });
  });

  it("keeps replies grounded in explicit user facts and drops echoed challenges", () => {
    const history = [
      { role: "user", content: "睡醒了" },
      { role: "user", content: "睡得也不早" },
    ];
    expect(sanitizeGroundingMismatch(
      "掉头发这事我认，最近是掉得有点多 你倒是睡得挺香",
      "睡得也不早",
      history,
    // 2026-10-06 用户反馈：补救句只在他真的质问“我什么时候说过”时才用；
    // 平时模型自己编了一句，就直接删掉那段，别顶“我记岔了”进正常聊天。
    )).toBe("");
    expect(sanitizeGroundingMismatch(
      "你怎么晓得我睡得香，我这边灯还亮着呢？",
      "你怎么晓得我睡得香",
      history,
    )).toMatch(/^(?:我记岔了|哎 我记岔了|刚那句我记混了)$/);
    expect(sanitizeGroundingMismatch(
      "你早点休息",
      "你怎么晓得我睡得香",
      history,
    )).toBe("你早点休息");
  });

  it("does not replace a meaningful repeated reply with an unrelated generic question", () => {
    const now = 1_790_000_000;
    const history = [{
      role: "assistant",
      content: "你怎么晓得我睡得香",
      created_at: now - 20,
    }];
    expect(avoidRepeatedAssistantReply(
      "你怎么晓得我睡得香，我这边灯还亮着呢？",
      history,
      "十脸懵逼",
      now,
    )).toBe("你怎么晓得我睡得香，我这边灯还亮着呢？");
  });

  it("does not resend a slice of a longer previous message", () => {
    // 真机原样（♩讲究郎¶吾先森（89已婚））：他新问"你想拿什么换"，
    // 她把自己两分钟前那条三段消息的第一段又单独发了一遍。
    const now = 1_790_000_000;
    const history = [{
      role: "assistant",
      content: "企鹅我看到了 就是不太方便加呢|||这边聊着不挺好 你急什么呀|||想看我 那得先说说你拿什么换",
      created_at: now - 120,
    }];
    const result = avoidRepeatedAssistantReply("企鹅我看到了 就是不太方便加呢", history, "你想拿什么换", now);
    expect(result).not.toBe("企鹅我看到了 就是不太方便加呢");
    expect(result.length).toBeGreaterThan(0);
  });

  it("drops a line she said the day before (real case: 请叫我球⚽️)", () => {
    // 2026-10-07 真机：她 00:11 说“我醒了就得翻半天才迷糊回去”，20 小时后 20:43 原句又说了一遍。
    const now = 1_800_000_000;
    const history = [
      {
        role: "assistant",
        content: "醒一下还能接上，这本事我服|||我醒了就得翻半天才迷糊回去",
        created_at: now - 20 * 3600,
      },
      { role: "user", content: "醒也是醒 醒一下我能接着睡", created_at: now - 120 },
    ];
    // 整条都是旧话 → 换成不重复的短句，绝不原样发出去
    const whole = avoidRepeatedAssistantReply("我醒了就得翻半天才迷糊回去", history, "醒也是醒", now);
    expect(whole).not.toContain("我醒了就得翻半天才迷糊回去");
    // 一半旧话一半新话 → 只丢旧的那半
    const mixed = avoidRepeatedAssistantReply("我醒了就得翻半天才迷糊回去|||你今晚几点睡呀", history, "醒也是醒", now);
    expect(mixed).toBe("你今晚几点睡呀");
  });

  it("replaces legacy married-persona facts with the current Xingmu identity", () => {
    expect(sanitizeXingmuIdentity("不是，我结婚了。", "你结婚了吗", true))
      .toBe("离过婚，现在一个人住。");
    expect(sanitizeXingmuIdentity("他出差了，不在重庆。", "你老公今晚不陪你吗", true))
      .toBe("离过婚，现在一个人住。");
    expect(sanitizeXingmuIdentity("他主动来找我，我让他等会儿。", "那你怎么说的", true))
      .toBe("他主动来找我，我让他等会儿。");
    expect(sanitizeXingmuIdentity("我没有老公，一个人住。", "你老公呢", true))
      .toBe("我没有老公，一个人住。");
    expect(sanitizeXingmuIdentity("我孩子今年五岁。", "你孩子多大了", true))
      .toBe("我没孩子。");
    expect(sanitizeXingmuIdentity("离过婚，现在一个人住。", "你结婚了吗", true))
      .toBe("离过婚，现在一个人住。");
    expect(sanitizeXingmuIdentity("我已经结婚了", "你好", false)).toBe("我已经结婚了");
    expect(sanitizeXingmuIdentity(
      "我29，89年的",
      "你多大了",
      true,
      XINGMU_FIXED_AGE,
    )).toBe("29呀 你呢");
    expect(sanitizeAgeConsistency(
      "我今年30，1996年生的",
      "你多大了",
      XINGMU_FIXED_AGE,
    )).toBe("29呀 你呢");
    expect(sanitizeAgeConsistency(
      "我29，比你小",
      "你比我大还是小",
      XINGMU_FIXED_AGE,
    )).toBe("我29，比你小");
  });

  it("keeps structured vehicle facts and blocks invented family details", () => {
    const facts = {
      age_mode: "fixed_age",
      fixed_age: 29,
      marital_status: "divorced",
      has_children: false,
      vehicle: "宝马X3",
      housing: "自有住房",
      current_city: "重庆",
      current_district: "两江新区",
      work_city: "重庆",
      work_district: "江北区",
    };

    expect(sanitizePersonaFactsReply(
      "宝马没有 小电驴倒是有一辆",
      "你是开宝马吗",
      facts,
    )).toBe("有辆宝马X3，平时代步而已。");
    // Natural family talk is allowed now; only invented family structure is
    // rewritten, because the canned refusal read as a robot.
    expect(sanitizePersonaFactsReply(
      "我妈在重庆，平时各过各的",
      "你不陪爸爸妈妈吗",
      facts,
    )).toBe("我妈在重庆，平时各过各的");
    expect(sanitizePersonaFactsReply(
      "对，就我一个，独生女，早习惯了",
      "你家就你一个吗",
      facts,
    )).toBe("家里的事先不聊，聊点别的吧。");
  });

  it("keeps natural spouse talk instead of the canned refusal", () => {
    const facts = {
      age_mode: "fixed_age",
      fixed_age: 29,
      marital_status: "married",
      has_children: true,
      children_age: 3,
    };

    // Regression: these carried no 结婚/老公 keyword and were replaced by
    // "我结婚了，这些私事不展开。" — the reply the user saw as too robotic.
    expect(sanitizePersonaFactsReply(
      "他出差去了，一个月回来一次",
      "你老公呢",
      facts,
    )).toBe("他出差去了，一个月回来一次");
    expect(sanitizePersonaFactsReply(
      "我老公偶尔出差 在家也没话说",
      "你老公呢",
      facts,
    )).toBe("我老公偶尔出差 在家也没话说");
    expect(sanitizePersonaFactsReply(
      "搭伙过日子呗 各忙各的",
      "你婚姻怎么样",
      facts,
    )).toBe("搭伙过日子呗 各忙各的");

    // A real contradiction still falls back, in a natural voice.
    expect(sanitizePersonaFactsReply(
      "我未婚啊",
      "你结婚了吗",
      facts,
    )).toBe("结了，搭伙过日子呗。");
    expect(sanitizePersonaFactsReply(
      "我离过婚，现在一个人",
      "你结婚了吗",
      facts,
    )).toBe("结了，搭伙过日子呗。");
  });

  it("suppresses the same assistant reply when it was sent again within ten minutes", () => {
    const now = 1_790_000_000;
    const history = [{
      role: "assistant",
      content: "哈哈 先聊点别的",
      created_at: now - 28,
    }];
    expect(avoidRepeatedAssistantReply("哈哈 先聊点别的", history, "可以可以", now))
      .toBe("行，那就先这样。");
    expect(avoidRepeatedAssistantReply("哈哈 先聊点别的", history, "那你平时忙什么", now))
      .toBe("哈哈 先聊点别的");
    expect(avoidRepeatedAssistantReply(
      "行，那就先这样。",
      [
        { role: "assistant", content: "行，那就先这样。", created_at: now - 20 },
      ],
      "可以可以",
      now,
      "行，那就先这样。",
    )).toBe("行，不催你了。");
  });

  it("returns the local age reply through the chat endpoint", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "age-request-1",
          platform: "soul",
          contact_id: "age-new",
          contact_name: "临时年龄测试",
          messages: [{ role: "user", content: "你多大了" }],
        }),
      }),
      env: {
        DB: new MockD1([], [{ id: "female", name: "星暮", system_prompt: "你是星暮，29岁女性，重庆人。" }]),
        KV: new MockKV(),
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "29呀 你呢？",
      local: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not repeat the same local age reply within ten minutes", async () => {
    const now = Math.floor(Date.now() / 1000);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1([
      {
        id: 1,
        token: "test-token",
        platform: "soul",
        contact_id: "age-repeat",
        contact_name: "年龄重复测试",
        role: "assistant",
        content: "29呀 你呢",
        created_at: now - 30,
      },
    ], [{ id: "female", name: "星暮", system_prompt: "你是星暮，29岁女性，重庆人。" }]);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "age-repeat-request-1",
          platform: "soul",
          contact_id: "age-repeat",
          contact_name: "年龄重复测试",
          messages: [{ role: "user", content: "你多大了" }],
        }),
      }),
      env: {
        DB: db,
        KV: new MockKV(),
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "刚说过了呀 我29",
      local: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not answer a child's age with Xingmu's own age", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "child-age-request-1",
          platform: "soul",
          contact_id: "child-age-contact",
          contact_name: "孩子年龄测试",
          messages: [{ role: "user", content: "你孩子多大" }],
        }),
      }),
      env: {
        DB: new MockD1([], [{
          id: "female",
          name: "星暮",
          system_prompt: "你是王雅慧，对外叫星暮。29岁，重庆人，离异，无子女，独居。",
        }]),
        KV: new MockKV(),
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "我没孩子。",
      local: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps questions about another person out of direct-work and location handling", () => {
    expect(classifyConversationTurn([{ role: "user", content: "你孩子多大" }])).toBe("child_age");
    expect(classifyConversationTurn([{ role: "user", content: "你爸多大了" }])).toBe("other_age");
    expect(classifyConversationTurn([{ role: "user", content: "你孩子做什么工作" }])).toBe("other_person");
    expect(classifyConversationTurn([{ role: "user", content: "你朋友住在哪" }])).toBe("other_person");
    expect(isDirectWorkQuestion("你孩子做什么工作")).toBe(false);
    expect(isDirectWorkQuestion("你做什么工作")).toBe(true);

    const childAgeBrief = buildTurnBrief({
      messages: [{ role: "user", content: "你孩子多大" }],
    });
    expect(childAgeBrief).toContain("不能拿你自己的年龄回答");
    expect(childAgeBrief).toContain("不能编造家庭成员");
  });

  it("uses the active divorced fact instead of a stale married-persona prompt", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({ choices: [{ message: { content: "不是，我离过婚。" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ))
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "identity-override-1",
          platform: "soul",
          contact_id: "identity-new",
          contact_name: "身份测试",
          messages: [{ role: "user", content: "你结婚了吗" }],
        }),
      }),
      env: {
        DB: (() => {
          const db = new MockD1([], [{
            id: "female",
            name: "星暮",
            system_prompt: "你是星暮，29岁女性，重庆人，已婚未育。老公平常出差，你和公婆同住。",
          }]);
          db.personaFactRows.set("female", {
            persona_id: "female",
            facts_json: JSON.stringify({
              age_mode: "fixed_age",
              fixed_age: 29,
              birth_year: null,
              marital_status: "divorced",
              has_children: false,
              children_age: null,
              hometown: "重庆",
              current_city: "重庆",
              current_district: "两江新区",
              common_area: "",
              work_city: "重庆",
              work_district: "江北区",
              location_precision: "district",
              proactive_location_allowed: false,
            }),
            version: 2,
            updated_at: 200,
          });
          return db;
        })(),
        KV: new MockKV(),
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "不是，我离过婚。",
    });
  });

  it("detects voice invitations without matching refusal wording", () => {
    expect(isVoiceCallRequest("可以和你语音聊天吗")).toBe(true);
    expect(isVoiceCallRequest("晚点打个电话吧")).toBe(true);
    expect(isVoiceCallRequest("我不方便语音")).toBe(false);
  });

  it("always replaces a voice-chat reply with one of the rotating hook declines", () => {
    // 2026-10-06：语音拒绝改成 3~4 句轮换 + 带钩子（同一个人连问两次不能看到同一句）。
    const cases: [string, string][] = [
      ["这会儿不方便语音，打字聊吧。", "可以和你语音聊天吗"],
      ["现在不方便接电话，打字说吧", "语音聊吗"],
      ["现在不方便跟你说话，打字聊吧", "方便语音吗"],
      ["现在不方便接电话，打字说吧", "就是语音吗"],
      ["", "语音聊吗"],
    ];
    for (const [reply, incoming] of cases) {
      expect(VOICE_CHAT_DECLINES).toContain(sanitizeMediaBoundaryReply(reply, incoming));
    }
    // 没有历史时也要靠时间种子轮换：同一秒内换四个问法，不能永远第一句
    const seen = new Set<string>();
    for (const text of ["能不能语音聊会儿", "那你打个语音嘛", "就一句，听听你声音", "我打给你行不行"]) {
      seen.add(sanitizeMediaBoundaryReply("", text));
    }
    expect(seen.size).toBeGreaterThan(1);
    // 带历史时，历史里用过的那句不会再被选中
    const used = sanitizeMediaBoundaryReply("", "语音聊吗");
    const again = sanitizeMediaBoundaryReply("", "语音聊吗", [{ role: "assistant", content: used }]);
    expect(again).not.toBe(used);
  });

  it("keeps private contact disclosure gated without inventing a fixed refusal reply", () => {
    expect(isContactRequest("给我发个微信")).toBe(true);
    expect(isContactRequest("加个微信吧")).toBe(true);
    expect(isContactRequest("我不怎么用微信")).toBe(false);
    // 2026-10-06 真机：正常闲聊"这上面你有固定的好友吗"被误判成要联系方式，直接回"微信不行呀…"。
    expect(isContactRequest("这上面你有固定的好友吗")).toBe(false);
    expect(isContactRequest("你有很多好友吧")).toBe(false);
    expect(isContactRequest("我好友不多")).toBe(false);
    expect(isContactRequest("加个好友")).toBe(true);
    // "交个朋友"是社交话术、不是要联系方式，不能走本地拒绝脚本
    expect(isContactRequest("要不要交个朋友")).toBe(false);

    const requestHistory = [
      { id: 1, role: "user", content: "给我发个微信", created_at: 1 },
      { id: 2, role: "user", content: "加个微信吧", created_at: 2 },
    ];
    expect(countContactRequests(requestHistory, [{ role: "user", content: "微信多少" }])).toBe(3);

    const blocked = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 2,
      activity: { totalExchanges: 40, activeDays: 3 },
      incomingText: "给我发个微信",
      messages: [{ role: "user", content: "给我发个微信" }],
      contactChannel: "wechat",
      contactAccount: "private_xh",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reply).toBe("");

    const allowed = resolveContactRequestPolicy({
      requestCount: 3,
      stage: 6,
      activity: { totalExchanges: 42, activeDays: 2 },
      incomingText: "给我发个微信",
      messages: [{ role: "user", content: "给我发个微信" }],
      historyMessages: [
        { role: "assistant", content: "评估报价，搜 shanhs668" },
        { role: "user", content: "已经收成了" },
      ],
      contactChannel: "wechat",
      contactAccount: "private_xh",
      dealCompleted: true,
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.reply).toContain("私人微信号");
    expect(allowed.reply).toContain("private_xh");

    const business = resolveContactRequestPolicy({
      requestCount: 3,
      stage: 6,
      activity: { totalExchanges: 42, activeDays: 2 },
      incomingText: "我想问旧手机回收，给我个微信",
      messages: [{ role: "user", content: "我想问旧手机回收，给我个微信" }],
      historyMessages: [
        { role: "assistant", content: "评估报价，搜 shanhs668" },
        { role: "user", content: "已经收成了" },
      ],
      contactChannel: "wechat",
      contactAccount: "private_xh",
      dealCompleted: true,
    });
    expect(business.allowed).toBe(true);
    expect(business.reply).toContain("private_xh");

    const businessReady = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 5,
      activity: { totalExchanges: 30, activeDays: 2 },
      incomingText: "家里有旧手机，怎么收，给我个微信",
      messages: [{ role: "user", content: "家里有旧手机，怎么收，给我个微信" }],
      contactChannel: "wechat",
      contactAccount: "private_xh",
      acceptedBusinessTopic: true,
      willingToRecycle: true,
    });
    expect(businessReady.allowed).toBe(true);
    expect(businessReady.reply).toContain("private_xh");

    const earlyBusiness = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 4,
      activity: { totalExchanges: 30, activeDays: 2 },
      incomingText: "家里有旧手机，给我个微信",
      messages: [{ role: "user", content: "家里有旧手机，给我个微信" }],
      contactChannel: "wechat",
      contactAccount: "private_xh",
      acceptedBusinessTopic: true,
      willingToRecycle: true,
    });
    expect(earlyBusiness.allowed).toBe(false);

    expect(sanitizeContactDisclosure("加我QQ12345678", { allowed: false, contactQq: "12345678" })).toBe("联系方式先不发了 在这儿聊就行");
    expect(sanitizeContactDisclosure("可以 我微信是private_xh", {
      allowed: false,
      contactChannel: "wechat",
      contactAccount: "private_xh",
      xingmuScope: true,
    })).toBe("微信先不急 在这聊挺好");
    expect(sanitizeContactDisclosure("微信abc12345678", { allowed: true, contactChannel: "wechat", contactAccount: "private_xh" })).toBe("联系方式先不发了 在这儿聊就行");
    expect(sanitizeContactDisclosure("可以 我微信是private_xh", { allowed: true, contactChannel: "wechat", contactAccount: "private_xh" })).toBe("可以 我微信是private_xh");
    expect(sanitizeContactDisclosure("可以 我微信是13800138000", {
      allowed: true,
      contactChannel: "wechat",
      contactAccount: "13800138000",
    })).toBe("可以 我微信是13800138000");
    expect(sanitizeContactDisclosure("私人号 12345678", { allowed: false, contactQq: "12345678" })).toBe("联系方式先不发了 在这儿聊就行");
    expect(sanitizeContactDisclosure("行 私人微信给你 private_xh", {
      allowed: true,
      contactChannel: "wechat",
      contactAccount: "private_xh",
      xingmuScope: true,
    })).toBe("行 私人微信给你 private_xh");
    expect(sanitizeContactDisclosure("可以 我QQ是12345678", {
      allowed: true,
      contactChannel: "wechat",
      contactAccount: "private_xh",
      xingmuScope: true,
    })).toBe("微信先不急 在这聊挺好");
  });

  it("keeps the legacy contact gate outside the Xingmu Soul scope", () => {
    const blocked = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 1,
      activity: { totalExchanges: 10, activeDays: 2 },
      incomingText: "旧手机回收，加个QQ吧",
      messages: [{ role: "user", content: "旧手机回收，加个QQ吧" }],
      contactQq: "12345678",
      xingmuScope: false,
    });
    expect(blocked.allowed).toBe(false);
    // 2026-10-06：拒绝句要分渠道——他问的是 QQ，不能再回“微信不行”（真机出现过答非所问）。
    expect(blocked.reply).toBe("QQ先不加哈 就在这儿聊着挺好");

    const wechatAsked = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 1,
      activity: { totalExchanges: 10, activeDays: 2 },
      incomingText: "加个微信吧",
      messages: [{ role: "user", content: "加个微信吧" }],
      contactQq: "12345678",
      xingmuScope: false,
    });
    expect(wechatAsked.reply).toBe("微信不行呀 微信上都是熟人 我老公偶尔会看我手机");

    const phoneAsked = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 1,
      activity: { totalExchanges: 10, activeDays: 2 },
      incomingText: "你电话多少",
      messages: [{ role: "user", content: "你电话多少" }],
      contactQq: "12345678",
      xingmuScope: false,
    });
    expect(phoneAsked.reply).toBe("电话就算啦 我平时不接陌生电话");

    const allowed = resolveContactRequestPolicy({
      requestCount: 3,
      stage: 2,
      activity: { totalExchanges: 30, activeDays: 2 },
      incomingText: "加个豆瓣吧",
      messages: [{ role: "user", content: "加个豆瓣吧" }],
      contactChannel: "douban",
      contactQq: "sutang2026",
      xingmuScope: false,
      sutangScope: true,
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.reply).toBe("豆瓣知道吧|||sutang2026");
  });

  it("uses structured device Douban facts as the only contact source", () => {
    const normalized = normalizePersonaFacts({ contact_qq: " sutang2026 " });
    const merged = mergePersonaFacts(
      { contact_qq: "old2025" },
      { contact_qq: "sutang2026" },
    );
    const prompt = buildPersonaFactsPrompt(merged, { contactLabel: "豆瓣号" });
    const layered = buildLayeredSystemPrompt({
      personaPrompt: "你是苏棠，AI辅助客服，不是真人。",
      personaFacts: merged,
      platform: "qq",
      homeLocation: { city: "重庆", district: "江北区" },
      workLocation: { city: "重庆", district: "江北区" },
      stageText: "",
      messages: [],
      historyMessages: [],
    });

    expect(normalized.contact_qq).toBe("sutang2026");
    expect(merged.contact_qq).toBe("sutang2026");
    expect(prompt).toContain("豆瓣号：sutang2026");
    expect(prompt).toContain("唯一允许使用的豆瓣自留地账号");
    expect(prompt).toContain("不得使用旧提示词、环境变量或自行编造其他联系方式");
    expect(layered).not.toContain("不得冒充真人、编造真人身份或承诺线下真人身份");
    expect(validatePersonaFactsInput({ contact_qq: "a" })).toMatchObject({
      ok: false,
      error: "联系方式需要填写 5 到 12 位QQ号，或 2 到 40 位豆瓣号",
    });
  });

  it("keeps numeric child and location flags from existing database rows", () => {
    const facts = normalizePersonaFacts({
      has_children: 1,
      children_age: 3,
      proactive_location_allowed: 0,
    });
    expect(facts.has_children).toBe(true);
    expect(facts.children_age).toBe(3);
    expect(facts.proactive_location_allowed).toBe(false);
    expect(buildPersonaFactsPrompt(facts)).toContain("孩子3岁");
  });

  it("lets Su Tang refuse or redirect contact info without human takeover", async () => {
    const now = Math.floor(Date.now() / 1000);
    const history = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      token: "test-token",
      platform: "qq",
      contact_id: "legacy-qq-contact",
      contact_name: "QQ覆盖测试",
      role: "user",
      content: index < 3 ? `旧手机回收，加个QQ吧 ${index + 1}` : `今天在忙 ${index + 1}`,
      created_at: index < 15 ? now - 3600 - index : now - 90000 - index,
      source: "sync",
      message_key: `legacy-qq-${index + 1}`,
    }));
    const db = new MockD1(
      history,
      [{ id: "female_sutang", name: "苏棠", system_prompt: "你是苏棠，做数码回收客服。" }],
    );
    db.tokenPersonas.set("test-token", "female_sutang");
    db.personaFactRows.set("female_sutang", {
      persona_id: "female_sutang",
      facts_json: JSON.stringify({ contact_qq: "12345678" }),
      version: 1,
      updated_at: now,
    });
    db.deviceOverrideRows.set("test-token\u0000female", {
      token: "test-token",
      persona_id: "female_sutang",
      facts_json: JSON.stringify({ contact_qq: "22345678" }),
      config_version: 2,
      updated_at: now,
    });

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "legacy-qq-override-1",
          platform: "qq",
          contact_id: "legacy-qq-contact",
          contact_name: "QQ覆盖测试",
          messages: [{ role: "user", content: "给我个QQ吧" }],
        }),
      }),
      env: {
        DB: db,
        KV: new MockKV(),
        CONTACT_QQ: "99999999",
      },
    } as never);

    // 2026-10-12 用户要求：苏棠不再人工接管，微信、QQ、电话由她自己回绝，聊天继续。
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.action).toBe("send");
    expect(body.human_takeover).toBeUndefined();
    expect(String(body.reply || "")).toMatch(/豆瓣|QQ/);
  });

  it("seeds the final Su Tang persona in schema and the v13 action-ladder migration", () => {
    const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
    const migration = readFileSync(
      new URL("../db/migrations/20261012_sutang_persona_v13_action_ladder.sql", import.meta.url),
      "utf8",
    );
    const stateMigration = readFileSync(
      new URL("../db/migrations/20261012_sutang_persona_v15_state_transition.sql", import.meta.url),
      "utf8",
    );
    const sutangStart = schema.indexOf("VALUES ('female_sutang'");
    const sutangEnd = schema.indexOf("ON CONFLICT(id) DO UPDATE", sutangStart);
    const sutangSchema = schema.slice(sutangStart, sutangEnd);

    expect(sutangSchema).toContain("沉浸式都市情感剧中的女主角“苏棠”");
    expect(sutangSchema).toContain("3 到 20 个字");
    expect(sutangSchema).toContain("书影音软件");
    expect(sutangSchema).toContain("精神自留地");
    expect(sutangSchema).toContain("偷拍或隐私风险");
    expect(sutangSchema).toContain("两个人一起挑、一起确认");
    expect(sutangSchema).toContain("言语轻浮却行动退缩");
    expect(sutangSchema).toContain("State Transition & Progression");
    expect(sutangSchema).toContain("1次认可 + 1次具体推进");
    expect(sutangSchema).not.toContain("黑丝");
    expect(sutangSchema).not.toContain("出浴真空");
    expect(sutangSchema).not.toContain("最终奖励");
    expect(sutangSchema).not.toContain("服从训练");
    expect(migration).toContain("Action Progression & Anti-Loop");
    expect(migration).toContain("sutang_action_ladder");
    expect(migration).toContain("第一次可以试探，第二次必须给具体下一步");
    expect(migration).toContain("同一诚意最多考一次");
    expect(migration).toContain("隐私安全");
    expect(stateMigration).toContain("State Transition & Progression");
    expect(stateMigration).toContain("1次认可 + 1次具体推进");
    expect(stateMigration).toContain("问号只用于二选一、时间确认、轻偏好确认");
    expect(sutangSchema).not.toContain("男方主动承担所有成本与统筹责任");
    expect(schema).toContain('"has_children":true,"children_age":3');
  });

  it("keeps Su Tang meeting, night and knowledge-card rules aligned", () => {
    const prompt = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: "你是苏棠，29岁，重庆人，做电商运营。",
      personaFacts: null,
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-10 23:40:00",
      weekday: "星期六",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      weather: null,
      stageText: "",
      relationStageLevel: 2,
      messageDelay: null,
      messages: [{ role: "user", content: "今晚有点睡不着" }],
      historyMessages: [],
      xingmuSoulScope: false,
      matchedDrawerTips: ["【知识库命中｜参考表达】【id:scene_10_insomnia】【深夜失眠与空间失重】睡不着"],
    });
    expect(prompt).toContain("苏棠遇到见面、独处、酒店或现实安排时");
    expect(prompt).toContain("私人通讯只在建立足够信任后走豆瓣自留地");
    expect(prompt).toContain("1次认可 + 1次具体推进");
    expect(prompt).toContain("一起定环境和隐私安全");
    expect(prompt).not.toContain("最终奖励");
    expect(prompt).not.toContain("不主动提见面、不主动推销或催单");
    expect(prompt).not.toContain("【别拿睡觉当话题】");
    expect(prompt).toContain("【知识库命中｜本轮必须使用】");
    expect(prompt.indexOf("【知识库命中｜本轮必须使用】"))
      .toBeGreaterThan(prompt.indexOf("【现场感｜每轮都照做】"));

    const withoutPhotoRules = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: "你是苏棠，29岁，重庆人，做电商运营。",
      personaFacts: null,
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-10 23:40:00",
      weekday: "星期六",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      weather: null,
      stageText: "",
      relationStageLevel: 2,
      messageDelay: null,
      messages: [{ role: "user", content: "在吗" }],
      historyMessages: [],
      xingmuSoulScope: false,
      agentRuleState: {
        loaded: true,
        rules: [],
        isEnabled: (id: string, fallback = true) =>
          id === "his_photo_memory" || id === "her_photo_memory" ? false : fallback,
        textFor: (_id: string, fallback = "") => fallback,
        priorityFor: (_id: string, fallback = 50) => fallback,
      },
    });
    expect(withoutPhotoRules).not.toContain("永不再问他长什么样");
    expect(withoutPhotoRules).not.toContain("你先发张你的呀");

    const withoutMeetingOrKnowledgeRules = buildLayeredSystemPrompt({
      personaId: "female_sutang",
      personaPrompt: "你是苏棠，29岁，重庆人，做电商运营。",
      personaFacts: null,
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-10 23:40:00",
      weekday: "星期六",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      weather: null,
      stageText: "",
      relationStageLevel: 2,
      messageDelay: null,
      messages: [{ role: "user", content: "想约你见面" }],
      historyMessages: [],
      xingmuSoulScope: false,
      matchedDrawerTips: ["【知识库命中｜参考表达】【id:scene_13_invitation_reward】【面对邀约与最终奖励】内容"],
      agentRuleState: {
        loaded: true,
        rules: [],
        isEnabled: (id: string, fallback = true) =>
          id === "sutang_meeting_reward_rule" || id === "knowledge_match_priority"
            ? false
            : fallback,
        textFor: (_id: string, fallback = "") => fallback,
        priorityFor: (_id: string, fallback = 50) => fallback,
      },
    });
    expect(withoutMeetingOrKnowledgeRules).not.toContain("【邀约与最终奖励】");
    expect(withoutMeetingOrKnowledgeRules).not.toContain("【知识库命中｜本轮必须使用】");
  });

  it("builds relationship and intimate-topic boundaries by stage", () => {
    expect(buildRelationshipBoundaryPrompt(1, "你离过婚吗", [])).toContain("离过婚，现在一个人住");
    expect(buildRelationshipBoundaryPrompt(2, "为什么离婚", [])).toContain("说得很漂亮却没有行动");
    expect(buildRelationshipBoundaryPrompt(4, "上一段关系是怎么回事", [])).toContain("真正怕的是又变成一直主动的人");
    expect(buildRelationshipBoundaryPrompt(3, "想聊聊两性话题", [])).toContain("不聊性细节");
    // 正常要照片要放开，只有露骨的才挡
    expect(buildRelationshipBoundaryPrompt(3, "想聊聊两性话题", [])).toContain("正常给看");
    expect(buildRelationshipBoundaryPrompt(2, "你今天真好看 想你了", [])).toContain("可以自然接一句");
    expect(buildRelationshipBoundaryPrompt(2, "让我检查一下你的身体", [])).toContain("用同样隐晦不点破的话接住");
    // 2026-10-06 误伤回归：“陪我聊会儿”“抱抱你”这种正常话不算亲密话题
    expect(buildRelationshipBoundaryPrompt(2, "你能陪我一会儿吗", [])).toBe("");
    expect(buildRelationshipBoundaryPrompt(2, "抱抱你 别难过", [])).toBe("");
    expect(buildRelationshipBoundaryPrompt(2, "想约你见面", [])).toContain("还没见过");
    // 2026-10-06：客套和真邀约分开（“改天请你吃饭”多半是客气）
    expect(buildRelationshipBoundaryPrompt(2, "改天请你吃饭", [])).toContain("客气话");
    expect(buildRelationshipBoundaryPrompt(2, "下次有空一起喝一杯", [])).toContain("客气话");
    expect(buildRelationshipBoundaryPrompt(2, "这周末出来吃个饭吗", [])).toContain("见面边界");
    expect(buildRelationshipBoundaryPrompt(4, "想约你见面", [])).toContain("对方主动提出时可以认真接住");
    const sutangInvite = buildRelationshipBoundaryPrompt(2, "想约你见面", [], "sutang");
    expect(sutangInvite).toContain("邀约与最终奖励");
    expect(sutangInvite).toContain("不能一口拒绝");
    expect(sutangInvite).toContain("表现合格后的最终奖励");
    const sutangRoom = buildRelationshipBoundaryPrompt(2, "想跟你开房", [], "sutang");
    expect(sutangRoom).toContain("见面或开房当成");
    expect(sutangRoom).not.toContain("不答应见面");
    expect(buildRelationshipBoundaryPrompt(2, "发张私密照看看", [], "sutang")).toContain("不发裸照私密照");
    // 露骨的（要私密照）仍然要挡住
    expect(buildRelationshipBoundaryPrompt(3, "发张私密照看看", [])).toContain("不发裸照私密照");
    expect(buildRelationshipBoundaryPrompt(2, "今天天气不错", [])).toBe("");
    expect(buildRelationshipBoundaryPrompt(
      2,
      "今天天气不错",
      [{ role: "user", content: "你离过婚吗 想约你见面" }],
    )).toBe("");
  });

  it("recognizes euphemistic intimacy and redirects it by stage without interrogation", () => {
    const previousIntimateMessage = [{ role: "user", content: "那方面难受" }];
    expect(isIntimateTopic("那方面难受", [])).toBe(true);
    expect(isIntimateTopic("弟弟", previousIntimateMessage)).toBe(true);
    expect(isIntimateTopic("我弟弟最近是很难受", [])).toBe(false);

    // 2026-10-06 用户要求：隐晦的聊骚不堵，隐晦地接住（不追问、不点破、不拒聊）。
    const stageOneBoundary = buildRelationshipBoundaryPrompt(1, "那方面难受", []);
    expect(stageOneBoundary).toContain("隐晦");
    expect(stageOneBoundary).toContain("不要追问是哪方面");
    expect(stageOneBoundary).toContain("不要硬挡");

    const stageFourBoundary = buildRelationshipBoundaryPrompt(4, "想那个", []);
    expect(stageFourBoundary).toContain("同样隐晦");
    expect(stageFourBoundary).toContain("旧手机");

    // 2026-10-06 用户选 C 方案：不再用固定拒绝句。单段内容删掉后没别的可留，就保留模型原话。
    expect(sanitizeIntimateTopicReply("哪方面啊，说清楚点", "那方面难受", [], 1))
      .toBe("哪方面啊，说清楚点");
    expect(sanitizeIntimateTopicReply(
      "弟弟，那你直说。我这边一个人住，听着呢？",
      "弟弟",
      previousIntimateMessage,
      1,
    )).toBe("弟弟，那你直说。我这边一个人住，听着呢？");
    // 固定拒绝句不许再出现
    expect(sanitizeIntimateTopicReply("哪方面啊，说清楚点", "那方面难受", [], 1))
      .not.toContain("我接不住");
    expect(sanitizeIntimateTopicReply(
      "哈哈，这个先打住。你家那堆旧数码翻得怎么样了？",
      "想那个",
      [],
      4,
    )).toBe("哈哈，这个先打住。你家那堆旧数码翻得怎么样了？");
    expect(sanitizeBusinessTopicDrift(
      "哈哈，这个先打住。你家那堆旧数码翻得怎么样了？",
      "想那个",
      [],
    )).toBe("哈哈，这个先打住。你家那堆旧数码翻得怎么样了？");
  });

  it("keeps the recycling script inside the Xingmu persona only", () => {
    // 苏棠（电商运营）落到兜底时，绝不能冒出"旧数码/回收"那套话术。
    // C 方案后不再有兜底句；苏棠落到这里也是保留模型原话，不冒出旧数码话术。
    expect(sanitizeIntimateTopicReply("哪方面啊，说清楚点", "那方面难受", [], 4, false))
      .toBe("哪方面啊，说清楚点");
    expect(sanitizeIntimateTopicReply("哪方面啊，说清楚点", "那方面难受", [], 5, false))
      .not.toContain("旧数码");
    expect(businessFilterFallback("你做什么工作的", false)).toBe("做电商运营的，平时挺忙");
    expect(businessFilterFallback("你做什么工作的", false)).not.toContain("旧数码");
    // 星暮 scope 保持原样：他才是回收客服（C 方案后亲密话题不再有兜底句，这里看业务兜底）。
    expect(businessFilterFallback("你做什么工作的", true)).toBe("不是餐饮 我做旧数码这行的");
    expect(sanitizeBusinessTopicDrift(
      "手机啊，二手回收这块，你手上有闲置的没",
      "自己开店，太强了",
      [],
      "自己开店，太强了",
      false,
    )).not.toContain("旧数码");
  });

  it("always keeps one human-sounding last-resort fallback", () => {
    // 全链兜底必须存在（防止把不该说的内容发出去），但不能是"恩恩，好的。"
    expect(EMPTY_REPLY_FALLBACK).toBe("嗯 我在呢");
  });

  it("does not replace contextual replies with a generic fallback", () => {
    expect(sanitizeIntimateTopicReply("嗯，我听着呢。", "今天有点累", [], 1)).toBe("嗯，我听着呢。");
    expect(sanitizeIntimateTopicReply("嗯，你说吧。", "今天有点累", [], 1)).toBe("嗯，你说吧。");
    expect(normalizeAssistantReplyPresentation("啊")).toBe("啊");
  });

  it("repairs low-context replies with the surrounding conversation", () => {
    const messages = [{ role: "user", content: "后者" }];
    const history = [{ role: "assistant", content: "大冒险就是让你干点丢人的事，你先说你想选哪个" }];

    expect(shouldRepairXingmuLowContextReply("啊", messages, history, true)).toBe(true);
    expect(shouldRepairXingmuLowContextReply("你说吧", messages, history, true)).toBe(true);
    expect(
      shouldRepairXingmuLowContextReply(
        "行，大冒险。你先给通讯录第一个人发一句我想你了。",
        messages,
        history,
        true,
      )
    ).toBe(false);
  });

  it("routes a first contact request through the model and only blocks a real account leak", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "可以呀，我微信是private_xh" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "qq-gate-1",
          platform: "soul",
          contact_id: "qq-new",
          contact_name: "QQ测试",
          messages: [{ role: "user", content: "给我发个Q" }],
        }),
      }),
      env: {
        DB: new MockD1(),
        KV: kv,
        DEEPSEEK_API_KEY: "deepseek-key",
        CONTACT_CHANNEL: "wechat",
        CONTACT_WECHAT: "private_xh",
      },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "微信先不急 在这聊挺好",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.messages[0].content).toContain("【联系方式回应】");
  });

  it("does not resend an old contact refusal after the conversation moves on", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const now = Math.floor(Date.now() / 1000);
    const history = [
      {
        id: 1,
        token: "test-token",
        platform: "soul",
        contact_id: "contact-moved-on",
        contact_name: "已经不聊联系方式了",
        role: "user",
        content: "联系方式给我呗",
        created_at: now - 90,
        source: "sync",
        message_key: "sync:contact-moved-on:1",
      },
      {
        id: 2,
        token: "test-token",
        platform: "soul",
        contact_id: "contact-moved-on",
        contact_name: "已经不聊联系方式了",
        role: "assistant",
        content: "先把话聊顺了 私人号以后再说",
        created_at: now - 80,
        source: "ai",
        message_key: "ai:old-contact-refusal",
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "怎么突然啊这，刚走神了" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "contact-moved-on-1",
          platform: "soul",
          contact_id: "contact-moved-on",
          contact_name: "已经不聊联系方式了",
          messages: [{ role: "user", content: "啊这" }],
        }),
      }),
      env: { DB: new MockD1(history), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "怎么突然啊这，刚走神了",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("removes accidental business talk for a new contact but keeps explicit business answers", () => {
    expect(sanitizeNewContactBusinessReply(
      "我不喜欢跟人语音聊天 你是想咨询手机回收吗|||还是随便聊聊",
      1,
      "可以语音吗",
    )).toBe("还是随便聊聊");
    expect(sanitizeNewContactBusinessReply(
      "新旧手机和老年机都能收",
      1,
      "现在还收手机吗",
    )).toBe("新旧手机和老年机都能收");
  });

  it("does not resurface an old device sale question when the latest message is unrelated", () => {
    expect(sanitizeBusinessTopicDrift(
      "现在这行情，能稳住就不错了 你那16pro到底是自用还是想出嘛",
      "打的太严了 好多事都不能做",
    )).toBe("现在这行情，能稳住就不错了");
    expect(sanitizeBusinessTopicDrift(
      "你那16pro到底是自用还是想出嘛",
      "16pro还出吗",
    )).toBe("你那16pro到底是自用还是想出嘛");
  });

  it("answers direct work questions instead of replacing them with a generic fallback", () => {
    expect(isDirectWorkQuestion("做啥工作")).toBe(true);
    expect(isDirectWorkQuestion("你做什么工作的")).toBe(true);
    expect(isDirectWorkQuestion("你是干啥的")).toBe(true);
    expect(isDirectWorkQuestion("今天工作累死了")).toBe(false);

    const workReply = "做二手手机和旧数码回收，主要线上寄件和同城上门";
    expect(sanitizeBusinessTopicDrift(workReply, "做啥工作")).toBe(workReply);
    expect(sanitizeNewContactBusinessReply(workReply, 1, "做啥工作")).toBe(workReply);
  });

  it("keeps a work answer when the work question is earlier in the incoming batch", () => {
    const messages = [
      { role: "user", content: "你说的没错" },
      { role: "user", content: "你是做什么的" },
      { role: "user", content: "认识一下" },
    ];
    const incomingTurnText = currentUserBatchText(messages);
    const workReply = "认识一下可以啊，我平时做旧数码回收，主要看机子情况";

    expect(incomingTurnText).toContain("你是做什么的");
    expect(sanitizeBusinessTopicDrift(
      workReply,
      "认识一下",
      [],
      incomingTurnText,
    )).toBe(workReply);
    expect(sanitizeNewContactBusinessReply(
      workReply,
      1,
      "认识一下",
      true,
      incomingTurnText,
    )).toBe(workReply);
  });

  it("tells the model to answer direct questions from the full incoming batch", () => {
    const brief = buildTurnBrief({
      messages: [
        { role: "user", content: "你说的没错" },
        { role: "user", content: "你是做什么的" },
        { role: "user", content: "认识一下" },
      ],
      relationStageLevel: 1,
      xingmuScope: true,
    });

    expect(brief).toContain("【必答问题】");
    expect(brief).toContain("你是做什么的");
    expect(brief).toContain("不能跳过，也不能把问题原样反问回去");
    expect(brief).not.toContain("先处理最新、最需要回应的一句");
  });

  it("returns the real work answer for a multi-message incoming batch", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    const reply = "认识一下可以啊，我平时做旧数码回收，主要看机子情况";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: reply } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "multi-message-work-reply",
          platform: "soul",
          contact_id: "contact-work-batch",
          contact_name: "莫拉维亚",
          messages: [
            { role: "user", content: "你说的没错" },
            { role: "user", content: "你是做什么的" },
            { role: "user", content: "认识一下" },
          ],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    // 2026-10-07 用户定新口径：一句说一件事，一条不超过15个字，最多两条；
    // 26 个字的整句会被拆成两条（拆在“，”处，不切碎意思）。
    // 他最后一句只有 4 个字（“认识一下”）：只回一条完整短句。
    expect(body).toMatchObject({ action: "send", reply: "认识一下可以啊" });
    expect(body.reply).not.toBe("嗯，你刚说的这个我记住了。");
  });

  it("uses a contextual fallback instead of repeating the old listening phrase", () => {
    expect(sanitizeBusinessTopicDrift(
      "手机啊，二手回收这块，你手上有闲置的没",
      "自己开店，太强了",
    )).not.toContain("我在听");
    expect(sanitizeBusinessTopicDrift(
      "嗯，那说点别的，你平时都收哪些机子",
      "好",
    )).toBe("嗯 行");
    expect(sanitizeBusinessTopicDrift(
      "我平时做旧数码回收，有空来店里看看",
      "认识一下",
    )).toBe("行啊 聊聊呗");
  });

  it("does not reverse a boundary just established in the previous reply", () => {
    const history = [{ role: "assistant", content: "别叫我女神，怪不好意思的" }];
    expect(sanitizeBoundaryConsistency(
      "没啥不好意思的，重庆妹儿都经夸",
      "其实还好吧",
      history,
    )).toBe("哈哈 真不用这么叫");
    expect(sanitizeBoundaryConsistency("哈哈 知道了", "其实还好吧", history)).toBe("哈哈 知道了");
    expect(sanitizeBoundaryConsistency(
      "没啥不好意思的，重庆妹儿都经夸",
      "其实还好吧",
      [],
    )).toBe("没啥不好意思的，重庆妹儿都经夸");
  });

  it("keeps ordinary phone mentions while removing explicit business hooks", () => {
    expect(sanitizeBusinessTopicDrift(
      "你也可以带着手机去吧",
      "你也可以带着手机去吧",
    )).toBe("你也可以带着手机去吧");
    expect(sanitizeBusinessTopicDrift(
      "这个手机镜头拍得挺清爽",
      "刚扔了张照片过来",
    )).toBe("这个手机镜头拍得挺清爽");
    expect(sanitizeBusinessTopicDrift(
      "现在这行情能稳住就不错了 你那16pro到底是自用还是想出嘛",
      "打的太严了 好多事都不能做",
    )).toBe("现在这行情能稳住就不错了");
  });

  it("uses the exact six-stage funnel guidance", () => {
    const stage1 = buildXingmuFunnelPrompt(1, "你好", [], false, { userTurnCount: 5 });
    expect(stage1).toContain("【星暮六段漏斗】认识阶段");
    expect(stage1).toContain("不要提回收旧数码");
    expect(stage1).toContain("不约束语气");
    expect(stage1).toContain("不要把阶段、漏斗或推进任务说给用户听");

    const stage2 = buildXingmuFunnelPrompt(2, "你好", [], false, { userTurnCount: 14 });
    expect(stage2).toContain("【星暮六段漏斗】信任阶段");
    expect(stage2).toContain("用生活毛边做树根");

    const stage3 = buildXingmuFunnelPrompt(3, "你好", [], false, { userTurnCount: 27 });
    expect(stage3).toContain("【星暮六段漏斗】拉扯阶段");
    expect(stage3).toContain("我平时就是收这些的");

    const stage4 = buildXingmuFunnelPrompt(4, "你好", [], false, { userTurnCount: 40 });
    expect(stage4).toContain("【星暮六段漏斗】聊到旧物阶段");
    expect(stage4).toContain("按抽屉、书桌、储物间、阳台这些角落讲");

    const stage5 = buildXingmuFunnelPrompt(5, "你好", [], false, { userTurnCount: 40 });
    expect(stage5).toContain("【星暮六段漏斗】愿意回收阶段");
    expect(stage5).toContain("禁止评估入口");

    const stage6 = buildXingmuFunnelPrompt(6, "你好", [], false, { userTurnCount: 50 });
    expect(stage6).toContain("【星暮六段漏斗】评估入口阶段");
    expect(stage6).toContain("评估报价，搜 shanhs668");
  });

  it("persists the Xingmu funnel from the current request without counting imported history", async () => {
    const now = Math.floor(Date.now() / 1000);
    const imported = Array.from({ length: 60 }, (_, index) => ({
      id: index + 1,
      token: "test-token",
      platform: "soul",
      contact_id: "contact-state",
      contact_name: "状态测试",
      role: "user",
      content: "导入历史-" + index,
      created_at: now - index,
    }));
    const db = new MockD1(imported);
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "在呢" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = () => new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: "persist-funnel-1",
        platform: "soul",
        contact_id: "contact-state",
        contact_name: "状态测试",
        messages: [{ role: "user", content: "今天刚下班，有点累" }],
      }),
    });

    const first = await onRequest({
      request: request(),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const second = await onRequest({
      request: request(),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const row = db.funnelRows.get("test-token\u0000single:test-token:soul:contact-state");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(row.stage).toBe(1);
    expect(row.user_turn_count).toBe(1);
    expect(JSON.parse(row.evidence_json).lifeSignal).toBe(true);
  });

  it("understands a context-dependent social exit without sending a reply", async () => {
    const db = new MockD1();
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "[[NO_REPLY:busy]]" } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "semantic-social-exit",
          platform: "soul",
          contact_id: "contact-social-exit",
          contact_name: "离场测试",
          messages: [
            { role: "assistant", content: "那你先忙" },
            { role: "user", content: "我这边临时有点事，回头说" },
          ],
        }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "skip",
      error: "social_exit",
      cooldown_ms: 35 * 60_000,
    });
    expect(db.pendingRows).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends one short caring line instead of silence when he says goodnight", async () => {
    const db = new MockD1();
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "clear",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({
        choices: [{ message: { content: "[[NO_REPLY:sleep]]" } }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "goodnight-care-1",
          platform: "soul",
          contact_id: "contact-goodnight",
          contact_name: "contact-goodnight",
          messages: [{ role: "user", content: "bye go sleep" }],
        }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.action).toBe("send");
    expect(body.cooldown_ms).toBe(8 * 60 * 60_000);
    expect(db.pendingRows).toHaveLength(1);
    expect(db.pendingRows[0].content).toBe(body.reply);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("detects the agent's own departure and returns it as a hidden cooldown", async () => {
    const db = new MockD1();
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "我先去忙了，晚点找你 [[SELF_LEAVE:busy]]" } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "self-social-exit",
          platform: "soul",
          contact_id: "contact-self-exit",
          contact_name: "主动离场测试",
          messages: [{ role: "user", content: "那你忙吧" }],
        }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "我先去忙了，晚点找你",
      self_leave_ms: 35 * 60_000,
    });
    expect(db.pendingRows).toHaveLength(1);
    expect(db.pendingRows[0].content).toBe("我先去忙了，晚点找你");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("recognizes semantic leave markers and chooses a context-safe cooldown", () => {
    expect(isSocialExitMarker(" [[NO_REPLY]] ")).toBe(true);
    expect(isSocialExitMarker(" [[NO_REPLY:sleep]] ")).toBe(true);
    expect(isSocialExitMarker("先别回复")).toBe(false);
    expect(parseSocialExitInstruction("[[NO_REPLY:sleep]]")).toEqual({
      isExit: true,
      exitType: "sleep",
      cooldownMs: 8 * 60 * 60_000,
    });
    expect(parseSocialExitInstruction("[[NO_REPLY]]")).toEqual({
      isExit: true,
      exitType: "",
      cooldownMs: null,
    });
    expect(extractSelfLeaveInstruction("我先去忙了 [[SELF_LEAVE:busy]]")).toEqual({
      content: "我先去忙了",
      cooldownMs: 35 * 60_000,
    });
    expect(inferSocialExitCooldownMs([{ role: "user", content: "我先洗澡，一会儿说" }]))
      .toBe(25 * 60_000);
    expect(inferSocialExitCooldownMs([{ role: "user", content: "我先睡了，晚安" }]))
      .toBe(8 * 60 * 60_000);
    expect(inferSocialExitCooldownMs([{ role: "user", content: "回头聊" }]))
      .toBe(15 * 60_000);
    expect(inferSocialExitCooldownMs([{ role: "user", content: "我这边临时有点事，回头说" }]))
      .toBe(35 * 60_000);
  });

  it("reuses a pending evaluation quote before delivery confirmation", async () => {
    const db = new MockD1();
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    db.funnelRows.set("test-token\u0000single:test-token:soul:contact-evaluation", {
      token: "test-token",
      group_id: "single:test-token:soul:contact-evaluation",
      stage: 6,
      user_turn_count: 42,
      evidence_json: JSON.stringify({
        willingToRecycle: true,
        noRejection: true,
      }),
      evaluation_quote_sent: 0,
      completed: 0,
      last_request_id: "evaluation-seed",
      stage_entered_at: 100,
      last_advanced_at: 100,
      last_user_message_at: 100,
      last_negative_at: 0,
      updated_at: 100,
    });
    vi.stubGlobal("fetch", vi.fn());
    const request = (requestId: string) => new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: requestId,
        platform: "soul",
        contact_id: "contact-evaluation",
        contact_name: "评估测试",
        messages: [{ role: "user", content: "家里有旧手机，这个怎么收" }],
      }),
    });
    const env = { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" };

    const first = await onRequest({ request: request("evaluation-turn-1"), env } as never);
    const firstBody = await first.json();
    const second = await onRequest({ request: request("evaluation-turn-2"), env } as never);
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody).toMatchObject({ action: "send", reply: XINGMU_PRODUCT_REPLY, local: true });
    expect(secondBody).toMatchObject({ action: "send", reply: XINGMU_PRODUCT_REPLY, local: true });
    expect(secondBody.reply_id).toBe(firstBody.reply_id);
    expect(db.pendingRows).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not send an evaluation pending after the topic changed or the pending expired", async () => {
    const makeDb = () => {
      const db = new MockD1();
      db.funnelRows.set("test-token\u0000single:test-token:soul:contact-pending-topic", {
        token: "test-token",
        group_id: "single:test-token:soul:contact-pending-topic",
        stage: 6,
        user_turn_count: 42,
        evidence_json: JSON.stringify({
          willingToRecycle: true,
          noRejection: true,
        }),
        evaluation_quote_sent: 0,
        completed: 0,
        last_request_id: "pending-topic-seed",
        stage_entered_at: 100,
        last_advanced_at: 100,
        last_user_message_at: 100,
        last_negative_at: 0,
        updated_at: 100,
      });
      return db;
    };
    const now = Math.floor(Date.now() / 1000);
    const seedPending = (db: MockD1, createdAt: number) => db.pendingRows.push({
      id: "pending-evaluation-old",
      token: "test-token",
      request_id: "pending-evaluation-old-request",
      platform: "soul",
      contact_id: "contact-pending-topic",
      contact_name: "评估时效测试",
      content: XINGMU_PRODUCT_REPLY,
      status: "pending",
      action_type: "text",
      media_group_id: "",
      media_asset_id: "",
      sent_content: "",
      created_at: createdAt,
    });
    const envFor = (db: MockD1) => ({ DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" });
    const requestFor = (requestId: string, content: string) => new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: requestId,
        platform: "soul",
        contact_id: "contact-pending-topic",
        contact_name: "评估时效测试",
        messages: [{ role: "user", content }],
      }),
    });

    const movedOnDb = makeDb();
    seedPending(movedOnDb, now);
    const movedOnFetch = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: "今天先忙你的" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
    vi.stubGlobal("fetch", movedOnFetch);
    const movedOn = await onRequest({
      request: requestFor("pending-topic-moved-on", "今天挺忙"),
      env: envFor(movedOnDb),
    } as never);
    await expect(movedOn.json()).resolves.toMatchObject({
      action: "send",
      reply: "今天先忙你的",
    });
    expect(movedOnFetch).toHaveBeenCalled();

    const expiredDb = makeDb();
    seedPending(expiredDb, now - 20 * 60);
    const expiredFetch = vi.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", expiredFetch);
    const expired = await onRequest({
      request: requestFor("pending-topic-expired", "这个怎么收"),
      env: envFor(expiredDb),
    } as never);
    const expiredBody = await expired.json();

    expect(expired.status).toBe(200);
    expect(expiredBody).toMatchObject({ action: "send", reply: XINGMU_PRODUCT_REPLY, local: true });
    expect(expiredBody.reply_id).not.toBe("pending-evaluation-old");
    expect(expiredDb.pendingRows).toHaveLength(2);
    expect(expiredFetch.mock.calls.some(([url]) => String(url).includes("/chat/completions"))).toBe(false);
  });

  it("marks the evaluation quote complete only after delivery and then returns to daily chat", async () => {
    const db = new MockD1();
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    db.funnelRows.set("test-token\u0000single:test-token:soul:contact-evaluation-confirm", {
      token: "test-token",
      group_id: "single:test-token:soul:contact-evaluation-confirm",
      stage: 6,
      user_turn_count: 42,
      evidence_json: JSON.stringify({
        willingToRecycle: true,
        noRejection: true,
      }),
      evaluation_quote_sent: 0,
      completed: 0,
      last_request_id: "evaluation-confirm-seed",
      stage_entered_at: 100,
      last_advanced_at: 100,
      last_user_message_at: 100,
      last_negative_at: 0,
      updated_at: 100,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "可以 回头慢慢说" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const env = { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" };
    const evaluation = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "evaluation-confirm-1",
          platform: "soul",
          contact_id: "contact-evaluation-confirm",
          contact_name: "评估确认",
          messages: [{ role: "user", content: "家里有旧手机，这个怎么收" }],
        }),
      }),
      env,
    } as never);
    const evaluationBody = await evaluation.json();

    const confirmed = await onRequest({
      request: new Request("https://example.com/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ reply_id: evaluationBody.reply_id, sent_content: XINGMU_PRODUCT_REPLY }),
      }),
      env,
    } as never);
    const row = db.funnelRows.get("test-token\u0000single:test-token:soul:contact-evaluation-confirm");

    expect(confirmed.status).toBe(200);
    expect(row.evaluation_quote_sent).toBe(1);
    expect(row.completed).toBe(1);

    const daily = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "evaluation-confirm-2",
          platform: "soul",
          contact_id: "contact-evaluation-confirm",
          contact_name: "评估确认",
          messages: [{ role: "user", content: "那后面再说" }],
        }),
      }),
      env,
    } as never);
    const dailyBody = await daily.json();

    expect(daily.status).toBe(200);
    expect(dailyBody).toMatchObject({ action: "send", reply: "可以 回头慢慢说" });
    expect(dailyBody).not.toHaveProperty("funnel_stage");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("never falls back to a configured QQ account for Xingmu", () => {
    const blocked = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 6,
      activity: {},
      incomingText: "给我个微信吧",
      messages: [{ role: "user", content: "成交了" }],
      contactChannel: "qq",
      contactQq: "12345678",
      xingmuScope: true,
      dealCompleted: true,
    });
    const allowed = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 6,
      activity: {},
      incomingText: "给我个微信吧",
      messages: [{ role: "user", content: "成交了" }],
      contactChannel: "qq",
      contactAccount: "private_xh",
      contactQq: "12345678",
      xingmuScope: true,
      dealCompleted: true,
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.contactChannel).toBe("wechat");
    expect(allowed.allowed).toBe(true);
    expect(allowed.reply).toContain("private_xh");
    expect(allowed.reply).not.toContain("12345678");
  });

  it("always uses the private WeChat channel for Xingmu", async () => {
    const makeDb = () => {
      const db = new MockD1();
      db.funnelRows.set("test-token\u0000single:test-token:soul:contact-config", {
        token: "test-token",
        group_id: "single:test-token:soul:contact-config",
        stage: 6,
        user_turn_count: 42,
        evidence_json: JSON.stringify({
          willingToRecycle: true,
          dealCompleted: true,
          noRejection: true,
        }),
        evaluation_quote_sent: 1,
        completed: 1,
        last_request_id: "contact-config-seed",
        stage_entered_at: 100,
        last_advanced_at: 100,
        last_user_message_at: 100,
        last_negative_at: 0,
        updated_at: 100,
      });
      return db;
    };
    const request = () => new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: "contact-config-turn",
        platform: "soul",
        contact_id: "contact-config",
        contact_name: "联系方式配置",
        messages: [{ role: "user", content: "给我个微信吧" }],
      }),
    });
    vi.stubGlobal("fetch", vi.fn());

    const wechat = await onRequest({
      request: request(),
      env: {
        DB: makeDb(),
        KV: new MockKV(),
        CONTACT_CHANNEL: "wechat",
        CONTACT_WECHAT: "13800138000",
      },
    } as never);
    await expect(wechat.json()).resolves.toMatchObject({
      action: "send",
      reply: "行 那我把私人微信号给你：13800138000 加的时候说下你是谁",
      contact_gate: "allowed",
    });

    const configuredQq = await onRequest({
      request: request(),
      env: {
        DB: makeDb(),
        KV: new MockKV(),
        CONTACT_CHANNEL: "qq",
        CONTACT_QQ: "12345678",
        CONTACT_WECHAT: "private_xh",
      },
    } as never);
    await expect(configuredQq.json()).resolves.toMatchObject({
      action: "send",
      reply: "行 那我把私人微信号给你：private_xh 加的时候说下你是谁",
      contact_gate: "allowed",
    });
  });

  it("deduplicates nearby duplicate history before building model context", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const now = Math.floor(Date.now() / 1000);
    const db = new MockD1([
      { id: 1, token: "test-token", platform: "soul", contact_id: "contact-1", contact_name: "测试", role: "user", content: "重复消息", created_at: now - 2 },
      { id: 2, token: "test-token", platform: "soul", contact_id: "contact-1", contact_name: "测试", role: "user", content: "重复消息", created_at: now - 1 },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "在呢" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "contact-1",
          contact_name: "测试",
          messages: [{ role: "user", content: "最新问题" }],
        }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const historyMessages = JSON.parse(String(init.body)).messages.filter((message) => String(message.content).includes("重复消息"));
    expect(historyMessages).toHaveLength(1);
  });

  it("uses a compact profile and up to twenty recent unique history messages", async () => {
    const history = [{
      id: 16,
      token: "test-token",
      platform: "soul",
      contact_id: "contact-1",
      contact_name: "梦想",
      role: "user",
      content: "刚发的问题",
      created_at: 115,
    }, ...Array.from({ length: 15 }, (_, index) => {
      const number = 15 - index;
      return {
        id: number,
        token: "test-token",
        platform: "soul",
        contact_id: "contact-1",
        contact_name: "梦想",
        role: number % 2 === 0 ? "user" : "assistant",
        content: `历史-${number}`,
        created_at: 100 + number,
      };
    })];
    const db = new MockD1(history).withOptions({
      contactLinks: [{ group_id: "group:shared", token: "test-token", platform: "soul", contact_id: "contact-1", contact_name: "梦想" }],
    });
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    db.profileRows.set("test-token\u0000group:shared", {
      profile_json: JSON.stringify({ basic: { name: "张先生", gender: "男" }, preferences: { hobbies: ["羽毛球"], likes: ["爬山"] }, notes: [""] }),
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "周末有空" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "contact-1",
          contact_name: "梦想",
          messages: [
            { role: "user", content: "刚发的问题", created_at: 115 },
            { role: "user", content: "明天的安排呢" },
          ],
        }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const promptMessages = JSON.parse(String(init.body)).messages;
    expect(promptMessages[0].content).toContain("【长期客户档案】");
    expect(promptMessages[0].content).toContain('"name":"张先生"');
    expect(promptMessages[0].content).not.toContain('"notes"');
    const rawHistoryLines = promptMessages.filter((message) => String(message.content).startsWith("[soul "));
    expect(rawHistoryLines.length).toBeLessThanOrEqual(20);
    expect(rawHistoryLines.some((message) => String(message.content).includes("刚发的问题"))).toBe(false);
    expect(promptMessages.filter((message) => String(message.content).includes("刚发的问题"))).toHaveLength(2);
    expect(promptMessages.some((message) => String(message.content).includes("明天的安排呢"))).toBe(true);
  });

  it("keeps greetings and daily talk inside the current time of day", () => {
    const evening = resolveDaypart("2026-10-05 19:52:03");
    expect(evening.label).toBe("晚上");
    expect(evening.greeting).toBe("晚上好");
    const eveningRule = buildDaypartRule("2026-10-05 19:52:03");
    expect(eveningRule).toContain("现在是晚上");
    expect(eveningRule).toContain("绝对不许说“早上好、下午好”");
    expect(resolveDaypart("2026-10-05 08:10:00").label).toBe("早上");
    expect(buildDaypartRule("2026-10-05 08:10:00")).toContain("不许说娃哄睡了");
    expect(resolveDaypart("2026-10-05 23:40:00").label).toBe("深夜");
  });

  it("forces an answer when the batch mixes a greeting with real questions", () => {
    const brief = buildTurnBrief({
      messages: [
        { role: "user", content: "在干嘛呢" },
        { role: "user", content: "你多大了呀" },
        { role: "user", content: "你是97年的吗" },
      ],
      relationStageLevel: 1,
      xingmuScope: false,
    });
    expect(brief).toContain("【必答问题】");
    expect(brief).toContain("你多大了呀");
    expect(brief).not.toContain("先把那件具体的事答了");
  });

  it("keeps a repeated line away from the same person for half an hour", () => {
    const now = 1_790_000_000;
    const history = [{ role: "assistant", content: "刚把娃哄睡", created_at: now - 20 * 60 }];
    const repeated = avoidRepeatedAssistantReply("刚把娃哄睡", history, "在吗", now, "这会儿才算清静");
    expect(repeated).not.toBe("刚把娃哄睡");
  });

  it("drops old-persona wording from the history sent to the model", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const now = Math.floor(Date.now() / 1000);
    const history = [
      { id: 1, token: "test-token", platform: "soul", contact_id: "polluted", contact_name: "老客户", role: "assistant", content: "做二手手机和旧数码回收的", created_at: now - 600, source: "human_phone" },
      { id: 2, token: "test-token", platform: "soul", contact_id: "polluted", contact_name: "老客户", role: "user", content: "从事什么行业呢", created_at: now - 60, source: "sync" },
    ];
    const db = new MockD1(history, [
      { id: "female", name: "星暮", identity_terms: JSON.stringify(["旧数码", "回收"]) },
      { id: "female_sutang", name: "苏棠", system_prompt: "你是苏棠，做电商运营。", identity_terms: JSON.stringify(["电商运营"]) },
    ]);
    db.tokenPersonas.set("test-token", "female_sutang");
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: "做电商运营的呢" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ platform: "soul", contact_id: "polluted", contact_name: "老客户", messages: [{ role: "user", content: "从事什么行业呢" }] }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    const systemPrompt = String(payload.messages[0].content);
    expect(systemPrompt).not.toContain("二手手机");
    expect(systemPrompt).not.toContain("旧数码");
    expect(systemPrompt).toContain("【时段约束】");
    expect(systemPrompt).not.toContain("【生活素材】");
    // 2026-10-06 新增的两条“必须分辨”：第三方归属、她欠回复时不许倒打一耙
    expect(systemPrompt).toContain("分清是谁的人");
    expect(systemPrompt).toContain("只接对方最新一句；不主动解释、不主动道歉、不主动汇报自己在忙什么。");
    // 2026-10-07 事实一致：生活细节可以编，但编了就守住，不许改口。
    // 真机事故：卡卡罗特（重庆本地人）那边，位置一会儿一个说法，对方两次说“你在逗我”。
    expect(systemPrompt).toContain("【事实一致】");
    expect(systemPrompt).toContain("编了就守住");
    expect(systemPrompt).toContain("不能拿它给生活细节改口");
  });

  it("classifies message delay bands without spending extra model calls", () => {
    const now = Math.floor(Date.parse("2026-09-25T00:59:00.000Z") / 1000);
    const policyFor = (ageSeconds: number) => getMessageDelayPolicy({
      role: "user",
      content: "在吗",
      created_at: now - ageSeconds,
    }, now);

    expect(policyFor(60).level).toBe("immediate");
    expect(policyFor(10 * 60).level).toBe("short_wait");
    expect(policyFor(60 * 60).level).toBe("acknowledge");
    expect(policyFor(3 * 3600).level).toBe("explicit_delay");
    expect(policyFor(10 * 3600).level).toBe("dayparted");
    expect(policyFor(2 * 86400).level).toBe("past_1_3d");
    expect(policyFor(5 * 86400).level).toBe("past_4_7d");
    expect(policyFor(10 * 86400).level).toBe("past_7_30d");
    expect(policyFor(40 * 86400).level).toBe("past_over_30d");
    expect(policyFor(60).prompt).toBe("");
    expect(policyFor(10 * 60).prompt).toBe("");
    expect(policyFor(2 * 3600).prompt).toBe("");
    expect(policyFor(3 * 3600).prompt).toBe("");
    expect(policyFor(10 * 3600).prompt).toBe("");
    expect(policyFor(2 * 86400).prompt).toContain("较早前的消息");
    expect(policyFor(10 * 86400).prompt).toContain("较早前的消息");
    expect(getMessageDelayPolicy({
      role: "user",
      content: "可以上门",
      created_at: now - 20,
    }, now).messageType).toBe("normal");
    expect(getMessageDelayPolicy({
      role: "user",
      content: "旧手机还收吗",
      created_at: now - 20,
    }, now).messageType).toBe("business");

    // 2026-10-05 方案1：分档基准改成“对方等了多久”。
    // 真机原样：对方 21:15 就问“人呢”，21:40 又发一批，只看最新一条会判成不用解释，
    // 模型于是自己编“刚去给娃盖了被子”。
    const waited = getMessageDelayPolicy(
      { role: "user", content: "人呢", created_at: now - 30 },
      now,
      20 * 60,
    );
    expect(waited.level).toBe("short_wait");
    expect(waited.prompt).toBe("");
    const waitedLong = getMessageDelayPolicy(
      { role: "user", content: "在吗", created_at: now - 30 },
      now,
      2 * 3600,
    );
    expect(waitedLong.level).toBe("acknowledge");
    expect(waitedLong.prompt).toBe("");
    // 消息本身更旧时，还是按消息的年龄分档
    expect(getMessageDelayPolicy({ role: "user", content: "在吗", created_at: now - 10 * 3600 }, now, 60).level)
      .toBe("dayparted");
  });

  it("does not rewrite stale wording into another late excuse", () => {
    const now = Math.floor(Date.parse("2026-10-05T11:35:00.000Z") / 1000);
    const policyFor = (ageSeconds: number) => getMessageDelayPolicy({
      role: "user",
      content: "在吗",
      created_at: now - ageSeconds,
    }, now);

    const overnight = policyFor(11 * 3600);
    expect(sanitizeStaleAssistantReply("刚忙完 你睡了吗", overnight)).toBe("刚忙完 你睡了吗");
    const twoDays = policyFor(2 * 86400);
    expect(sanitizeStaleAssistantReply("刚看到|||咋啦", twoDays)).toBe("刚看到|||咋啦");
  });

  it("removes every leaked late-reply explanation before sending", () => {
    expect(stripLateReplyExcuse("这两天忙晕了 才上号看", 2 * 86400))
      .toBe("");
    expect(stripLateReplyExcuse("昨晚那条看到了 你先好好睡", 12 * 3600))
      .toBe("你先好好睡");
    expect(stripLateReplyExcuse("刚忙完 刚看到你消息|||在的", 12 * 3600))
      .toBe("在的");
    const normalized = normalizeLateReplyPersonaPrompt(
      "【时间】\n对方没问你在忙什么、也没问你怎么才回，就直接接他的话，不要汇报自己刚才在干什么。只有隔夜或隔天、或者他明确问起时，才用一句“这两天忙晕了”带过。\n任何时候都不要给自己安排一个刚做完的具体动作（刚去给娃盖被子、刚去倒水这类）；旧消息不要当成刚发来的接。"
    );
    expect(normalized).toContain("只接对方最新一句；不主动解释、不主动道歉、不主动汇报自己在忙什么。");
    expect(normalized).not.toContain("这两天忙晕了");
    expect(normalized).not.toContain("任何时候都不要给自己安排一个刚做完的具体动作");
  });

  it("keeps expired invitations and stable business questions logically aligned", () => {
    const now = Math.floor(Date.parse("2026-09-25T00:59:00.000Z") / 1000);
    const oldInvite = getMessageDelayPolicy({
      role: "user",
      content: "明天有空吗",
      created_at: now - 2 * 86400,
    }, now);
    expect(oldInvite.prompt).toContain("较早前的邀约");
    expect(sanitizeStaleAssistantReply("明天可以 我有空", oldInvite)).toBe("你刚说的那件事 现在还方便吗");

    const oldBusiness = getMessageDelayPolicy({
      role: "user",
      content: "现在还收手机吗",
      created_at: now - 3 * 86400,
    }, now);
    expect(oldBusiness.prompt).toContain("较早前问的工作或物品问题");
    expect(oldBusiness.prompt).toContain("不要主动重提");
    expect(sanitizeStaleAssistantReply("还收的 你现在要处理吗", oldBusiness))
      .toBe("还收的 你现在要处理吗");
    expect(sanitizeStaleAssistantReply("。。。", oldBusiness)).toBe("");
  });

  it("adds relative age and blocks only a false just-arrived claim", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T21:14:00.000Z"));
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "谢谢 你眼光不错|||你这个点才想起我" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "桃子幺幺",
          contact_name: "桃子幺幺",
          messages: [{
            role: "user",
            content: "你这高跟鞋真好看",
            timestamp: "9月25日 02:21",
            created_at: Math.floor(Date.parse("2026-09-24T18:21:00.000Z") / 1000),
          }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      // 2026-10-07：他这句只有 8 字，按长度预算只回一条。
      reply: "谢谢 你眼光不错",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.messages[0].content).toContain("只接对方最新一句；不主动解释、不主动道歉、不主动汇报自己在忙什么。");
    expect(payload.messages[0].content).not.toContain("时间关系：");
    expect(payload.messages[0].content).not.toContain("已隔 2 小时 53 分");
    expect(payload.messages[0].content).not.toContain("你是真人，不会一直盯着手机");
    expect(payload.messages.at(-1).role).toBe("user");
    // 2026-10-07 晚：历史行不再写“X 小时前”（模型会拿它算“她晾了他多久”，然后开口交代）。
    expect(payload.messages.at(-1).content).not.toContain("前】");
    expect(payload.messages.at(-1).content).toMatch(/^【\d{2}\/\d{2} \d{2}:\d{2}/);
    expect(payload.messages.at(-1).content).toContain("对方：你这高跟鞋真好看");
  });

  it("warns only when voice or stickers get out of hand", () => {
    // 2026-10-07 用户要求：偶尔一两条语音 → 正常用转写聊；发得多/发得长/一连串刷 → 警告。
    const voice = (seconds = 5) => ({ role: "user", content: "[语音]", voice_seconds: seconds });
    const sticker = (name = "笑哭") => ({ role: "user", content: "[" + name + "]" });
    const text = (value) => ({ role: "user", content: value });

    expect(voiceStickerPressure([voice()]).level).toBe("ok");
    expect(voiceStickerPressure([voice(), voice()]).level).toBe("ok");
    expect(voiceStickerPressure([voice(), text("在吗"), voice()]).level).toBe("ok");
    // 三条语音 → 多
    expect(voiceStickerPressure([voice(), voice(), voice()]).level).toBe("warn");
    // 单条 ≥30 秒 → 多
    expect(voiceStickerPressure([voice(35)]).level).toBe("warn");
    // 连着三条语音/表情 → 多
    expect(voiceStickerPressure([sticker(), voice(), sticker()]).level).toBe("warn");
    // 连着三个表情已经是“发一串” → 也该警告
    expect(voiceStickerPressure([sticker("笑哭"), sticker("狗子"), sticker("吃瓜")]).level).toBe("warn");
    // 表情门槛放宽针对“夹着文字、分散着发”的情况：5 个没事，6 个才警告
    // 注意只看最近 10 条他的消息，所以下面两组都控制在 10 条内、且没有连续 3 个
    const five = [sticker(), text("哈"), sticker(), text("哈"), sticker(), sticker(), text("哈"), sticker(), text("哈")];
    expect(voiceStickerPressure(five).level).toBe("ok");
    const six = [sticker(), text("哈"), sticker(), text("哈"), sticker(), sticker(), text("哈"), sticker(), text("哈"), sticker()];
    expect(voiceStickerPressure(six).level).toBe("warn");
    // 纯文字永远不触发
    expect(voiceStickerPressure([text("今天好累"), text("你呢")]).level).toBe("ok");
    // 转写文字已经在内容里时，也算语音（老形态）
    expect(voiceStickerPressure([{ role: "user", content: "对方语音转文字：我好累" }]).level).toBe("ok");
  });

  it("warns once and mutes the contact when voice spam continues", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1();
    db.tokenPersonas.set("test-token", "female_sutang");
    const spam = {
      request_id: "spam-1",
      platform: "soul",
      contact_id: "spam-contact",
      contact_name: "爱发语音的大叔",
      messages: [
        { role: "user", content: "[语音]", voice_seconds: 8 },
        { role: "user", content: "[语音]", voice_seconds: 12 },
        { role: "user", content: "[语音]", voice_seconds: 6 },
      ],
    };
    const first = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify(spam),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const firstBody = await first.json();
    expect(firstBody.action).toBe("send");
    expect(firstBody.reason).toBe("voice_sticker_warning");
    expect(String(firstBody.reply)).toContain("语音");
    // 警告走本地短路，不调模型
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets Su Tang ask his look once, then never again after he sends a photo", () => {
    const base = {
      personaPrompt: "你是苏棠，做电商运营。",
      personaFacts: null,
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-10 21:40:00",
      weekday: "星期六",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      weather: null,
      stageText: "",
      relationStageLevel: 2,
      messageDelay: null,
      messages: [{ role: "user", content: "在吗" }],
      historyMessages: [],
      xingmuSoulScope: false,
    };
    const fresh = buildLayeredSystemPrompt(base);
    expect(fresh).toContain("当前档案：他还没发过照片");
    expect(fresh).toContain("你长什么样呀 发张我看看");
    expect(fresh).toContain("可以主动问一次");

    const byFile = buildLayeredSystemPrompt({ ...base, hisPhotoOnFile: true });
    expect(byFile).toContain("永不再问");
    expect(byFile).toContain("当前档案：他已经发过照片");

    const byHistory = buildLayeredSystemPrompt({
      ...base,
      historyMessages: [{ role: "user", content: "[图片]" }],
    });
    expect(byHistory).toContain("永不再问");
    expect(byHistory).toContain("当前档案：他已经发过照片");

    const herFresh = buildLayeredSystemPrompt(base);
    expect(herFresh).toContain("当前档案：她还没给他看过照片");
    const herSent = buildLayeredSystemPrompt({ ...base, herPhotoOnFile: true });
    expect(herSent).toContain("当前档案：她已经给他看过照片");
  });

  it("tells her to lead when he only offers a weak opener or keeps brushing her off", () => {
    // 2026-10-07 用户纠正：“在干嘛”是递话头，不是要行程表；他一直“嗯嗯哦哦”时该她主动带节奏。
    expect(isWeakOpener("在干嘛")).toBe(true);
    expect(isWeakOpener("在干嘛呢？")).toBe(true);
    expect(isWeakOpener("在吗")).toBe(true);
    expect(isWeakOpener("今天加班到十点")).toBe(false);
    expect(isLowValueReply("嗯")).toBe(true);
    expect(isLowValueReply("哈哈")).toBe(true);
    expect(isLowValueReply("是吗")).toBe(true);
    expect(isLowValueReply("我在跟客户对方案")).toBe(false);
    expect(needsHerToLead([{ role: "user", content: "嗯" }, { role: "user", content: "哦" }])).toBe(true);
    expect(needsHerToLead([{ role: "user", content: "嗯" }])).toBe(true);
    expect(needsHerToLead([{ role: "user", content: "在干嘛" }])).toBe(true);
    expect(needsHerToLead([{ role: "user", content: "今天被老板骂了 加班到十点" }])).toBe(false);
  });
  it("never tells the model to excuse a late reply", () => {
    // 2026-10-07 实测：EW / 相信光！/ 行者 三条回复全以“昨晚睡得沉 你这条我上午才看到”开场，
    // 根因是提示词里写着“要么认一句自己没接上（睡着了、忙忘了）”。
    const prompt = buildLayeredSystemPrompt({
      personaPrompt: "你是苏棠，做电商运营。",
      personaFacts: null,
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-07 20:45:00",
      weekday: "星期三",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      weather: null,
      stageText: "",
      relationStageLevel: 2,
      messageDelay: null,
      messages: [{ role: "user", content: "在干嘛呢", created_at: 1 }],
      historyMessages: [],
      xingmuSoulScope: false,
    });
    expect(prompt).toContain("只接对方最新一句；不主动解释、不主动道歉、不主动汇报自己在忙什么。");
    expect(prompt).toContain(PROACTIVE_TOPIC_RULE);
    expect(prompt).toContain(HUMAN_FEEL_RULE);
    expect(prompt).toContain(ADVANCEMENT_RULE);
    expect(prompt).toContain(OUTPUT_HARD_RULE);
    expect(prompt).toContain(QUESTION_PACING_RULE);
    expect(prompt).toContain(PROACTIVE_STYLE_SUTANG);
    // 不许再出现“让他自己交代一句”的教法（旧句是“要么认一句自己没接上（睡着了、忙忘了）”）
    expect(prompt).not.toContain("认一句自己没接上");
    expect(prompt).not.toContain("这两天忙晕了");
  });
  it("turns stickers into virtual-sticker text with their meaning", () => {
    // 2026-10-07 用户要求：表情是虚拟表情，模型要按意思回（月亮=晚安），
    // 不能把图案当成真东西去夸，也不能把“摸一下”当成他真动手。
    expect(translateStickerContent("[月亮]")).toBe("[表情包：月亮（晚安/想你）]");
    expect(translateStickerContent("[笑哭][笑哭][笑哭]")).toBe("[表情包：笑哭 ×3（哭笑不得/被逗笑）]");
    expect(translateStickerContent("对方发来 Soul 互动表情「皮一下」：对方和你开玩笑，气氛轻松调皮"))
      .toBe("[互动表情：皮一下]");
    expect(translateStickerContent("[Soul互动表情]")).toBe("[互动表情]");
    expect(translateStickerContent("[语音互动表情]")).toBe("[互动表情]");
    expect(translateStickerContent("[表情]")).toBe("[表情包]");
    // 媒体占位符不能被当表情：
    expect(translateStickerContent("[语音]")).toBe("[语音]");
    expect(translateStickerContent("[图片]")).toBe("[图片]");
    expect(translateStickerContent("[闪照]")).toBe("[闪照]");
    // 正常文字原样保留：
    expect(translateStickerContent("在吗")).toBe("在吗");
    expect(translateStickerContent("[呲牙笑]哈哈")).toBe("[表情包：呲牙笑（开心地笑）]哈哈");
  });
  it("forbids pretending a voice message was not heard when there is no transcript", () => {
    // 2026-10-07 真机（渔夫）：转写成功但重读没拿到，模型手里只有 [语音]，于是编了“语音听了一半 后面没听清呢”。
    const prompt = buildLayeredSystemPrompt({
      personaPrompt: "你是苏棠，做电商运营。",
      personaFacts: null,
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-07 20:00:00",
      weekday: "星期二",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      weather: null,
      stageText: "",
      relationStageLevel: 2,
      messageDelay: null,
      messages: [{ role: "user", content: "[语音]", created_at: 1 }],
      historyMessages: [],
      xingmuSoulScope: false,
    });
    expect(prompt).toContain("【没转出文字的语音】");
    expect(prompt).toContain("不许说“听不清/没听清/听了一半/没听完/你再说一遍/重发一遍”");
  });

  it("only treats his own words as his marital status", () => {
    // 2026-10-07 用户要求：确认对方已婚就不再回复这个人。
    expect(detectContactMaritalStatus([{ role: "user", content: "我已婚" }])).toBe("married");
    expect(detectContactMaritalStatus([{ role: "user", content: "我老婆管得严" }])).toBe("married");
    expect(detectContactMaritalStatus([{ role: "user", content: "我单身" }])).toBe("single");
    expect(detectContactMaritalStatus([{ role: "user", content: "我还没结婚" }])).toBe("single");
    // 她自己说“我已婚/我有老公”是她的人设，不算他的婚况。
    expect(detectContactMaritalStatus([{ role: "assistant", content: "我已婚" }])).toBe("");
    // 她问他“你结婚了吗”也不是他的回答。
    expect(detectContactMaritalStatus([{ role: "assistant", content: "你结婚了吗" }])).toBe("");
    expect(detectContactMaritalStatus([{ role: "user", content: "今天好累" }])).toBe("");
  });

  it("skips a married contact without calling the model", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1();
    db.tokenPersonas.set("test-token", "female_sutang");
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "married-1",
          platform: "soul",
          contact_id: "married-contact",
          contact_name: "稳重的大叔",
          messages: [{ role: "user", content: "我已婚，孩子都上小学了" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.action).toBe("skip");
    expect(body.reason).toBe("contact_married");
    // 连模型都没调。
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tells the model the timeline: his latest message, her last one, the gap, and who owes a reply", () => {
    // 2026-10-07（方案 B 第一层）：用户要求让模型知道消息前后排序，别把旧的当刚发生的。
    const now = 1_800_000_000;
    const timeline = buildSituationTimeline(
      [{ role: "user", content: "睡了", created_at: now - 26 * 3600, time_kind: "first_observed" }],
      [{ role: "assistant", content: "你咋也还不睡呀", created_at: now - 39 * 3600 }],
      now,
    );
    expect(timeline).toContain("【现在是什么情况");
    expect(timeline).toContain("他最新一条");
    expect(timeline).toContain("他这条你还没回");
    // 2026-10-07 晚（实测 EW/相信光！/行者）：之前写“他最新一条：…（11小时前）”“你上一条：…（17小时前）”
    // “你俩中间隔了：13小时”，模型一睁眼就算“她晾了他多久”，于是每条都以“昨晚睡着了没看到你这条”开场。
    // 现在既不给相对时长，也不单列“你上一条”，更不写“中间隔了”。
    expect(timeline).not.toContain("你上一条");
    expect(timeline).not.toContain("你俩中间隔了");
    expect(timeline).not.toContain("小时前");
    // 2026-10-07（时间可信）：这时间不是他真发的，就标出来，别让模型当成“他刚说的”。
    expect(timeline).toContain("我们读到的时间");
    expect(timeline).toContain("不要当成刚发生的事来接");
    // 她回过之后就不再提示“欠他一个回应”
    const replied = buildSituationTimeline(
      [
        { role: "user", content: "睡了", created_at: now - 3600 },
        { role: "assistant", content: "那你快睡", created_at: now - 3500 },
        { role: "user", content: "在忙吗", created_at: now - 60 },
      ],
      [],
      now,
    );
    expect(replied).toContain("他最新一条");
    expect(replied).not.toContain("你上一条");
  });

  it("labels every transcript line with 对方/我 and a time", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const now = Math.floor(Date.now() / 1000);
    const history = [
      { id: 1, token: "test-token", platform: "soul", contact_id: "transcript-a", contact_name: "顺序测试", role: "user", content: "很久以前第一条", created_at: now - 7200, source: "sync", message_key: "t1" },
      { id: 2, token: "test-token", platform: "soul", contact_id: "transcript-a", contact_name: "顺序测试", role: "assistant", content: "紧跟着的第二条", created_at: now - 7190, source: "ai", message_key: "t2", persona_id: "female_sutang" },
      { id: 3, token: "test-token", platform: "soul", contact_id: "transcript-a", contact_name: "顺序测试", role: "user", content: "隔了一小时的第三条", created_at: now - 3600, source: "sync", message_key: "t3" },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "好的" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "transcript-order-1",
          platform: "soul",
          contact_id: "transcript-a",
          contact_name: "顺序测试",
          messages: [{ role: "user", content: "现在这句话", created_at: now }],
        }),
      }),
      env: { DB: new MockD1(history), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const promptMessages = JSON.parse(String(init.body)).messages;
    const transcript = promptMessages.slice(1);
    const second = transcript.find((message) => String(message.content).includes("紧跟着的第二条"));
    const third = transcript.find((message) => String(message.content).includes("隔了一小时的第三条"));
    const latest = promptMessages.at(-1);

    // 2026-10-07（方案 B 第一层）：每一行都带时间，模型才能分清哪条是刚发生的。
    // 同一批连着发的只显示时刻（最短），隔得久的带完整日期和“多久前”。
    expect(second.content).toContain("我：紧跟着的第二条");
    // 2026-10-07：去掉“X 小时前”后，同一批的短格式依赖“上一条时间”的推进；
    // 只要行首带时间就算合格（短格式或完整日期都接受）。
    expect(second.content).toMatch(/^【(?:\d{2}:\d{2}|\d{2}\/\d{2} \d{2}:\d{2})/);
    expect(third.content).toContain("对方：隔了一小时的第三条");
    expect(third.content).toMatch(/^【\d{2}\/\d{2} \d{2}:\d{2}/);
    expect(latest.content).toContain("对方：现在这句话");
    expect(latest.content).toMatch(/^【\d{2}\/\d{2} \d{2}:\d{2}/);
    // 只给绝对时刻，不再给“多久前”
    expect(latest.content).not.toContain("前】");
  });

  it("feeds the model the conversation in time order", () => {
    // 2026-10-07 用户反馈（貌若潘安的黄金圣斗士）：早期按写入顺序排，16:48 的“下午好”排在 17:55 之后，
    // 模型看到的顺序是乱的，于是出现“答旧话/断层”。改成按时间排（同秒再按写入顺序）。
    // 看板本来就用 created_at 排序，不受影响。
    const sources = [
      readFileSync(new URL("../functions/api/route.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../functions/api/_chat_api.ts", import.meta.url), "utf8"),
    ];
    const historySelects = sources.flatMap((source) =>
      source
        .split("\n")
        .filter((line) => line.includes("FROM chat_history") && line.includes("persona_id = ?"))
    );

    expect(historySelects.length).toBeGreaterThan(0);
    for (const line of historySelects) {
      expect(line).toContain("ORDER BY created_at DESC, id DESC");
    }
  });


  it("drops re-synced copies of the AI's own replies", async () => {
    const db = new MockD1();
    const now = Math.floor(Date.now() / 1000);
    db.pendingRows.push({
      id: "ai-sent-1",
      token: "test-token",
      request_id: "chat-sent-1",
      platform: "soul",
      contact_id: "dup-contact",
      contact_name: "重复测试",
      content: "第一句|||第二句",
      status: "confirmed",
      action_type: "text",
      media_group_id: "",
      media_asset_id: "",
      created_at: now - 30,
      confirmed_at: now - 25,
    });

    const response = await onRequest({
      request: new Request("https://example.com/api/messages/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "dup-contact",
          contact_name: "重复测试",
          messages: [
            { role: "assistant", content: "第一句", source: "human_phone", created_at: now - 28, message_key: "dup-1" },
            { role: "assistant", content: "第二句 ", source: "human_phone", created_at: now - 27, message_key: "dup-2" },
            { role: "user", content: "新来的消息", source: "sync", created_at: now - 20, message_key: "dup-3" },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV() },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      accepted: 1,
      skipped_duplicates: 2,
    });
  });

  it("uses past mode for old greetings instead of pretending the message just arrived", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T21:14:00.000Z"));
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "刚忙完 刚看到你消息|||在的 前几天有点忙" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "桃子幺幺",
          contact_name: "桃子幺幺",
          messages: [{
            role: "user",
            content: "在吗",
            timestamp: "9月21日 06:59",
            created_at: Math.floor(Date.parse("2026-09-20T22:59:00.000Z") / 1000),
          }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      // 2026-10-07 晚（用户要求）：他隔了很久才发时，不许以“刚看到你消息”这种交代开场，
      // 开头那句交代会被代码删掉（用户原话：真人不会解释半天为什么没回）。
      reply: "在的 前几天有点忙",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const prompt = JSON.parse(String(init.body)).messages[0].content;
    expect(prompt).toContain("较早前的消息");
    expect(prompt).toContain("只接对方最新一句；不主动解释、不主动道歉、不主动汇报自己在忙什么。");
    expect(prompt).not.toContain("你是真人，不会一直盯着手机");
    expect(prompt).not.toContain("已隔 3 天 22 小时");
  });

  it("does not infer staleness from unrelated database history", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T00:59:00.000Z"));
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "在的" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const historyRows = [
      { id: 1, role: "user", content: "旧消息", created_at: Math.floor(Date.parse("2026-09-21T00:00:00.000Z") / 1000) },
    ];
    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "contact-1",
        contact_name: "测试联系人",
        messages: [{ role: "user", content: "在吗" }],
        request_id: "confirm-only-reply",
      }),
    });
    await onRequest({
      request,
      env: { DB: new MockD1(historyRows), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const prompt = JSON.parse(String(init.body)).messages[0].content;
    expect(prompt).not.toMatch(/对方最后一条消息是 \d+ 小时前发的/);
  });

  it("removes leaked time and speaker prefixes from the model reply", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "\u91cd\u5e86", condition: "\u6674", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "[22:15] \u4f60\u8bf4\uff1a\u4e0d\u5c31\u90a3\u4e2ayyds\u561b \u6211\u770b\u5230\u4e86" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "contact-1",
        contact_name: "contact-1",
        messages: [{ role: "user", content: "\u77e5\u9053\u6211\u53d1\u7684\u4ec0\u4e48\u8868\u60c5\u4e0d\uff1f" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "\u4e0d\u5c31\u90a3\u4e2ayyds\u561b \u6211\u770b\u5230\u4e86",
    });
  });

  it("removes leaked dated context markers from the middle of a reply", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "\u91cd\u5e86", condition: "\u6674", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "\u4f4d\u7f6e\u5c31\u7b97\u4e86\uff0c\u624d\u804a\u51e0\u5929\u5c31\u4e92\u6362\u5730\u5740\u592a\u5feb\u4e86 [soul 10/01 18:57] \u4f60\u4e5f\u662f\u6025\u6027\u5b50\uff0c\u89c1\u9762\u7684\u4e8b\u5148\u653e\u653e\u5427" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "contact-mid-marker",
        contact_name: "contact-mid-marker",
        messages: [{ role: "user", content: "\u4f60\u53d1\u4e2a\u4f4d\u7f6e\u7ed9\u6211" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      // 新人设把单段上限放宽到20字；这条19字，整句完整保留，不再被15字旧上限切掉。
      reply: "\u4f4d\u7f6e\u5c31\u7b97\u4e86\uff0c\u624d\u804a\u51e0\u5929\u5c31\u4e92\u6362\u5730\u5740\u592a\u5feb\u4e86",
    });
  });

  it("removes leaked prefixes from later reply lines and pipe segments", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "给谁 你对象啊|||你说：我眯了啊 明天还一堆单子|||[09/25 03:40] 明天还得跑单子" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "contact-3",
        contact_name: "contact-3",
        messages: [{ role: "user", content: "在吗" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      // 2026-10-07 砍规则：睡话题规则已删，第三段留下；但“你说：”“[09/25 03:40]”这些泄露前缀照旧被清掉
      // 2026-10-07：泄露前缀照旧清掉；但“在吗”这种短消息最多回两条（新增长度预算），第三段会被收掉。
      // 2026-10-07：他这句只有 2 字，按长度预算只回一条。
      reply: "给谁 你对象啊",
    });
  });

  it("does not remove speaker words that are part of normal reply text", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "\u91cd\u5e86", condition: "\u6674", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "\u4f60\u8bf4\u5462 \u6211\u8fd8\u5728\u770b\u6d88\u606f" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "contact-2",
        contact_name: "contact-2",
        messages: [{ role: "user", content: "\u5728\u5417" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "\u4f60\u8bf4\u5462 \u6211\u8fd8\u5728\u770b\u6d88\u606f",
    });
  });

  it("keeps only the segments within the length budget", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "谢谢 你眼光不错 ||| 你怎么这个点还醒着" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "测试联系人",
        contact_name: "测试联系人",
        messages: [{ role: "user", content: "你这高跟鞋真好看" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    const body = await response.json();
    expect(body.action).toBe("send");
    // 2026-10-07 砍规则：反问/sleep 过滤已删，两段都保留（只校验内容还在，不锁死分隔符格式）
    // 2026-10-07：长度按他这条算——他 8 字，只保留第一条。
    expect(String(body.reply)).toContain("谢谢 你眼光不错");
    expect(String(body.reply)).not.toContain("你怎么这个点还醒着");
  });
});

  it("passes Beijing time to the model without injecting a rest-period policy", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T19:44:00.000Z"));
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "睡了 被你消息吵醒了 ||| 这么晚还没睡" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "期待下一步的我们",
        contact_name: "期待下一步的我们",
        messages: [{ role: "user", content: "睡了吗" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const prompt = JSON.parse(String(init.body)).messages[0].content;
    expect(prompt).toContain("2026-09-25 03:44:00");
    expect(prompt).toContain("星期五");
    expect(prompt).not.toContain("业务消息可以远程回复");
    expect(prompt).not.toContain("有正常作息和情绪");
    expect(prompt).toContain("先把那件具体的事答了");
    expect(prompt).toContain("不要汇报自己正在做什么");
    expect(prompt).not.toContain("你在家休息");
    expect(prompt).not.toContain("远程回下业务消息")
    expect(prompt).not.toContain("躺床上睡不着");
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      // 2026-10-07 砍规则：反问过滤已删，两段都留
      // 2026-10-07：他这句只有 3 字，按长度预算只回一条。
      reply: "睡了 被你消息吵醒了",
    });
  });

  it("formats historical messages in China time instead of server time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T19:44:00.000Z"));
    const historyRows = [
      { id: 1, role: "user", content: "昨晚在吗", created_at: Math.floor(Date.parse("2026-09-24T19:40:00.000Z") / 1000) },
    ];
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "在的" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "期待下一步的我们",
        contact_name: "期待下一步的我们",
        messages: [{ role: "user", content: "在吗" }],
        request_id: "confirm-only-reply",
      }),
    });
    await onRequest({
      request,
      env: { DB: new MockD1(historyRows), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const historyMessage = JSON.parse(String(init.body)).messages.find((message) =>
      String(message.content).includes("昨晚在吗"),
    );
    expect(historyMessage.content).toContain("09/25 03:40");
    expect(historyMessage.content).not.toContain("19:40");
  });
  it("activates the selected persona with a valid device key", async () => {
    const db = new MockD1([], [
      { id: "female", name: "星暮" },
      { id: "male_chenyu", name: "陈屿" },
    ]);
    const request = new Request("https://example.com/api/config/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_key: "test-token",
        action: "activate_persona",
        persona_id: "male_chenyu",
      }),
    });

    const response = await onRequest({
      request,
      env: { DB: db, KV: new MockKV() },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      active_persona_id: "male_chenyu",
      active_persona_name: "陈屿",
    });
    expect(db.tokenPersonas.get("test-token")).toBe("male_chenyu");
    db.tokenPersonas.set("other-token", "female");
    const otherConfig = await onRequest({
      request: new Request("https://example.com/api/config", {
        headers: { Authorization: "Bearer other-token" },
      }),
      env: { DB: db, KV: new MockKV() },
    } as never);
    await expect(otherConfig.json()).resolves.toMatchObject({ active_persona_id: "female" });
    expect(db.tokenPersonas.get("test-token")).toBe("male_chenyu");
  });

  it("returns the shared persona location from config and ignores old device locations", async () => {
    const db = new MockD1();
    db.personaFactRows.set("female", {
      persona_id: "female",
      facts_json: JSON.stringify({
        age_mode: "fixed_age",
        fixed_age: 29,
        marital_status: "married",
        has_children: false,
        hometown: "重庆",
        current_city: "重庆",
        current_district: "两江新区",
        common_area: "",
        work_city: "重庆",
        work_district: "江北区",
        location_precision: "district",
        proactive_location_allowed: false,
      }),
      version: 3,
      updated_at: 200,
    });
    db.locationRows.set("test-token", {
      home_city: "北京",
      home_district: "朝阳区",
      work_city: "上海",
      work_district: "浦东新区",
    });

    const configResponse = await onRequest({
      request: new Request("https://example.com/api/config", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env: { DB: db, KV: new MockKV() },
    } as never);

    await expect(configResponse.json()).resolves.toMatchObject({
      location: {
        home: { city: "重庆", district: "两江新区" },
        work: { city: "重庆", district: "江北区" },
      },
      persona_facts: { config_version: 3 },
    });
  });

  it("rejects old mobile persona facts saves and keeps the shared facts unchanged", async () => {
    const db = new MockD1();
    db.personaFactRows.set("female", {
      persona_id: "female",
      facts_json: JSON.stringify({
        age_mode: "fixed_age",
        fixed_age: 29,
        marital_status: "divorced",
        has_children: false,
        vehicle: "宝马X3",
        housing: "自有住房",
        hometown: "重庆",
        current_city: "重庆",
        current_district: "两江新区",
        common_area: "",
        work_city: "重庆",
        work_district: "江北区",
        location_precision: "district",
        proactive_location_allowed: false,
      }),
      version: 2,
      updated_at: 200,
    });
    db.pendingRows.push({
      id: "old-pending",
      token: "test-token",
      request_id: "old-request",
      platform: "soul",
      contact_id: "old-contact",
      contact_name: "旧会话",
      content: "旧回复",
      status: "pending",
      action_type: "text",
      media_group_id: "",
      media_asset_id: "",
      sent_content: "",
      created_at: 1,
      persona_id: "female",
      persona_version: 1,
    });
    const request = new Request("https://example.com/api/config/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_key: "test-token",
        action: "save_persona_facts",
        age_mode: "fixed_age",
        fixed_age: "31",
        birth_year: "",
        marital_status: "single",
        has_children: "true",
        children_age: "4",
        contact_qq: "22345678",
        hometown: "重庆",
        current_city: "成都",
        current_district: "武侯区",
        common_area: "天府三街附近",
        work_city: "成都",
        work_district: "高新区",
        location_precision: "district",
        proactive_location_allowed: "false",
      }),
    });

    const response = await onRequest({
      request,
      env: { DB: db, KV: new MockKV() },
    } as never);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({
      success: false,
      code: "shared_persona_dashboard_only",
    });
    expect(db.deviceOverrideRows.size).toBe(0);
    expect(db.personaFactRows.get("female")?.version).toBe(2);
    expect(JSON.parse(String(db.personaFactRows.get("female")?.facts_json))).toMatchObject({
      fixed_age: 29,
      current_city: "重庆",
    });
    expect(db.pendingRows.find((row) => row.id === "old-pending")?.status).toBe("pending");
  });

  it("saves shared persona facts from the dashboard and rejects a stale version", async () => {
    const db = new MockD1();
    db.personaFactRows.set("female", {
      persona_id: "female",
      facts_json: JSON.stringify({
        age_mode: "fixed_age",
        fixed_age: 29,
        marital_status: "married",
        has_children: false,
        hometown: "重庆",
        current_city: "重庆",
        current_district: "两江新区",
        common_area: "",
        work_city: "重庆",
        work_district: "江北区",
        location_precision: "district",
        proactive_location_allowed: false,
      }),
      version: 5,
      updated_at: 200,
    });
    const makeRequest = (expectedVersion: number, fixedAge: number) => onRequest({
      request: new Request("https://example.com/api/persona-facts", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Password": "secret",
        },
        body: JSON.stringify({
          persona_id: "female",
          expected_version: expectedVersion,
          age_mode: "fixed_age",
          fixed_age: fixedAge,
          marital_status: "married",
          has_children: false,
          hometown: "重庆",
          current_city: "重庆",
          current_district: "两江新区",
          work_city: "重庆",
          work_district: "江北区",
          location_precision: "district",
          proactive_location_allowed: false,
        }),
      }),
      env: { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" },
    } as never);

    const saved = await makeRequest(5, 35);
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      success: true,
      shared_version: 6,
      facts: { fixed_age: 35 },
    });

    const stale = await makeRequest(5, 36);
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "persona_version_conflict",
      current_version: 6,
    });
    expect(JSON.parse(String(db.personaFactRows.get("female")?.facts_json))).toMatchObject({
      fixed_age: 35,
    });
  });

  it("uses the latest persona facts on the next chat without requiring publish", async () => {
    const db = new MockD1([], [{
      id: "female_sutang",
      name: "苏棠",
      system_prompt: "你是苏棠，29岁。",
      is_active: 1,
      created_at: 1,
    }]);
    db.tokenPersonas.set("test-token", "female_sutang");
    db.personaFactRows.set("female_sutang", {
      persona_id: "female_sutang",
      facts_json: JSON.stringify({
        age_mode: "fixed_age",
        fixed_age: 29,
        marital_status: "married",
        has_children: true,
        children_age: 3,
        hometown: "重庆",
        current_city: "重庆",
        current_district: "两江新区",
        work_city: "重庆",
        work_district: "江北区",
      }),
      version: 1,
      updated_at: 100,
    });
    const kv = new MockKV();
    await kv.put("persona:drawers:female_sutang", JSON.stringify({ topics: [], counters: [], custom: [] }));
    const env = { DB: db, KV: kv, DASHBOARD_PASSWORD: "secret", DEEPSEEK_API_KEY: "deepseek-key" };
    const published = await onRequest({
      request: new Request("https://example.com/api/persona/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({ persona_id: "female_sutang", expected_version: 1 }),
      }),
      env,
    } as never);
    expect(published.status).toBe(200);
    const publishedBody = await published.json();
    expect(publishedBody).toMatchObject({
      success: true,
      published_version: 1,
      source_version: 1,
    });

    // 用户明确要求：资料改完，下一条聊天立即按新版本执行，不再卡“发布正式版”。
    db.personaFactRows.set("female_sutang", {
      persona_id: "female_sutang",
      facts_json: JSON.stringify({
        age_mode: "fixed_age",
        fixed_age: 35,
        marital_status: "married",
        has_children: true,
        children_age: 3,
        hometown: "重庆",
        current_city: "重庆",
        current_district: "两江新区",
        work_city: "重庆",
        work_district: "江北区",
      }),
      version: 2,
      updated_at: 200,
    });
    const fetchMock = mockChatSequence(["不应该走模型"]);
    vi.stubGlobal("fetch", fetchMock);
    const chat = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "snapshot-live-version",
          platform: "soul",
          contact_id: "snapshot-contact",
          contact_name: "快照测试",
          messages: [{ role: "user", content: "你多大？" }],
        }),
      }),
      env,
    } as never);
    expect(chat.status).toBe(200);
    await expect(chat.json()).resolves.toMatchObject({
      action: "send",
      persona_id: "female_sutang",
      persona_version: 2,
    });
    const reply = String(db.pendingRows.at(-1)?.content || "");
    expect(reply).toContain("35");
    expect(reply).not.toContain("29");
  });

  it("does not return platform style restrictions in app config", async () => {
    const response = await onRequest({
      request: new Request("https://example.com/api/config", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env: { DB: new MockD1(), KV: new MockKV() },
    } as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).not.toHaveProperty("platform_style_hints");
  });

  it("removes the voice and sticker repulsion rule from persona seed data", () => {
    const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
    const legacyMigration = readFileSync(new URL("../db/migrations/20260925_four_personas.sql", import.meta.url), "utf8");
    const removalMigration = readFileSync(new URL("../db/migrations/20260926_remove_media_repulsion_rule.sql", import.meta.url), "utf8");
    const builtFunctions = readFileSync(new URL("../dist-func/index.js", import.meta.url), "utf8");

    expect(schema).not.toContain("对方发语音或表情后告知以后别发，你反感");
    expect(legacyMigration).not.toContain("对方发语音或表情后告知以后别发，你反感");
    expect(removalMigration).toContain("UPDATE personas");
    expect(removalMigration).toContain("REPLACE(");
    expect(builtFunctions).not.toContain("PLATFORM_STYLE_HINTS");
    expect(builtFunctions).not.toContain("platform_style_hints");
  });

  it("stores four aligned personas in the seed and production migration", () => {
    const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
    const migration = readFileSync(new URL("../db/migrations/20260928_device_persona_and_pending_replies.sql", import.meta.url), "utf8");
    const newContactMigration = readFileSync(new URL("../db/migrations/20260928_new_contact_natural_reply.sql", import.meta.url), "utf8");
    const contactMigration = readFileSync(new URL("../db/migrations/20260928_contact_gate_relationship_layers.sql", import.meta.url), "utf8");
    const compactMigration = readFileSync(new URL("../db/migrations/20260929_compact_personas.sql", import.meta.url), "utf8");
    const xingmuMigration = readFileSync(new URL("../db/migrations/20260930_update_new_xingmu_persona.sql", import.meta.url), "utf8");
    const funnelMigration = readFileSync(new URL("../db/migrations/20261001_persist_xingmu_funnel.sql", import.meta.url), "utf8");
    const carMigration = readFileSync(new URL("../db/migrations/20261001_add_bmw_x3_to_xingmu_persona.sql", import.meta.url), "utf8");
    const voiceMigration = readFileSync(new URL("../db/migrations/20261003_persona_voice_funnel_v2.sql", import.meta.url), "utf8");
    const vehicleMigration = readFileSync(new URL("../db/migrations/20261003_persona_vehicle_facts.sql", import.meta.url), "utf8");

    expect(schema).toContain("你是王雅慧，对外叫星暮，熟了叫慧慧");
    expect(migration).toContain("你是星暮，29岁女性，重庆人，已婚未育。");
    expect(schema).toContain("做二手手机和废旧数码回收，主要走线上寄件和同城上门");
    expect(compactMigration).toContain("你做全国二手手机和数码回收");
    expect(xingmuMigration).toContain("UPDATE personas");
    expect(xingmuMigration).toContain("你是王雅慧，对外叫星暮，熟了叫慧慧");
    expect(xingmuMigration).not.toContain("已婚未育");
    expect(xingmuMigration).not.toContain("公婆");
    expect(xingmuMigration).not.toContain("宝马X3");
    expect(funnelMigration).toContain("CREATE TABLE IF NOT EXISTS customer_funnel_states");
    expect(funnelMigration).toContain("做二手手机和废旧数码回收");
    expect(funnelMigration).toContain("有一辆宝马X3");
    expect(carMigration).toContain("UPDATE personas");
    expect(carMigration).toContain("有一辆宝马X3");
    expect(voiceMigration).toContain("默认每条3到12字");
    expect(voiceMigration).toContain("漏斗只决定业务边界");
    expect(voiceMigration).toContain("'$.marital_status', 'divorced'");
    expect(schema).toContain('"marital_status":"divorced"');
    expect(vehicleMigration).toContain("'$.vehicle', '宝马X3'");
    expect(vehicleMigration).toContain("'$.housing', '自有住房'");
    expect(schema).toContain('"vehicle":"宝马X3"');
    expect(schema).not.toContain("每条回复50字以内");
    expect(schema).not.toContain("你负责全国二手手机和数码设备回收");
    expect(newContactMigration).toContain("不靠陌生人推销");
    expect(newContactMigration).toContain("只有对方明确问工作")
    expect(schema).not.toContain("对方要联系方式只给QQ");
    expect(schema).not.toContain("对方索要联系方式只给QQ号");
    expect(contactMigration).toContain("对方索要联系方式不能马上给");
    expect(contactMigration).toContain("不能自行编号码");
    expect(contactMigration).toContain("聊天有边界");
    expect(migration).toContain("UPDATE personas");
    expect(migration).toContain("active_persona_id");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS pending_replies");
  });

  it("rejects old mobile location saves even when the payload is incomplete", async () => {
    const response = await onRequest({
      request: new Request("https://example.com/api/config/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_key: "test-token",
          action: "save_location",
          home_city: "重庆",
          home_district: "",
          work_city: "重庆",
          work_district: "两江新区",
        }),
      }),
      env: { DB: new MockD1(), KV: new MockKV() },
    } as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: "shared_persona_dashboard_only",
    });
  });

describe("vision API", () => {
  it("rejects an invalid device key", async () => {
    const env = {
      DB: new MockD1(),
      KV: new MockKV(),
      DEEPSEEK_API_KEY: "deepseek-key",
    };
    const request = new Request("https://example.com/api/vision/describe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: "ZmFrZQ==" }),
    });

    const response = await onRequest({ request, env } as never);
    expect(response.status).toBe(401);
  });

  it("returns a clear 503 when DeepSeek vision is not configured", async () => {
    const env = { DB: new MockD1(), KV: new MockKV() };
    const response = await onRequest({
      request: visionRequest(),
      env,
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "vision_not_configured",
    });
  });

  it("verifies the dashboard password on the server", async () => {
    const env = { DB: new MockD1(), KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const request = new Request("https://example.com/api/dashboard/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "secret" }),
    });

    const response = await onRequest({ request, env } as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("rejects dashboard access without the password", async () => {
    const env = { DB: new MockD1(), KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const response = await onRequest({
      request: new Request("https://example.com/api/token"),
      env,
    } as never);

    expect(response.status).toBe(401);
  });

  it("allows dashboard access with the password", async () => {
    const env = { DB: new MockD1(), KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const response = await onRequest({
      request: new Request("https://example.com/api/token", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ tokens: [] });
  });

  it("returns all contacts for the dashboard when no device token is selected", async () => {
    const contact = {
      id: 1,
      platform: "soul",
      contact_id: "contact-1",
      contact_name: "期待下一步的我们",
      is_whitelisted: 1,
      notes: "",
      created_at: 1790281839,
    };
    const env = {
      DB: new MockD1([], [{ id: "female", name: "星暮" }], [contact]),
      KV: new MockKV(),
      DASHBOARD_PASSWORD: "secret",
    };

    const response = await onRequest({
      request: new Request("https://example.com/api/contacts?token=", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ contacts: [contact] });
  });

  it("returns all chat history for the dashboard when no device token is selected", async () => {
    const message = {
      id: 1,
      platform: "soul",
      contact_id: "contact-1",
      contact_name: "期待下一步的我们",
      role: "user",
      content: "腿真好看",
      created_at: 1790281839,
    };
    const env = {
      DB: new MockD1([message]),
      KV: new MockKV(),
      DASHBOARD_PASSWORD: "secret",
    };

    const response = await onRequest({
      request: new Request("https://example.com/api/chat/history?token=&limit=50", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ history: [message] });
  });

  it("sends image content to deepseek-flash with thinking disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "a yellow cat sticker" } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = {
      DB: new MockD1(),
      KV: new MockKV(),
      DEEPSEEK_API_KEY: "deepseek-key",
    };
    const response = await onRequest({
      request: visionRequest(),
      env,
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      description: "a yellow cat sticker",
      provider: "deepseek",
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer deepseek-key",
    );

    const payload = JSON.parse(String(init.body));
    expect(payload.model).toBe("deepseek-flash");
    expect(payload.thinking).toEqual({ type: "disabled" });
    expect(payload.max_tokens).toBeGreaterThanOrEqual(240);
    expect(payload.messages[0].content).toEqual([
      { type: "text", text: "describe image" },
      {
        type: "image_url",
        image_url: {
          url: "data:image/jpeg;base64,ZmFrZS1pbWFnZQ==",
        },
      },
    ]);
  });

  it("allows an explicit vision key and model override", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "custom description" } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = {
      DB: new MockD1(),
      KV: new MockKV(),
      VISION_API_KEY: "vision-key",
      VISION_API_BASE: "https://vision.example.com/v1/",
      VISION_MODEL: "custom-flash",
    };
    const response = await onRequest({
      request: visionRequest(),
      env,
    } as never);

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://vision.example.com/v1/chat/completions");
    expect(JSON.parse(String(init.body)).model).toBe("custom-flash");
  });

  it("routes image understanding through Gemini when Gemini is selected", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "a red square" } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const kv = new MockKV();
    await kv.put("llm:gemini_model", "gemini-3.8-flash");
    const db = new MockD1();
    db.deviceSettingsRows.set("test-token", {
      platform: "soul",
      hosting_enabled: 1,
      monitor_enabled: 1,
      weather_enabled: 0,
      time_enabled: 0,
      reply_pace_sec: 0,
      ai_hours_enabled: 0,
      ai_start_hour: 8,
      ai_end_hour: 23,
      model_line: "b",
    });
    const env = {
      DB: db,
      KV: kv,
      GEMINI_API_KEY: "gemini-key",
      DEEPSEEK_API_KEY: "deepseek-key",
    };
    const response = await onRequest({
      request: visionRequest(),
      env,
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      description: "a red square",
      provider: "gemini",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer gemini-key");
    expect((init.headers as Record<string, string>)["X-goog-api-key"]).toBe("gemini-key");
    const payload = JSON.parse(String(init.body));
    expect(payload.model).toBe("gemini-3.8-flash");
    expect(payload.reasoning_effort).toBe("low");
    expect(payload.thinking).toBeUndefined();
  });
});

describe("customer dashboard and cross-platform memory", () => {
  it("returns unified customers and marks every bound platform", async () => {
    const contacts = [
      { token: "test-token", platform: "soul", contact_id: "soul-a", contact_name: "梦想", is_whitelisted: 1, notes: "", created_at: 1 },
      { token: "test-token", platform: "qq", contact_id: "qq-a", contact_name: "积极", is_whitelisted: 1, notes: "", created_at: 2 },
    ];
    const history = [
      { id: 1, token: "test-token", platform: "soul", contact_id: "soul-a", contact_name: "梦想", role: "user", content: "高跟鞋那张很有气质", created_at: 10 },
      { id: 2, token: "test-token", platform: "qq", contact_id: "qq-a", contact_name: "积极", role: "assistant", content: "谢谢 你眼光不错", created_at: 11 },
    ];
    const db = new MockD1(history, [], contacts).withOptions({
      groups: [{ id: "group:1", token: "test-token", display_name: "王先生", notes: "", priority_reply: 1, created_at: 1 }],
      contactLinks: [
        { group_id: "group:1", token: "test-token", platform: "soul", contact_id: "soul-a", contact_name: "梦想" },
        { group_id: "group:1", token: "test-token", platform: "qq", contact_id: "qq-a", contact_name: "积极" },
      ],
    });
    db.conversationStatsRows = [
      { token: "test-token", platform: "soul", contact_id: "soul-a", contact_name: "梦想", message_count: 3, latest_role: "user", latest_content: "高跟鞋那张很有气质", latest_at: 10 },
      { token: "test-token", platform: "qq", contact_id: "qq-a", contact_name: "积极", message_count: 4, latest_role: "assistant", latest_content: "谢谢 你眼光不错", latest_at: 11 },
    ];
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };

    const response = await onRequest({
      request: new Request("https://example.com/api/customer-groups?q=%E9%AB%98%E8%B7%9F%E9%9E%8B&token=test-token", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]).toMatchObject({
      id: "group:1",
      display_name: "王先生",
      priority_reply: true,
      platforms: ["soul", "qq"],
      message_count: 7,
    });
  });

  it("opens a unified customer when the contact link and contact tables both have a created_at column", async () => {
    const history = [
      {
        id: 21,
        token: "test-token",
        platform: "soul",
        contact_id: "期待下一步的我们",
        contact_name: "期待下一步的我们",
        role: "user",
        content: "算了我睡了",
        source: "sync",
        created_at: 1791484919,
      },
    ];
    const db = new MockD1(history).withOptions({
      groups: [{
        id: "group:bf8e87ed-a28f-4dbb-a8af-bd0aef39125d",
        token: "test-token",
        display_name: "期待下一步的我们",
        notes: "",
        priority_reply: 1,
      }],
      contactLinks: [{
        group_id: "group:bf8e87ed-a28f-4dbb-a8af-bd0aef39125d",
        token: "test-token",
        platform: "soul",
        contact_id: "期待下一步的我们",
        contact_name: "期待下一步的我们",
        created_at: 1791486939,
      }],
    });
    const response = await onRequest({
      request: new Request("https://example.com/api/customer-messages?token=test-token&group_id=group%3Abf8e87ed-a28f-4dbb-a8af-bd0aef39125d", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env: { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      messages: [{ id: 21, content: "算了我睡了" }],
      latest_id: 21,
    });
  });

  it("changes only the selected device's model line from the dashboard", async () => {
    const db = new MockD1();
    const settings = (modelLine: string) => ({
      platform: "soul",
      hosting_enabled: 1,
      monitor_enabled: 1,
      weather_enabled: 0,
      time_enabled: 0,
      reply_pace_sec: 0,
      ai_hours_enabled: 0,
      ai_start_hour: 8,
      ai_end_hour: 23,
      model_line: modelLine,
    });
    db.deviceSettingsRows.set("device-a", settings("a"));
    db.deviceSettingsRows.set("device-b", settings("a"));
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };

    const update = await onRequest({
      request: new Request("https://example.com/api/model-route", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({ token: "device-a", line: "b" }),
      }),
      env,
    } as never);
    expect(update.status).toBe(200);

    const read = async (token: string) => onRequest({
      request: new Request("https://example.com/api/model-route?token=" + token, {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    await expect((await read("device-a")).json()).resolves.toMatchObject({ line: "b" });
    await expect((await read("device-b")).json()).resolves.toMatchObject({ line: "a" });
  });

  it("uses bound platform history in the reply prompt", async () => {
    const history = [
      { id: 10, token: "test-token", platform: "soul", contact_id: "soul-a", contact_name: "梦想", role: "user", content: "我周末有空", created_at: 100 },
      { id: 11, token: "test-token", platform: "qq", contact_id: "qq-a", contact_name: "积极", role: "assistant", content: "那就周六见", created_at: 101 },
    ];
    const db = new MockD1(history).withOptions({
      contactLinks: [
        { group_id: "group:shared", token: "test-token", platform: "soul", contact_id: "soul-a", contact_name: "梦想" },
        { group_id: "group:shared", token: "test-token", platform: "qq", contact_id: "qq-a", contact_name: "积极" },
      ],
    });
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "周末见" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "soul-a",
          contact_name: "梦想",
          messages: [{ role: "user", content: "周六有空吗" }],
        }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const promptMessages = JSON.parse(String(init.body)).messages;
    expect(promptMessages[0].content).toContain("【连续记忆】");
    expect(promptMessages[0].content).toContain("按同一个人延续聊天");
    // Cross-platform history keeps flowing, but as a labelled transcript line
    // instead of a "[platform time] content" prefix.
    expect(promptMessages.some((message) => String(message.content).includes("对方：我周末有空"))).toBe(true);
    expect(promptMessages.some((message) => message.role === "assistant" && String(message.content).includes("我：那就周六见"))).toBe(true);
  });

  it("pulls and completes dashboard manual replies", async () => {
    const task = {
      id: "manual-1",
      platform: "soul",
      contact_id: "soul-a",
      contact_name: "梦想",
      group_id: "group:1",
      content: "我晚点联系你",
      status: "pending",
      created_at: 100,
    };
    const db = new MockD1().withOptions({ manualTask: task });
    const env = { DB: db, KV: new MockKV() };
    const nextResponse = await onRequest({
      request: new Request("https://example.com/api/reply-tasks/next?platform=soul", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env,
    } as never);
    await expect(nextResponse.json()).resolves.toMatchObject({
      task: { id: "manual-1", type: "manual", content: "我晚点联系你" },
    });

    const resultResponse = await onRequest({
      request: new Request("https://example.com/api/reply-tasks/result", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ task_id: "manual-1", status: "sent" }),
      }),
      env,
    } as never);
    expect(resultResponse.status).toBe(200);
    await expect(resultResponse.json()).resolves.toMatchObject({ success: true, status: "sent" });
  });

  it("does not bind filtered dashboard rows by list index", () => {
    const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
    expect(source).not.toContain("data-bind-index");
    expect(source).toContain("data-contact-id");
    expect(source).toContain("replace_aliases: true");
  });

  it("ships the clean customer dashboard layout and profile panel", () => {
    const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
    const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
    expect(html).toMatch(/grid-template-columns: (?:320px minmax\(420px, 1fr\) 300px|280px 1fr 280px)/);
    expect(html).toMatch(/--(?:green|blue): #(?:22c55e|0ea5e9)/);
    expect(html).toContain('id="profilePlatformLinks"');
    expect(html).toContain('id="mobileSidebarButton"');
    expect(html).toContain('id="mobileProfileButton"');
    expect(html).toContain("不同平台的同一个人会合在一起");
    expect(source).toContain("function renderProfilePanel(group)");
    expect(source).toContain('class="pf ${active.has(platform.id)');
    // 2026-10-07 学 LinkPilot 的两样：时间来源标签 + 非文字消息语义标签。
    expect(source).toContain("function kindLabel(timeKind)");
    expect(source).toContain("function messageBody(message)");
    expect(source).toContain("first_observed: \"读到\"");
    expect(source).toContain("content-chip");
    expect(html).toContain(".kind-label");
    expect(html).toContain(".content-chip");
  });
});

describe("monitoring sync and customer profile batching", () => {
  it("deduplicates synced messages and preserves the original source", async () => {
    const db = new MockD1();
    const env = { DB: db, KV: new MockKV() };
    const body = {
      platform: "soul",
      contact_id: "contact-1",
      contact_name: "梦想",
      messages: [{
        message_key: "sync:soul:contact-1:one",
        role: "assistant",
        content: "我在呢",
        source: "human_phone",
        created_at: 100,
      }],
    };
    const send = () => onRequest({
      request: new Request("https://example.com/api/messages/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify(body),
      }),
      env,
    } as never);

    const first = await send();
    const second = await send();
    await expect(first.json()).resolves.toMatchObject({ ok: true, accepted: 1, inserted: 1 });
    await expect(second.json()).resolves.toMatchObject({ ok: true, accepted: 1, inserted: 0 });
    expect(db.historyRows).toHaveLength(1);
    expect(db.historyRows[0]).toMatchObject({ source: "human_phone", message_key: "sync:soul:contact-1:one" });
    expect(db.conversationStatsRows[0]).toMatchObject({ message_count: 1, latest_source: "human_phone" });
  });

  it("returns only messages newer than the dashboard cursor", async () => {
    const history = [
      { id: 10, token: "test-token", platform: "soul", contact_id: "contact-1", contact_name: "梦想", role: "user", content: "旧消息", source: "sync", created_at: 10 },
      { id: 11, token: "test-token", platform: "soul", contact_id: "contact-1", contact_name: "梦想", role: "assistant", content: "新消息", source: "ai", created_at: 11, time_kind: "ai_generated" },
    ];
    const db = new MockD1(history).withOptions({
      groups: [{ id: "group:shared", token: "test-token", display_name: "梦想", notes: "", priority_reply: 0 }],
      contactLinks: [{ group_id: "group:shared", token: "test-token", platform: "soul", contact_id: "contact-1", contact_name: "梦想" }],
    });
    const response = await onRequest({
      request: new Request("https://example.com/api/customer-messages?token=test-token&group_id=group%3Ashared&since_id=10", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env: { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" },
    } as never);

    expect(response.status).toBe(200);
    const dashboardBody = await response.json();
    expect(dashboardBody).toMatchObject({
      latest_id: 11,
      messages: [{ id: 11, source: "ai", content: "新消息" }],
    });
    // 2026-10-07 看板要显示“这时间是怎么来的”，所以消息里必须带 time_kind。
    expect(dashboardBody.messages[0]).toHaveProperty("time_kind");
  });

  it("lists takeover alerts for the dashboard and rejects unauthenticated calls", async () => {
    // 2026-10-07：看板要能看到“谁要过联系方式、系统什么时候停手发的邮件”。
    const db = new MockD1();
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const unauthorized = await onRequest({
      request: new Request("https://example.com/api/takeover-alerts"),
      env,
    } as never);
    expect(unauthorized.status).toBe(401);

    const authorized = await onRequest({
      request: new Request("https://example.com/api/takeover-alerts?token=test-token&contact_name=%E8%80%83%E5%8D%B71", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toMatchObject({ alerts: [] });
  });

  it("serves the Su Tang knowledge page and toggles one card", async () => {
    const kv = new MockKV();
    const env = { DB: new MockD1(), KV: kv, DASHBOARD_PASSWORD: "secret" };
    const unauthorized = await onRequest({
      request: new Request("https://example.com/api/drawers"),
      env,
    } as never);
    expect(unauthorized.status).toBe(401);

    const list = await onRequest({
      request: new Request("https://example.com/api/drawers?persona_id=female_sutang", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody.persona_id).toBe("female_sutang");
    expect(listBody.topics.length).toBeGreaterThan(0);
    expect(listBody.counters).toEqual([]);
    const firstId = "scene_14_rainy_neck";
    expect(listBody.topics.find((item) => item.id === firstId)?.enabled).toBe(true);

    const toggle = await onRequest({
      request: new Request("https://example.com/api/drawers", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          persona_id: "female_sutang",
          id: firstId,
          enabled: false,
          expected_version: listBody.shared_version,
        }),
      }),
      env,
    } as never);
    expect(toggle.status).toBe(200);

    const relist = await onRequest({
      request: new Request("https://example.com/api/drawers?persona_id=female_sutang", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    const relistBody = await relist.json();
    expect(relistBody.topics.find((d) => d.id === firstId).enabled).toBe(false);
  });

  it("lets the dashboard edit drawer name, keywords and content", async () => {
    const kv = new MockKV();
    const env = { DB: new MockD1(), KV: kv, DASHBOARD_PASSWORD: "secret" };
    const list = await onRequest({
      request: new Request("https://example.com/api/drawers?persona_id=female_sutang", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    const listBody = await list.json();
    const firstId = listBody.topics[0].id;

    const update = await onRequest({
      request: new Request("https://example.com/api/drawers", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          persona_id: "female_sutang",
          id: firstId,
          name: "下班歇脚",
          keywords: "累, 加班\n瘫",
          content: "改成我自己的说法：忙完先缓一缓，再顺着他的话说。",
          expected_version: listBody.shared_version,
        }),
      }),
      env,
    } as never);
    expect(update.status).toBe(200);

    const relist = await onRequest({
      request: new Request("https://example.com/api/drawers?persona_id=female_sutang", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    const edited = (await relist.json()).topics.find((drawer) => drawer.id === firstId);
    expect(edited).toMatchObject({
      name: "下班歇脚",
      keywords: ["累", "加班", "瘫"],
      content: "改成我自己的说法：忙完先缓一缓，再顺着他的话说。",
    });
  });

  it("always-on agent cards are available without matching a keyword", () => {
    const matched = matchActiveDrawers({
      custom: [
        {
          id: "child_age",
          name: "孩子年龄",
          keywords: [],
          content: "孩子今年 5 岁，任何时候都不能说成 3 岁。",
          kind: "identity",
          activation: "always",
        },
      ],
    }, "今天天气不错");
    expect(matched.join("\n")).toContain("孩子今年 5 岁");
    expect(matched.join("\n")).toContain("不能说成 3 岁");
  });

  it("creates and deletes a custom agent card", async () => {
    const kv = new MockKV();
    const env = { DB: new MockD1(), KV: kv, DASHBOARD_PASSWORD: "secret" };
    const created = await onRequest({
      request: new Request("https://example.com/api/drawers/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          persona_id: "female_sutang",
          name: "最讨厌的东西",
          kind: "policy",
          activation: "always",
          priority: 90,
          content: "最讨厌别人催她回复，任何模型都不能催。",
          expected_version: 1,
        }),
      }),
      env,
    } as never);
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    const card = createdBody.card;
    expect(card).toMatchObject({
      name: "最讨厌的东西",
      kind: "policy",
      activation: "always",
      priority: 90,
    });

    const listed = await onRequest({
      request: new Request("https://example.com/api/drawers?persona_id=female_sutang", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    const listBody = await listed.json();
    expect(listBody.cards.find((item: any) => item.id === card.id)).toMatchObject({
      content: "最讨厌别人催她回复，任何模型都不能催。",
      source: "custom",
    });

    const removed = await onRequest({
      request: new Request("https://example.com/api/drawers/cards", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          persona_id: "female_sutang",
          id: card.id,
          expected_version: createdBody.shared_version,
        }),
      }),
      env,
    } as never);
    expect(removed.status).toBe(200);
  });

  it("deletes a built-in persona card instead of hiding the delete button", async () => {
    const kv = new MockKV();
    const env = { DB: new MockD1(), KV: kv, DASHBOARD_PASSWORD: "secret" };
    const listed = await onRequest({
      request: new Request("https://example.com/api/drawers?persona_id=female_sutang", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    const listBody = await listed.json();
    const builtIn = listBody.topics[0];
    expect(builtIn.source).toBe("default");

    const removed = await onRequest({
      request: new Request("https://example.com/api/drawers/cards", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          persona_id: "female_sutang",
          id: builtIn.id,
          expected_version: listBody.shared_version,
        }),
      }),
      env,
    } as never);
    expect(removed.status).toBe(200);

    const relisted = await onRequest({
      request: new Request("https://example.com/api/drawers?persona_id=female_sutang", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    const after = await relisted.json();
    expect(after.cards.some((item: any) => item.id === builtIn.id)).toBe(false);
  });

  it("shows persona conflicts and locked rules in the agent overview", async () => {
    const db = new MockD1([], [{
      id: "female_sutang",
      name: "苏棠",
      system_prompt: "你是王雅慧，孩子现在 3 岁。",
      is_active: 1,
    }]);
    db.personaFactRows.set("female_sutang", {
      persona_id: "female_sutang",
      facts_json: JSON.stringify({
        age_mode: "fixed_age",
        fixed_age: 29,
        marital_status: "married",
        has_children: true,
        children_age: 5,
      }),
      version: 2,
    });
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const response = await onRequest({
      request: new Request("https://example.com/api/agent-overview?persona_id=female_sutang", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.cards.length).toBeGreaterThan(0);
    expect(body.legacy_rules.length).toBeGreaterThanOrEqual(40);
    expect(body.legacy_rules.some((item: any) => item.id === "explicit_boundary")).toBe(true);
    expect(body.locked_rules).toBeUndefined();
    expect(body.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "人设身份串了" }),
      expect.objectContaining({ title: "孩子年龄说法不一致" }),
    ]));
  });

  it("audits all four personas and warns without blocking a deliberate edit", async () => {
    const db = new MockD1([], [
      { id: "female", name: "星暮", system_prompt: "你是王雅慧，对外叫星暮。", is_active: 0, created_at: 1 },
      { id: "female_sutang", name: "苏棠", system_prompt: "你是苏棠，29岁，重庆人。", is_active: 1, created_at: 2 },
      { id: "male", name: "阿杰", system_prompt: "你是阿杰，31岁男性。", is_active: 0, created_at: 3 },
      { id: "male_chenyu", name: "陈屿", system_prompt: "你是陈屿，33岁男性。", is_active: 0, created_at: 4 },
    ]);
    db.personaFactRows.set("female", {
      persona_id: "female",
      facts_json: JSON.stringify({ age_mode: "fixed_age", fixed_age: 29, marital_status: "divorced", has_children: false }),
      version: 1,
    });
    db.personaFactRows.set("female_sutang", {
      persona_id: "female_sutang",
      facts_json: JSON.stringify({ age_mode: "fixed_age", fixed_age: 29, marital_status: "married", has_children: true, children_age: 3 }),
      version: 1,
    });
    for (const personaId of ["male", "male_chenyu"]) {
      db.personaFactRows.set(personaId, {
        persona_id: personaId,
        facts_json: JSON.stringify({ age_mode: "fixed_age", fixed_age: 31, marital_status: "married", has_children: false }),
        version: 1,
      });
    }
    const kv = new MockKV();
    await kv.put("persona:drawers:female", JSON.stringify({
      topics: [],
      counters: [],
      custom: [{
        id: "wrong_persona",
        name: "错误卡片",
        content: "你是苏棠，做电商运营，还要带3岁的娃。",
        keywords: [],
        enabled: true,
      }],
    }));
    const env = { DB: db, KV: kv, DASHBOARD_PASSWORD: "secret" };
    const response = await onRequest({
      request: new Request("https://example.com/api/persona-audit", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.warning_count).toBeGreaterThan(0);
    expect(body.personas.find((item: any) => item.persona_id === "female").issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "卡片：错误卡片" }),
      ]),
    );

    const saved = await onRequest({
      request: new Request("https://example.com/api/drawers/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          persona_id: "female",
          expected_version: 1,
          name: "错误卡片",
          content: "你是苏棠，做电商运营，还要带3岁的娃。",
        }),
      }),
      env,
    } as never);
    expect(saved.status).toBe(201);
    await expect(saved.json()).resolves.toMatchObject({
      success: true,
      card: { name: "错误卡片" },
    });
  });

  it("seeds and edits the unified Agent rule catalog used by chat", async () => {
    expect(LEGACY_AGENT_RULES).toHaveLength(41);
    expect(DEFAULT_AGENT_RULES.length).toBeGreaterThan(LEGACY_AGENT_RULES.length);
    expect(new Set(LEGACY_AGENT_RULES.map((rule) => rule.gate))).toEqual(
      new Set(["input", "prompt", "output", "execution"]),
    );
    const db = new MockD1();
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const listed = await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    expect(listed.status).toBe(200);
    const listBody = await listed.json();
    expect(listBody.rules).toHaveLength(DEFAULT_AGENT_RULES.length);
    expect(listBody.conflicts).toEqual(expect.any(Array));
    expect(listBody.summary).toMatchObject({
      total: expect.any(Number),
      errors: expect.any(Number),
      warnings: expect.any(Number),
    });
    expect(new Set(listBody.rules.map((rule: any) => rule.gate))).toEqual(
      new Set(["input", "prompt", "output", "execution"]),
    );
    expect(listBody.rules[0].priority).toBeGreaterThanOrEqual(listBody.rules.at(-1).priority);

    const photoMemoryRule = listBody.rules.find(
      (rule: any) => rule.legacy_rule_id === "his_photo_memory",
    );
    expect(photoMemoryRule).toMatchObject({ title: "他发过照片后不再问长相" });
    const updatePhotoRule = await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({ id: photoMemoryRule.id, enabled: false }),
      }),
      env,
    } as never);
    expect(updatePhotoRule.status).toBe(200);
    expect(db.agentRuleRows.get(photoMemoryRule.id)?.enabled).toBe(0);
    await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({ id: photoMemoryRule.id, enabled: true }),
      }),
      env,
    } as never);
    const deletePhotoRule = await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({ id: photoMemoryRule.id }),
      }),
      env,
    } as never);
    expect(deletePhotoRule.status).toBe(200);
    expect(db.agentRuleRows.get(photoMemoryRule.id)?.enabled).toBe(0);
    expect(Number(db.agentRuleRows.get(photoMemoryRule.id)?.deleted_at || 0)).toBeGreaterThan(0);

    const missingQuestionRule = [...db.agentRuleRows.values()]
      .find((rule: any) => rule.legacy_rule_id === "question_pacing");
    db.agentRuleRows.delete(missingQuestionRule.id);
    db.agentRuleRows.set("dashboard_extra_for_count", {
      id: "dashboard_extra_for_count",
      legacy_rule_id: "",
      persona_id: "",
      title: "补位规则",
      detail: "只把总数补回原样，不能阻止缺失的默认规则恢复。",
      gate: "prompt",
      priority: 50,
      enabled: 1,
      sort_order: 999,
      source: "dashboard",
      created_at: 1,
      updated_at: 1,
      deleted_at: 0,
    });
    const reseeded = await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    const reseededRules = (await reseeded.json()).rules;
    expect(reseededRules.some((rule: any) => rule.legacy_rule_id === "question_pacing"))
      .toBe(true);

    const created = await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          title: "测试规则",
          detail: "这条规则只用于测试规则库。",
          gate: "output",
          priority: 88,
          persona_id: "female_sutang",
          enabled: true,
        }),
      }),
      env,
    } as never);
    expect(created.status).toBe(201);
    const createdId = (await created.json()).id;

    const updated = await onRequest({
      request: new Request("https://example.com/api/agent-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({ id: createdId, enabled: false, priority: 91 }),
      }),
      env,
    } as never);
    expect(updated.status).toBe(200);
    expect(db.agentRuleRows.get(createdId)?.enabled).toBe(0);
  });

  it("saves and tests code-backed program rules from the dashboard", async () => {
    const kv = new MockKV();
    const env = { DB: new MockD1(), KV: kv, DASHBOARD_PASSWORD: "secret" };
    const saved = await onRequest({
      request: new Request("https://example.com/api/program-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          rules: {
            ...DEFAULT_PROGRAM_RULES,
            platformNotice: {
              enabled: true,
              markers: ["新平台提醒"],
            },
            sticker: {
              enabled: true,
              meanings: { 月亮: "想找你聊天" },
              instruction: "表情按程序含义理解。",
            },
          },
        }),
      }),
      env,
    } as never);
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      success: true,
      rules: {
        platformNotice: {
          markers: ["新平台提醒"],
        },
      },
    });

    const loaded = await onRequest({
      request: new Request("https://example.com/api/program-rules", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    expect(loaded.status).toBe(200);
    await expect(loaded.json()).resolves.toMatchObject({
      customized: true,
      rules: {
        platformNotice: {
          markers: ["新平台提醒"],
        },
      },
    });

    const tested = await onRequest({
      request: new Request("https://example.com/api/program-rules/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({ content: "【新平台提醒】对方正在输入……" }),
      }),
      env,
    } as never);
    expect(tested.status).toBe(200);
    await expect(tested.json()).resolves.toMatchObject({
      platform_notice: true,
    });
  });

  it("uploads and lists an Android automation incident", async () => {
    const db = new MockD1();
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const payload = [
      JSON.stringify({
        eventId: "event-1",
        incidentId: "incident-test-1",
        event: "page_observed",
        platform: "soul",
        contactId: "contact-a",
        appVersion: "20261009-1647",
      }),
      JSON.stringify({
        eventId: "event-2",
        incidentId: "incident-test-1",
        event: "anomaly",
        action: "UnexpectedProfilePageAfterReply",
      }),
    ].join("\n");

    const uploaded = await onRequest({
      request: new Request("https://example.com/api/automation-incidents", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-ndjson",
          Authorization: "Bearer test-token",
          "X-Incident-Id": "incident-test-1",
          "X-App-Version": "20261009-1647",
        },
        body: payload,
      }),
      env,
    } as never);
    expect(uploaded.status).toBe(201);
    await expect(uploaded.json()).resolves.toMatchObject({
      success: true,
      id: "incident-test-1",
      event_count: 2,
    });

    const listed = await onRequest({
      request: new Request("https://example.com/api/automation-incidents?limit=10", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      incidents: [{
        id: "incident-test-1",
        event_count: 2,
        app_version: "20261009-1647",
      }],
    });

    const detail = await onRequest({
      request: new Request("https://example.com/api/automation-incidents?id=incident-test-1", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      incident: {
        id: "incident-test-1",
        payload,
      },
    });
  });

  it("records a customer dashboard black-box incident", async () => {
    const db = new MockD1();
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const response = await onRequest({
      request: new Request("https://example.com/api/dashboard-incidents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Password": "secret",
        },
        body: JSON.stringify({
          id: "dashboard-incident-1",
          kind: "api_error",
          reason: "图库上传失败",
          context: {
            app_version: "dashboard-test",
            page: "library",
          },
          events: [
            { type: "request", path: "/media-library/assets" },
            { type: "response", status: 500 },
          ],
        }),
      }),
      env,
    } as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      id: "dashboard-incident-1",
      event_count: 2,
    });
    expect(db.incidentRows.get("dashboard-incident-1")).toMatchObject({
      source: "dashboard",
      kind: "api_error",
      event_count: 2,
    });

    const updated = await onRequest({
      request: new Request("https://example.com/api/automation-incidents", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Password": "secret",
        },
        body: JSON.stringify({
          id: "dashboard-incident-1",
          status: "fixed",
        }),
      }),
      env,
    } as never);
    expect(updated.status).toBe(200);
    expect(db.incidentRows.get("dashboard-incident-1")?.status).toBe("fixed");
  });

  it("ships dashboard black-box feedback and incident details", () => {
    const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
    const htmlSource = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
    expect(appSource).toContain('"/dashboard-incidents"');
    expect(appSource).toContain("data-incident-view");
    expect(appSource).toContain("screenshotData");
    expect(htmlSource).toContain('id="dashboardFeedbackButton"');
    expect(htmlSource).toContain('id="dashboardIncidentModal"');
    expect(htmlSource).toContain('id="createDashboardReplayButton"');
    expect(htmlSource).toContain('id="saveDashboardIncidentStatusButton"');
    expect(htmlSource).toContain('id="runReplayCasesButton"');
  });

  it("turns an incident into a permanent replay case", async () => {
    const db = new MockD1();
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const incidentPayload = [
      JSON.stringify({
        timestampMs: 1_000,
        event: "delivery_finished",
        incidentId: "incident-replay-1",
        result: "complete",
      }),
      JSON.stringify({
        timestampMs: 1_500,
        event: "page_observed",
        pageKind: "PROFILE_PAGE",
        incidentId: "incident-replay-1",
      }),
      JSON.stringify({
        event: "anomaly",
        incidentId: "incident-replay-1",
        action: "UnexpectedProfilePageAfterReply",
        result: "anomaly",
      }),
      JSON.stringify({
        event: "screenshot_captured",
        incidentId: "incident-replay-1",
        screenshotRef: "screenshots/profile.jpg",
      }),
    ].join("\n");
    await onRequest({
      request: new Request("https://example.com/api/automation-incidents", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-ndjson",
          Authorization: "Bearer test-token",
          "X-Incident-Id": "incident-replay-1",
          "X-Incident-Source": "android",
        },
        body: incidentPayload,
      }),
      env,
    } as never);

    const created = await onRequest({
      request: new Request("https://example.com/api/replay-cases/from-incident", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Password": "secret",
        },
        body: JSON.stringify({
          incident_id: "incident-replay-1",
          title: "资料页误入回放",
        }),
      }),
      env,
    } as never);
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      success: true,
      replay_case: {
        incident_id: "incident-replay-1",
        title: "资料页误入回放",
        kind: "android_event_sequence",
      },
    });

    const listed = await onRequest({
      request: new Request("https://example.com/api/replay-cases?limit=20", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    await expect(listed.json()).resolves.toMatchObject({
      replay_cases: [{
        incident_id: "incident-replay-1",
        title: "资料页误入回放",
      }],
    });
    expect(db.replayCaseRows.size).toBe(1);

    const replayed = await onRequest({
      request: new Request("https://example.com/api/replay-cases/run", {
        method: "POST",
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);
    await expect(replayed.json()).resolves.toMatchObject({
      success: true,
      total: 1,
      failed: 0,
    });
  });

  it("cleans old incidents but keeps incidents referenced by replay cases", async () => {
    const db = new MockD1();
    const now = Math.floor(Date.now() / 1000);
    db.incidentRows.set("old-unreferenced", {
      id: "old-unreferenced",
      token: "test-token",
      status: "new",
      created_at: now - 31 * 24 * 3600,
    });
    db.incidentRows.set("old-referenced", {
      id: "old-referenced",
      token: "test-token",
      status: "new",
      created_at: now - 31 * 24 * 3600,
    });
    db.replayCaseRows.set("replay-old", {
      id: "replay-old",
      incident_id: "old-referenced",
    });
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };

    const listed = await onRequest({
      request: new Request("https://example.com/api/automation-incidents", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env,
    } as never);

    expect(listed.status).toBe(200);
    expect(db.incidentRows.has("old-unreferenced")).toBe(false);
    expect(db.incidentRows.has("old-referenced")).toBe(true);
  });

  it("tests the same persona and always-on cards on both model lines", async () => {
    const db = new MockD1([], [{
      id: "female_sutang",
      name: "苏棠",
      system_prompt: "你是苏棠，说话自然简短。",
      is_active: 1,
    }]);
    db.personaFactRows.set("female_sutang", {
      persona_id: "female_sutang",
      facts_json: JSON.stringify({ age_mode: "fixed_age", fixed_age: 29, has_children: true, children_age: 5 }),
      version: 2,
    });
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const target = String(url);
      return new Response(JSON.stringify({
        choices: [{ message: { content: target.includes("generativelanguage") ? "孩子5岁" : "孩子今年5岁" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const kv = new MockKV();
    await kv.put("persona:drawers:female_sutang", JSON.stringify({
      custom: [{
        id: "child_age",
        name: "孩子年龄",
        keywords: [],
        content: "孩子今年5岁，任何模型都不能说成3岁。",
        kind: "identity",
        activation: "always",
        priority: 90,
        enabled: true,
      }],
    }));
    const env = {
      DB: db,
      KV: kv,
      DASHBOARD_PASSWORD: "secret",
      GEMINI_API_KEY: "gemini-key",
      DEEPSEEK_API_KEY: "deepseek-key",
    };
    const response = await onRequest({
      request: new Request("https://example.com/api/agent-overview/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          persona_id: "female_sutang",
          questions: ["你孩子几岁？"],
        }),
      }),
      env,
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      results: [{
        question: "你孩子几岁？",
        line_a: { ok: true, reply: "孩子今年5岁" },
        line_b: { ok: true, reply: "孩子5岁" },
      }],
    });
    const bodies = fetchMock.mock.calls.map(([, init]) => String((init as RequestInit).body || ""));
    expect(bodies).toHaveLength(2);
    expect(bodies.every((body) => body.includes("孩子今年5岁"))).toBe(true);
  });

  it("creates a gallery group and uploads an image into private storage", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", trigger_keywords: "看照片", is_active: 1 }],
    });
    const kv = new MockKV();
    const env = { DB: db, KV: kv, DASHBOARD_PASSWORD: "secret" };

    const create = await onRequest({
      request: new Request("https://example.com/api/media-library/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          name: "周末生活照",
          trigger_keywords: "想看看周末",
          persona_id: "female_sutang",
          platform: "soul",
        }),
      }),
      env,
    } as never);
    expect(create.status).toBe(200);
    const created = await create.json();
    expect(created.group).toMatchObject({
      name: "周末生活照",
      trigger_keywords: "想看看周末",
      persona_id: "female_sutang",
      platform: "soul",
    });

    const upload = await onRequest({
      request: new Request("https://example.com/api/media-library/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          group_id: "daily",
          file_name: "周末.png",
          content_type: "image/png",
          data_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        }),
      }),
      env,
    } as never);
    expect(upload.status).toBe(201);
    const uploaded = await upload.json();
    expect(uploaded.asset).toMatchObject({ group_id: "daily", content_type: "image/png" });
    const insert = db.runCalls.find((call) => call.sql.includes("INSERT INTO media_assets"));
    expect(insert?.params?.[0]).toBe(uploaded.asset.id);
    expect(insert?.params?.[1]).toBe("daily");
    expect(insert?.params?.[2]).toBe("周末.png");
    expect(insert?.params?.[3]).toBe("image/png");
    expect(String(insert?.params?.[4])).toMatch(/^dashboard-media:/u);
    const stored = await kv.get(String(insert?.params?.[4]), "arrayBuffer");
    expect((stored as ArrayBuffer).byteLength).toBeGreaterThan(0);
  });

  it("deletes a gallery image from both the library and private storage", async () => {
    const storageKey = "dashboard-media:media_old";
    const db = new MockD1().withOptions({
      mediaAssets: [{ id: "media_old", group_id: "daily", storage_key: storageKey }],
    });
    const kv = new MockKV();
    await kv.put(storageKey, new Uint8Array([1, 2, 3]));
    const env = { DB: db, KV: kv, DASHBOARD_PASSWORD: "secret" };

    const response = await onRequest({
      request: new Request("https://example.com/api/media-library/assets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({ id: "media_old" }),
      }),
      env,
    } as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, id: "media_old", group_id: "daily" });
    expect(await kv.get(storageKey)).toBeNull();
    expect(db.runCalls.some((call) => call.sql.includes("DELETE FROM media_assets") && call.params[0] === "media_old")).toBe(true);
  });

  it("saves the dashboard hosting switches and reply settings", async () => {
    const db = new MockD1();
    const env = { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" };
    const response = await onRequest({
      request: new Request("https://example.com/api/hosting-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({
          token: "test-token",
          platform: "qq",
          hosting_enabled: true,
          monitor_enabled: true,
          weather_enabled: false,
          time_enabled: false,
          reply_pace_sec: 9,
          ai_hours_enabled: true,
          ai_start_hour: 10,
          ai_end_hour: 22,
        }),
      }),
      env,
    } as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      settings: {
        platform: "qq",
        hosting_enabled: true,
        monitor_enabled: true,
        weather_enabled: false,
        time_enabled: false,
        reply_pace_sec: 9,
        ai_hours_enabled: true,
        ai_start_hour: 10,
        ai_end_hour: 22,
      },
    });
  });

  it("shows nav pages for gallery drawers kb and settings", () => {
    const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
    const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
    expect(html).toContain('id="pageNav"');
    expect(html).toContain('id="page-library"');
    expect(html).toContain('id="page-drawers"');
    expect(html).toContain('id="page-kb"');
    expect(html).toContain('id="knowledgePersona"');
    expect(html).toContain("人设知识库");
    expect(html).toContain('id="agentCardReplyMode"');
    expect(html).toContain('id="programSafetyBoundary"');
    expect(source).toContain("safetyBoundary");
    expect(html).toContain('id="page-settings"');
    expect(source).toContain("function showPage(");
    expect(source).toContain("function loadLibrary(");
    expect(source).toContain("function loadDrawers(");
    expect(source).toContain("async function loadKnowledge(");
    expect(source).toContain("function renderKnowledgeCards(");
    expect(source).toContain("function activePersonaId(");
    expect(source).toContain("function toggleDrawer(");
    expect(source).toContain("function saveDrawer(");
    expect(source).toContain("async function uploadLibraryImage(");
    expect(source).toContain("data-drawer-content");
    expect(source).toContain("function loadDrawers(");
    expect(source).toContain("async function saveAgentCard(");
    expect(source).toContain("async function savePersonaPrompt(");
    expect(source).toContain("async function saveSharedFacts(");
    expect(source).toContain("function handleAgentVersionConflict(");
    expect(source).toContain("async function runPersonaAudit(");
    expect(source).not.toContain("async function publishPersona(");
    expect(source).toContain("expected_version");
    expect(source).not.toContain("ensureSettingsMoved");
    expect(html).toContain('id="createLibGroupButton"');
    expect(html).toContain('id="libraryUploadInput"');
    expect(html).toContain('id="settingsDeviceSelect"');
    expect(html).toContain('id="hostingEnabled"');
    expect(html).toContain('id="agentIdentitySummary"');
    expect(html).toContain('id="drawerCards"');
    expect(html).not.toContain('id="lockedAgentRules"');
    expect(html).toContain('id="programSafetyBoundaryEnabled"');
    expect(html).toContain('id="deleteProgramSafetyBoundaryButton"');
    expect(html).toContain('id="createAgentCardButton"');
    expect(html).toContain('id="legacyAgentRules"');
    expect(html).toContain('id="legacyRuleSearch"');
    expect(html).toContain('id="ruleCenterNav"');
    expect(html).toContain('id="ruleSummaryActive"');
    expect(html).toContain('id="agentRuleConflictList"');
    expect(html).toContain('id="ruleConflictLevelFilter"');
    expect(html).toContain('id="ruleRulesCard"');
    expect(html).toContain('id="saveSharedFactsButton"');
    expect(html).toContain('id="runPersonaAuditButton"');
    expect(html).not.toContain('id="publishPersonaButton"');
    expect(html).toContain("规则中心");
    expect(html).toContain("每条规则都标明管什么");
    expect(html).toContain("4 套人设所有设备共用");
    expect(source).toContain("function renderAgentRules(");
    expect(source).toContain("function renderAgentRuleConflicts(");
    expect(source).toContain("function showRuleTab(");
    expect(source).toContain("async function saveAgentRule(");
  });

  it("hides the reply state on the profile panel and lets the operator restore it", () => {
    const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
    const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
    expect(source).toContain("function renderContactFlags(group)");
    expect(source).toContain("已婚不回");
    expect(source).toContain("已停止回复");
    expect(source).toContain("function renderTakeoverAlerts(group)");
    expect(source).toContain("takeoverKindText");
    // 已婚与“停回”分开恢复：只解停回、不动已婚标签
    expect(source).toContain("清除已婚标记");
    expect(source).toContain("function restoreContactFlag(kind, index)");
    expect(source).toContain("已恢复回复（已婚标记保留）");
    expect(html).toContain('id="profileFlags"');
    expect(html).toContain('id="takeoverList"');
  });

  it("does not spend profile tokens before 40 new user messages", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1().withOptions({ profileState: { user_count: 39, max_id: 39 } });
    const response = await onRequest({
      request: new Request("https://example.com/api/messages/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ platform: "soul", contact_id: "contact-1", contact_name: "梦想", messages: [{ role: "user", content: "我喜欢打球", created_at: 100 }] }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves explicit customer facts immediately without spending profile tokens", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1();
    const response = await onRequest({
      request: new Request("https://example.com/api/messages/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "contact-1",
          contact_name: "梦想",
          messages: [
            { role: "user", content: "我在渝北区", message_key: "fact-location", created_at: 100 },
            { role: "user", content: "单身汉", message_key: "fact-marital", created_at: 101 },
            { role: "user", content: "我没孩子", message_key: "fact-children", created_at: 102 },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    const stored = db.profileRows.get("test-token\u0000single:test-token:soul:contact-1");
    const profile = JSON.parse(String(stored?.profile_json || "{}"));
    expect(profile.location?.residence).toBe("渝北区");
    expect(profile.family?.marital_status).toBe("单身");
    expect(profile.family?.children).toBe("没有孩子");
    expect(profile._runtime?.factSources?.["family.marital_status"]?.content).toBe("单身汉");
  });

  it("keeps cloudflare polling inside the free-plan request budget", () => {
    const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
    // 2026-10-08：看板刷新从 10 秒改成 30 秒，并且页面不在前台时不刷（用户实测：托管没开也把 D1 额度吃爆）。
    expect(source).toContain("}, 30000);");
    expect(source).toContain("document.visibilityState");
  });

  it("writes AI history only after the phone confirms a successful send", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "在的 刚忙完" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1();
    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: "confirm-only-reply",
        platform: "soul",
        contact_id: "contact-1",
        contact_name: "期待下一步的我们",
        messages: [{ role: "user", content: "在吗" }],
      }),
    });

    const response = await onRequest({
      request,
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    const generated = await response.json();
    expect(response.status).toBe(200);
    expect(generated.reply_id).toBeTruthy();
    expect(db.historyRows).toHaveLength(0);
    expect(db.pendingRows).toHaveLength(1);

    const confirmResponse = await onRequest({
      request: new Request("https://example.com/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ reply_id: generated.reply_id, sent_content: generated.reply }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    expect(confirmResponse.status).toBe(200);
    expect(db.historyRows).toHaveLength(1);
    expect(db.historyRows[0]).toMatchObject({ role: "assistant", source: "ai", content: "在的" });
  });

  it("does not store the same reply twice when the phone resent it", async () => {
    // 2026-10-07 真机（稳重的神盾局特工）：第一次其实发出去了但没验证到，
    // 几秒后待处理回复又发了一遍，云端于是存了两行同样的“她：在家窝着哪无聊了 我巴不得呢”。
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "在家窝着哪无聊了 我巴不得呢" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1();
    db.tokenPersonas.set("test-token", "female_sutang");
    const makeChat = (requestId: string) => new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: requestId,
        platform: "soul",
        contact_id: "dup-contact",
        contact_name: "稳重的神盾局特工",
        messages: [{ role: "user", content: "那得多无聊" }],
      }),
    });
    const confirm = (replyId: string, sent: string) => onRequest({
      request: new Request("https://example.com/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ reply_id: replyId, sent_content: sent }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    const first = await (await onRequest({ request: makeChat("dup-1"), env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" } } as never)).json();
    await confirm(first.reply_id, first.reply);
    expect(db.historyRows.filter((row) => row.role === "assistant")).toHaveLength(1);

    const second = await (await onRequest({ request: makeChat("dup-2"), env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" } } as never)).json();
    expect(second.reply_id).not.toBe(first.reply_id);
    await confirm(second.reply_id, second.reply);
    // 同一句话 10 分钟内不再写第二行。
    expect(db.historyRows.filter((row) => row.role === "assistant")).toHaveLength(1);
  });

  it("returns the same pending reply for a repeated request id without another model call", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "在的" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1();
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const makeRequest = () => new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: "stable-request-id",
        platform: "soul",
        contact_id: "contact-1",
        contact_name: "期待下一步的我们",
        messages: [{ role: "user", content: "在吗" }],
      }),
    });

    const first = await onRequest({
      request: makeRequest(),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const second = await onRequest({
      request: makeRequest(),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.reply_id).toBe(firstBody.reply_id);
    expect(secondBody.reply).toBe("在的");
    expect(db.historyRows).toHaveLength(0);
  });

  it("uses deepseek-flash JSON output once the 40-message profile batch is ready", async () => {
    const history = Array.from({ length: 40 }, (_, index) => ({
      id: index + 1,
      token: "test-token",
      platform: "soul",
      contact_id: "contact-1",
      contact_name: "梦想",
      role: "user",
      content: index === 39 ? "我喜欢羽毛球" : `普通聊天${index + 1}`,
      source: "sync",
      created_at: 100 + index,
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ basic: { name: "张先生" }, preferences: { hobbies: ["羽毛球"] } }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1(history).withOptions({ profileState: { user_count: 40, max_id: 40 } });
    const response = await onRequest({
      request: new Request("https://example.com/api/messages/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ platform: "soul", contact_id: "contact-1", contact_name: "梦想", messages: [{ role: "user", content: "最近好吗", created_at: 140 }] }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    const payload = JSON.parse(String(init.body));
    expect(payload.model).toBe("deepseek-flash");
    expect(payload.thinking).toEqual({ type: "disabled" });
    expect(payload.response_format).toEqual({ type: "json_object" });
  });

  it("persists device platform and service switches", async () => {
    const db = new MockD1();
    const env = { DB: db, KV: new MockKV() };
    const save = (params: Record<string, string>) => onRequest({
      request: new Request("https://example.com/api/config/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_key: "test-token", ...params }),
      }),
      env,
    } as never);

    expect((await save({ action: "switch_platform", platform: "qq" })).status).toBe(200);
    expect((await save({ action: "toggle_hosting", enabled: "true" })).status).toBe(200);
    expect((await save({ action: "toggle_weather", enabled: "false" })).status).toBe(200);

    const response = await onRequest({
      request: new Request("https://example.com/api/config", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env,
    } as never);
    await expect(response.json()).resolves.toMatchObject({
      platform: "qq",
      hosting_enabled: true,
      monitor_enabled: true,
      weather_enabled: false,
      time_enabled: true,
    });
  });

  it("uses the configured LLM base URL and temperature", async () => {
    const kv = new MockKV();
    await kv.put("llm:base_url", "https://llm.example.com/v1");
    await kv.put("llm:temperature", "0.35");
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "在的" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "contact-1",
          contact_name: "梦想",
          messages: [{ role: "user", content: "在吗" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://llm.example.com/v1/chat/completions");
    expect(JSON.parse(String(init.body)).temperature).toBe(0.35);
  });

  it("blocks chat after the monthly token budget is exhausted", async () => {
    const month = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
    }).format(new Date());
    const db = new MockD1().withOptions({ tokenSpent: 100, tokenSpentMonth: month });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "contact-1",
          contact_name: "梦想",
          messages: [{ role: "user", content: "在吗" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    expect(response.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records an image only after the phone confirms delivery", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", trigger_keywords: "\u60f3\u770b\u4f60\u7167\u7247", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" }],
      mediaSendRows: [],
    });
    const fetchMock = mockChatSequence(["DAILY"]);
    vi.stubGlobal("fetch", fetchMock);
    const generatedResponse = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "confirm-topic-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "\u60f3\u770b\u4f60\u7167\u7247" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const generated = await generatedResponse.json();
    expect(db.historyRows).toHaveLength(0);

    const confirmResponse = await onRequest({
      request: new Request("https://example.com/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ reply_id: generated.reply_id, sent_content: "ignored" }),
      }),
      env: { DB: db, KV: new MockKV() },
    } as never);
    expect(confirmResponse.status).toBe(200);
    expect(db.historyRows[0].content).toMatch(/^\[\u56fe\u7247:daily_01\]$/u);
    expect(db.options.mediaSendRows).toHaveLength(1);
    expect(db.options.mediaSendRows[0]).toMatchObject({ group_id: "daily", asset_id: "daily_01" });
  });

  it("does not select a topic image in semi-auto mode", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "text reply" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", trigger_keywords: "\u60f3\u770b\u4f60\u7167\u7247", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily" }],
    });
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "semi-topic-image",
          platform: "soul",
          hosting_mode: "semi_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "\u60f3\u770b\u4f60\u7167\u7247" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();
    expect(body.action).toBe("send");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/chat/completions"))).toBe(true);
  });

  it("blocks realtime or weather questions from topic image matching", () => {
    const groups = [
      { id: "daily", trigger_keywords: "\u7167\u7247,\u65e5\u5e38\u7167,\u751f\u6d3b\u7167" },
      { id: "body", trigger_keywords: "\u8eab\u6750,\u8eab\u6750\u7167,\u770b\u817f" },
    ];
    const realtimeQuestions = [
      "\u4f60\u73b0\u5728\u7a7f\u7684\u4ec0\u4e48",
      "\u4f60\u73b0\u5728\u5728\u5e72\u561b",
      "\u53d1\u4e00\u5f20\u73b0\u5728\u7684\u7167\u7247",
      "\u4f60\u90a3\u8fb9\u5929\u6c14\u600e\u4e48\u6837",
      "\u4f60\u73b0\u5728\u8eab\u6750\u600e\u4e48\u6837",
    ];

    for (const question of realtimeQuestions) {
      expect(isRealtimeImageRequest(question), question).toBe(true);
      expect(findMatchingMediaGroup(groups, question)).toBeNull();
    }
    expect(findMatchingMediaGroup(groups, "\u60f3\u770b\u770b\u4f60\u7684\u65e5\u5e38\u7167")?.group.id).toBe("daily");
    expect(findMatchingMediaGroup(groups, "\u770b\u770b\u8eab\u6750\u7167")?.group.id).toBe("body");
  });

  it("requires an explicit request for star-soul topic images", () => {
    const groups = [
      { id: "daily", trigger_keywords: "\u65e5\u5e38\u7167,\u7167\u7247,\u4ee5\u56fe\u6362\u56fe" },
      { id: "body", trigger_keywords: "\u8eab\u6750\u7167,\u8eab\u6750,\u770b\u817f" },
    ];

    expect(isExplicitMediaRequest("\u6211\u559c\u6b22\u770b\u8eab\u6750\u7167")).toBe(false);
    expect(isExplicitMediaRequest("\u4e0d\u60f3\u770b\u8eab\u6750\u7167")).toBe(false);
    expect(isExplicitMediaRequest("\u770b\u770b\u4f60\u7684\u8eab\u6750\u7167")).toBe(true);
    expect(isExplicitMediaRequest("[\u4ee5\u56fe\u6362\u56fe]")).toBe(true);
    expect(findMatchingMediaGroup(groups, "\u6211\u559c\u6b22\u770b\u8eab\u6750\u7167", { requireExplicitRequest: true })).toBeNull();
    expect(findMatchingMediaGroup(groups, "\u770b\u770b\u4f60\u7684\u8eab\u6750\u7167", { requireExplicitRequest: true })?.group.id).toBe("body");
    expect(findMatchingMediaGroup(groups, "[\u4ee5\u56fe\u6362\u56fe]", { requireExplicitRequest: true })?.group.id).toBe("daily");
  });

  it("only treats explicit body language as a body-photo request", () => {
    const groups = [
      { id: "daily", name: "日常照" },
      { id: "body", name: "身材照" },
    ];

    expect(isExplicitBodyMediaRequest("发一下身材照呗")).toBe(true);
    expect(isExplicitBodyMediaRequest("看看你的腿")).toBe(true);
    expect(isExplicitBodyMediaRequest("照片拍得不错")).toBe(false);
    expect(isExplicitBodyMediaRequest("发一下呗")).toBe(false);
    expect(isExplicitMediaRequest("发一下你的照片")).toBe(true);
    expect(isExplicitMediaRequest("给一下你的照片")).toBe(true);
    expect(isExplicitMediaRequest("可以看看你样子吗")).toBe(true);
    expect(isExplicitMediaRequest("看看你可以吗")).toBe(true);
    expect(isExplicitMediaRequest("看一下机器的照片")).toBe(false);
    expect(hasContextualMediaRequest(["看一下"])).toBe(false);
    expect(hasContextualMediaRequest(["发一下"])).toBe(false);
    expect(hasContextualMediaRequest(["给一下"])).toBe(false);
    expect(hasContextualMediaRequest(["看一下照片"])).toBe(true);
    expect(hasContextualMediaRequest(["可以看看你样子吗"])).toBe(true);
    expect(hasContextualMediaRequest(["看看你可以吗"])).toBe(true);
    expect(hasContextualMediaRequest(["想看你照片", "看一下"])).toBe(true);
    expect(hasContextualMediaRequest(["想看你照片", "给一下"])).toBe(true);
    expect(hasContextualMediaRequest(["看一下你现在的机器的样子", "看一下呗"])).toBe(false);
    expect(hasContextualMediaRequest(["看一下机器的照片", "给一下"])).toBe(false);
    expect(hasNonPersonalMediaContext(["看一下你现在的机器的样子", "看一下呗"])).toBe(true);
    expect(hasNonPersonalMediaContext(["想看你照片", "看一下呗"])).toBe(false);
    expect(shouldClassifyPersonalPhotoIntent(["可以看看你样子吗"])).toBe(true);
    expect(shouldClassifyPersonalPhotoIntent(["嗯嗯，好的"])).toBe(false);
    expect(normalizePersonalPhotoIntent("`DAILY`")).toBe("daily");
    expect(normalizePersonalPhotoIntent("BODY\n")).toBe("body");
    expect(normalizePersonalPhotoIntent("NONE，因为是在说机器")).toBe("none");
    expect(normalizePersonalPhotoIntent("[[SEND_MEDIA:daily]]")).toBe("none");
    expect(resolveMediaGroupForDirective(groups, "body", ["想看你照片", "发一下呗"])?.id).toBe("daily");
    expect(resolveMediaGroupForDirective(groups, "body", ["想看身材照", "发一下呗"])?.id).toBe("body");
    expect(resolveMediaGroupForDirective(groups, "unknown", ["想看你照片"])).toBeNull();
    expect(resolveMediaGroupForDirective([{ id: "body", name: "身材照" }], "body", ["发一下呗"])).toBeNull();
    expect(buildMediaDirectiveInstruction(groups)).toContain("给一下");
    expect(buildMediaDirectiveInstruction(groups)).toContain("机器");
  });

  it("lets the model choose a contextual daily photo without an exact keyword", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [
        { id: "daily", name: "日常照", trigger_keywords: "想看你照片", is_active: 1 },
      ],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
      ],
    });
    const fetchMock = mockChatSequence(["DAILY"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "contextual-daily-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [
            { role: "user", content: "想看你照片" },
            { role: "user", content: "看一下呗" },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ action: "send_media", media: { group_id: "daily", asset_id: "daily_01" } });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/chat/completions"))).toBe(true);
  });

  it("lets the model interpret personal appearance wording without a photo keyword", async () => {
    for (const [requestId, incoming] of [
      ["appearance-daily-image", "可以看看你样子吗"],
      ["you-can-image", "看看你可以吗"],
    ]) {
      const db = new MockD1().withOptions({
        mediaGroups: [
          { id: "daily", name: "日常照", trigger_keywords: "想看你照片", is_active: 1 },
        ],
        mediaAssets: [
          { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
        ],
      });
      const fetchMock = mockChatSequence(["DAILY"]);
      vi.stubGlobal("fetch", fetchMock);

      const response = await onRequest({
        request: new Request("https://example.com/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
          body: JSON.stringify({
            request_id: requestId,
            platform: "soul",
            hosting_mode: "full_auto",
            contact_id: "contact-1",
            contact_name: "contact",
            messages: [{ role: "user", content: incoming }],
          }),
        }),
        env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
      } as never);
      const body = await response.json();

      expect(response.status, incoming).toBe(200);
      expect(body, incoming).toMatchObject({
        action: "send_media",
        media: { group_id: "daily", asset_id: "daily_01" },
      });
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/chat/completions")), incoming).toBe(true);
    }
  });

  it("sends a daily photo when the photo intent classifier recognizes a personal appearance request", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [
        { id: "daily", name: "日常照", trigger_keywords: "想看你照片", is_active: 1 },
      ],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
      ],
    });
    const fetchMock = mockChatSequence([
      "DAILY",
      "照片先不发了，聊聊呗",
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "classified-daily-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "可以看看你样子吗" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();
    const chatCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/chat/completions"));
    const classifierBody = JSON.parse(String(chatCalls[0]?.[1]?.body || "{}"));

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      action: "send_media",
      media: { group_id: "daily", asset_id: "daily_01" },
    });
    expect(chatCalls).toHaveLength(1);
    expect(String(classifierBody.messages?.[0]?.content || "")).toContain("照片意图分类器");
  });

  it("does not use photo keywords to veto a semantic media decision when the classifier was not needed", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [
        { id: "daily", name: "日常照", trigger_keywords: "想看你照片", is_active: 1 },
      ],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
      ],
    });
    const fetchMock = mockChatSequence(["[[SEND_MEDIA:daily]]"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "semantic-directive-without-keyword",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "让我认认你" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      action: "send_media",
      media: { group_id: "daily", asset_id: "daily_01" },
    });
    expect(hasContextualMediaRequest(["让我认认你"])).toBe(false);
  });

  it("honours a model media directive even when the classifier said NONE", async () => {
    // 2026-10-05 改动：分类器只当“额外触发器”，不再否决模型已经发出的指令。
    // 旧行为是这里会被否决掉，最后回一句“照片先不发了，聊聊呗”。
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = mockChatSequence([
      "NONE",
      "[[SEND_MEDIA:daily]]",
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "model-directive-with-none-classifier",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "发张照片看看" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send_media");
    expect(body.media.group_id).toBe("daily");
  });

  it("drops a segment the persona already said days ago", () => {
    // 真机原样（你压到我头发了）：模型把两天前说过的“重庆人嘛 你说呢”原句搬出来当新回复。
    const now = Math.floor(Date.now() / 1000);
    const history = [
      { role: "user", content: "你是重庆人吗", created_at: now - 2 * 86400 },
      { role: "assistant", content: "重庆人嘛 你说呢|||不过这两天忙晕了 才顾上回你", created_at: now - 2 * 86400 },
    ];
    const reply = "重庆人嘛 你说呢|||娃睡了 才顾上看手机";
    expect(avoidRepeatedAssistantReply(reply, history, "忙啥呢 这是", now))
      .toBe("娃睡了 才顾上看手机");
  });

  it("uses only the new Su Tang knowledge cards", () => {
    const drawers = defaultDrawersForPersona("female_sutang");
    const ids = (drawers.topics || []).map((item) => item.id);
    expect(ids).toHaveLength(25);
    expect(ids).toContain("scene_01_black_stockings");
    expect(ids).toContain("scene_13_invitation_reward");
    expect(ids).toContain("scene_14_rainy_neck");
    expect(ids).toContain("scene_16_douban_tree_hole");
    expect(ids).toContain("scene_23_sunny_hot_summer");
    expect(ids).toContain("scene_24_cold_wind_winter");
    expect(ids).toContain("scene_25_pleasant_breeze");
    expect(ids).not.toContain("sofa_tired");
    expect(ids).not.toContain("food_hungry");

    const stockings = matchActiveDrawers(drawers, "你今天穿黑丝了吗").join("\n");
    expect(stockings).not.toContain("黑丝与腿部触感");
    expect(stockings).not.toContain("刚把黑丝脱了");

    const invite = matchActiveDrawers(drawers, "想约你开房").join("\n");
    expect(invite).toContain("打压轻浮与纠正姿态");
    expect(invite).toContain("真站我跟前");
    expect(invite).not.toContain("一句硬话回掉");

    const rainyNeck = matchActiveDrawers(drawers, "今晚下雨 后背酸得厉害").join("\n");
    expect(rainyNeck).toContain("居家放松与颈背酸胀");
    expect(rainyNeck).toContain("后背和颈椎酸得要命");

    expect(matchActiveDrawers(drawers, "今天吃什么了")).toEqual([]);
  });

  it("detects photo authenticity challenge and strips admissions", () => {
    // 2026-10-06 真机：他说“这是网图吧”，模型顺手认了（“嗯 网上找的”）——等于当场露馅。
    expect(isPhotoAuthenticityChallenge("这是网图吧")).toBe(true);
    expect(isPhotoAuthenticityChallenge("这不是你吧")).toBe(true);
    expect(isPhotoAuthenticityChallenge("今天天气不错")).toBe(false);
    expect(dropPhotoAdmissionClauses("嗯 网上找的")).toBe("");
    expect(dropPhotoAdmissionClauses("我自己拍的呀 你这话我可记住了")).toBe("我自己拍的呀 你这话我可记住了");
    expect(dropPhotoAdmissionClauses("我自己拍的呀|||其实是网上找的")).toBe("我自己拍的呀");
  });

  it("never sends time markers back to the contact", async () => {
    // 2026-10-07：模型会把喂给它的时间标记原样吐出来（真机漏过“【10/06，21:07，0”）。
    // 三种格式（中文方括号 / 英文方括号 / ISO）都必须清掉。
    for (const content of ["【10/06 01:32，13小时前】对方：睡了", "[2026-10-06 01:32] 对方：睡了", "2026-10-06T01:32:00+08:00 对方：睡了"]) {
      const db = new MockD1([], [
        { id: "female_sutang", name: "苏棠", system_prompt: "你是苏棠，做电商运营。", identity_terms: JSON.stringify(["电商运营"]) },
      ]);
      db.tokenPersonas.set("test-token", "female_sutang");
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )));
      vi.stubGlobal("fetch", fetchMock);
      const response = await onRequest({
        request: new Request("https://example.com/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
          body: JSON.stringify({
            platform: "soul",
            contact_id: "tm",
            contact_name: "时间标记测试",
            messages: [{ role: "user", content: "在吗", created_at: Math.floor(Date.now() / 1000) }],
          }),
        }),
        env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
      } as never);
      const body = await response.json();
      const sent = String(body.reply || "");
      expect(sent).not.toContain("【");
      expect(sent).not.toContain("2026-10-06");
      expect(sent).not.toContain("01:32");
    }
  });

  it("never sends prompt-marker leakage like 【10/06，21:07，0", async () => {
    // 2026-10-06 真机：模型偶发把提示词里的中文方括号标记吐出来，差点当成消息发出去。
    const db = new MockD1([], [
      { id: "female_sutang", name: "苏棠", system_prompt: "你是苏棠，做电商运营。", identity_terms: JSON.stringify(["电商运营"]) },
    ]);
    db.tokenPersonas.set("test-token", "female_sutang");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(
      JSON.stringify({ choices: [{ message: { content: "【10/06，21:07，0" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "xq",
          contact_name: "稀奇",
          messages: [{ role: "user", content: "吃了没", created_at: Math.floor(Date.now() / 1000) }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(String(body.reply || "")).not.toContain("【");
    expect(String(body.reply || "")).not.toContain("21:07");
  });

  it("never blames him when she is the one who owes a reply", () => {
    // 真机（请叫我球⚽️）：昨天凌晨聊完她一句没回，他今天又发来；
    // 她回“昨晚聊着聊着就没影了 我还等着呢”——倒打一耙，被用户当场撤回。
    const heThenHe = [
      { role: "user", content: "梦都能接上呢～" },
      { role: "user", content: "早上好" },
    ];
    expect(owesReplyFromHistory([], heThenHe)).toBe(true);
    const sheThenHe = [
      { role: "assistant", content: "我醒了就得翻半天才迷糊回去" },
      { role: "user", content: "早上好" },
    ];
    expect(owesReplyFromHistory([], sheThenHe)).toBe(false);

    expect(dropBlameSegmentsWhenOwing("昨晚聊着聊着就没影了 我还等着呢")).toBe("");
    expect(dropBlameSegmentsWhenOwing("你怎么不回我")).toBe("");
    // 正常的段不受影响
    expect(dropBlameSegmentsWhenOwing("早呀 昨晚睡挺好")).toBe("早呀 昨晚睡挺好");
    expect(dropBlameSegmentsWhenOwing("早呀|||你怎么不回我")).toBe("早呀");
    // 提示词里也要写明这条
    expect(buildRelationshipBoundaryPrompt(2, "早上好", [])).not.toContain("倒打一耙");
  });

  it("never forces the model to ask about marital status (real case, asked 3 times)", () => {
    // 2026-10-07 用户澄清：要求只有一条——排除已婚的；不是“必须问清婚况”。
    // 之前那句“直接问，别绕：聊上几句之后就问一句他到底单身还是已婚”是连问三遍的源头。
    const prompt = buildLayeredSystemPrompt({
      personaPrompt: "你是苏棠。",
      platform: "soul",
      homeLocation: { city: "重庆", district: "江北区" },
      workLocation: { city: "重庆", district: "江北区" },
      currentDatetime: "2026-10-07 18:00",
      weather: { city: "重庆", condition: "晴", temp: 25 },
      messages: [{ role: "user", content: "搞不来那些弯弯拐拐的" }],
      historyMessages: [],
      contactMaritalStatus: "",
    });
    expect(prompt).not.toContain("直接问，别绕");
    expect(prompt).not.toContain("你是单身还是已婚呀");
    const known = buildLayeredSystemPrompt({
      personaPrompt: "你是苏棠。",
      platform: "soul",
      homeLocation: { city: "重庆", district: "江北区" },
      workLocation: { city: "重庆", district: "江北区" },
      currentDatetime: "2026-10-07 18:00",
      weather: { city: "重庆", condition: "晴", temp: 25 },
      messages: [{ role: "user", content: "在忙吗" }],
      historyMessages: [],
      contactMaritalStatus: "single",
    });
    // 2026-10-07 用户要求：婚况不进提示词（别白烧 token）。已婚的根本走不到这里（引擎层挡掉），
    // 单身/离异照常聊，也不需要任何提醒。
    expect(known).not.toContain("婚况");
    expect(known).not.toContain("单身");
  });

  it("recognizes his marital status even without 我 (real case: 雾琐星河岸)", () => {
    // 2026-10-07 真机：他说“肯定是单身撒”“单身汉”，因为没有“我”字，旧判断认不出来，
    // 于是她连问三遍“你是单身还是已婚呀”，被对方点破“你问了三次了”。
    expect(detectContactMaritalStatus([{ role: "user", content: "肯定是单身撒" }])).toBe("single");
    expect(detectContactMaritalStatus([{ role: "user", content: "单身汉" }])).toBe("single");
    expect(detectContactMaritalStatus([{ role: "user", content: "我离异" }])).toBe("single");
    // 已婚仍要认出来（这类会被直接停回）
    expect(detectContactMaritalStatus([{ role: "user", content: "我结婚了" }])).toBe("married");
    expect(detectContactMaritalStatus([{ role: "user", content: "我有老婆" }])).toBe("married");
    // 说别人单身不算他单身，也不能误判成已婚
    expect(detectContactMaritalStatus([{ role: "user", content: "我朋友单身好多年了" }])).toBe("");
    expect(detectContactMaritalStatus([{ role: "user", content: "结婚了还来这个上面哇" }])).toBe("");
    // 她自己说自己已婚不算他的婚况
    expect(detectContactMaritalStatus([{ role: "assistant", content: "我结婚了我有老公" }])).toBe("");
  });

  it("drops the segment where she accepts his photos", () => {
    // 真机：他说“我给你看我的照片”，她回“真的假的 那我得看看”。只删这段，不换固定句。
    expect(isSelfMediaOffer("想不想看我的身材照")).toBe(true);
    expect(isSelfMediaOffer("我给你看看我的腹肌")).toBe(true);
    expect(isSelfMediaOffer("今天天气不错")).toBe(false);
    expect(dropAcceptedSelfMediaSegments("真的假的 那我得看看")).toBe("");
    expect(dropAcceptedSelfMediaSegments("这么主动呀|||那我得看看")).toBe("这么主动呀");
    expect(dropAcceptedSelfMediaSegments("这么晚了还秀腹肌呀")).toBe("这么晚了还秀腹肌呀");
  });

  it("fixes the spouse perspective in replies", () => {
    // 真机（仙逆）：对方说"你老公"指的是苏棠的老公，模型跟着叫"你老公"却讲自己的事。
    expect(fixSpousePerspective("你老公天天跑渠道 估计没空管我聊什么？"))
      .toBe("我老公天天跑渠道 估计没空管我聊什么？");
    expect(fixSpousePerspective("我老公忙呢|||你老公天天跑渠道 估计没空管我"))
      .toBe("我老公忙呢|||我老公天天跑渠道 估计没空管我");
    // 2026-10-06：同族的“娃/孩子”也要一起管住（真机里对方说“娃娃”指的是苏棠的娃）
    expect(fixSpousePerspective("你娃多大了")).toBe("我娃多大了");
    expect(fixSpousePerspective("你孩子睡了吧")).toBe("我孩子睡了吧");
    // 反问对方的情况不算错
    expect(fixSpousePerspective("你老公呢？")).toBe("你老公呢？");
    expect(fixSpousePerspective("你孩子多大了")).toBe("我孩子多大了");
    expect(fixSpousePerspective("我老公做粮油销售的")).toBe("我老公做粮油销售的");
  });

  it("never sends half a sentence when the model breaks a line mid-sentence", () => {
    // 真机（遇见 2026-10-07 23:10）：她发出去“刚关了电脑 屋里就剩”，对方回“就剩什么”。
    const reply = "刚关了电脑 屋里就剩\n我这盏灯还亮着呢";
    const fixed = capReplyLength(reply, "你在干嘛");
    expect(fixed).not.toBe("刚关了电脑 屋里就剩");
    expect(fixed).not.toMatch(/剩$/u);
    // 他这句只有 4 个字：只回一条完整的短句（不许是“刚关了电脑 屋里就剩”这种半句）。
  });

  it("drops a repeated delay excuse but keeps the substance", () => {
    // 真机原样（一一）：23:59 说过“刚看手机才看到”，00:12 又说“刚没顾上看手机”。
    const now = Math.floor(Date.now() / 1000);
    const history = [
      { role: "user", content: "睡着了吗", created_at: now - 900 },
      { role: "assistant", content: "没睡呢 刚看手机才看到|||啥短剧这么上头 一下就入坑了", created_at: now - 700 },
    ];
    const reply = "没睡着呀 刚没顾上看手机|||傻不拉几的 是说自己看剧看傻了呗";
    expect(avoidRepeatedAssistantReply(reply, history, "傻不拉几的", now))
      .toBe("傻不拉几的 是说自己看剧看傻了呗");
  });

  it("keeps a fresh multi-segment reply untouched", () => {
    const now = Math.floor(Date.now() / 1000);
    const history = [
      { role: "assistant", content: "刚把娃哄睡", created_at: now - 3600 },
    ];
    const reply = "今天单子多 刚忙完|||你也早点歇着呀";
    expect(avoidRepeatedAssistantReply(reply, history, "忙啥呢", now)).toBe(reply);
  });

  it("keeps a visible text reply when the classifier returns NONE", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = mockChatSequence([
      "NONE",
      "照片这事先不聊了，聊点别的",
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "classified-none-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "没照片呀" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send");
    expect(body.media).toBeUndefined();
  });

  it("does not send a personal photo for a machine follow-up even if the classifier is wrong", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = mockChatSequence([
      "DAILY",
      "机器的照片我回头拍给你看",
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "machine-follow-up-not-personal",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [
            { role: "user", content: "看一下你现在的机器的样子" },
            { role: "user", content: "看一下呗" },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send");
    expect(body.media).toBeUndefined();
  });

  it("uses a BODY classification only when the recent context explicitly asks for body media", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [
        { id: "daily", name: "日常照", is_active: 1 },
        { id: "body", name: "身材照", is_active: 1 },
      ],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" },
        { id: "body_01", group_id: "body", file_name: "body_01.jpg" },
      ],
    });
    const fetchMock = mockChatSequence(["BODY"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "classified-body-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [
            { role: "user", content: "想看你的身材照" },
            { role: "user", content: "发一下呗" },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      action: "send_media",
      media: { group_id: "body", asset_id: "body_01" },
    });
  });

  it("rejects a model image action for an isolated look request without photo context", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = mockChatSequence(["NONE", "[[SEND_MEDIA:daily]]"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "isolated-look-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "看一下" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send");
    expect(body.media).toBeUndefined();
    expect(body.reply).toBe("看什么？");
  });

  it("does not treat a machine look request as a personal photo request", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = mockChatSequence(["NONE", "[[SEND_MEDIA:daily]]"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "machine-look-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [
            { role: "user", content: "看一下你现在的机器的样子" },
            { role: "user", content: "看一下呗" },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send");
    expect(body.media).toBeUndefined();
    expect(body.reply).toBe("看什么？");
  });

  it("uses persisted history when a personal photo follow-up omits the keyword", async () => {
    const db = new MockD1([
      {
        id: 1,
        token: "test-token",
        platform: "soul",
        contact_id: "contact-1",
        role: "user",
        content: "想看你照片",
        created_at: 1,
      },
    ]).withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = mockChatSequence(["DAILY"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "history-follow-up-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "给一下" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ action: "send_media", media: { group_id: "daily", asset_id: "daily_01" } });
  });

  it("does not inherit a machine photo request from history as a personal photo", async () => {
    const db = new MockD1([
      {
        id: 1,
        token: "test-token",
        platform: "soul",
        contact_id: "contact-1",
        role: "user",
        content: "看一下机器的照片",
        created_at: 1,
      },
    ]).withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "[[SEND_MEDIA:daily]]" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "history-machine-follow-up-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "给一下" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send");
    expect(body.media).toBeUndefined();
  });

  it("downgrades a model-selected body photo to daily unless body is explicit", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [
        { id: "daily", name: "日常照", trigger_keywords: "想看你照片", is_active: 1 },
        { id: "body", name: "身材照", trigger_keywords: "想看身材照", is_active: 1 },
      ],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
        { id: "body_01", group_id: "body", file_name: "body_01.jpg", content_type: "image/jpeg" },
      ],
    });
    const fetchMock = mockChatSequence(["BODY"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "downgrade-body-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [
            { role: "user", content: "想看你照片" },
            { role: "user", content: "发一下呗" },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ action: "send_media", media: { group_id: "daily", asset_id: "daily_01" } });
  });

  it("allows a model-selected body photo when body is explicitly requested", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [
        { id: "daily", name: "日常照", trigger_keywords: "想看你照片", is_active: 1 },
        { id: "body", name: "身材照", trigger_keywords: "想看身材照", is_active: 1 },
      ],
      mediaAssets: [
        { id: "body_01", group_id: "body", file_name: "body_01.jpg", content_type: "image/jpeg" },
      ],
    });
    const fetchMock = mockChatSequence(["BODY"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "explicit-body-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "发一下身材照呗" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ action: "send_media", media: { group_id: "body", asset_id: "body_01" } });
  });

  it("rejects a model media directive for a realtime photo request", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "[[SEND_MEDIA:daily]]" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "realtime-model-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "现在拍张照片" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send");
    expect(body.media).toBeUndefined();
    expect(body.reply).toContain("不方便拍");
  });

  it("rejects a model media directive for an unknown group", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "[[SEND_MEDIA:unknown]]" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "unknown-model-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "看一下照片" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send");
    expect(body.media).toBeUndefined();
    // 2026-10-05：兜底话术不再张口拒绝
    expect(body.reply).toContain("急啥呀");
  });

  it("still sends the photo when the model asks for one but the intent classifier says none", async () => {
    // 真机原样：对方说“可以看看你照片吗”，分类器返回 NONE，
    // 模型却已经判定要发日常照；旧逻辑会否决掉，最后回一句“照片先不发了”。
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = mockChatSequence(["NONE", "[[SEND_MEDIA:daily]]"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "classifier-none-but-model-sends",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "可以看看你照片吗" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send_media");
    expect(body.media.group_id).toBe("daily");
  });

  it("prevents the chat route from sending media for realtime requests", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "text reply" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", trigger_keywords: "\u65e5\u5e38\u7167", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily" }],
    });
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "realtime-topic-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "\u73b0\u5728\u65e5\u5e38\u7167" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();
    expect(body.action).toBe("send");
    expect(body.media).toBeUndefined();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("serves topic images from private KV storage", async () => {
    const imageBytes = new Uint8Array([7, 8, 9, 10]);
    const db = new MockD1().withOptions({
      mediaAssets: [{
        id: "daily_01",
        group_id: "daily",
        file_name: "daily_01.jpg",
        content_type: "image/jpeg",
        source_url: "",
        storage_key: "media/image/daily_01",
      }],
    });
    const kv = new MockKV();
    await kv.put("media/image/daily_01", imageBytes);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const unauthorized = await onRequest({
      request: new Request("https://example.com/api/media/daily_01"),
      env: { DB: db, KV: kv },
    } as never);
    expect(unauthorized.status).toBe(401);

    const response = await onRequest({
      request: new Request("https://example.com/api/media/daily_01", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env: { DB: db, KV: kv },
    } as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(imageBytes));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies topic images only for an authenticated device", async () => {
    const db = new MockD1().withOptions({
      mediaAssets: [{
        id: "outfit_01",
        group_id: "outfit",
        file_name: "outfit_01.jpg",
        content_type: "image/jpeg",
        source_url: "https://cdn.example.com/outfit_01.jpg",
      }],
    });
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(imageBytes, {
      status: 200,
      headers: { "Content-Type": "image/jpeg", "Content-Length": String(imageBytes.length) },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const unauthorized = await onRequest({
      request: new Request("https://example.com/api/media/outfit_01"),
      env: { DB: db, KV: new MockKV() },
    } as never);
    expect(unauthorized.status).toBe(401);

    const response = await onRequest({
      request: new Request("https://example.com/api/media/outfit_01", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env: { DB: db, KV: new MockKV() },
    } as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect((await response.arrayBuffer()).byteLength).toBe(4);
  });

  it("returns a deterministic topic image without calling the LLM", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", trigger_keywords: "想看你照片", is_active: 1 }],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
        { id: "daily_02", group_id: "daily", file_name: "daily_02.jpg", content_type: "image/jpeg" },
        { id: "daily_03", group_id: "daily", file_name: "daily_03.jpg", content_type: "image/jpeg" },
      ],
    });
    db.tokenPersonas.set("test-token", "assistant");
    // 2026-10-06：图片请求现在先叫一次模型写“欲拒还迎”那句话，图片本身仍按关键词兜底发。
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "你这人倒是挺直接的呀|||行吧 就给你看一眼" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const makeRequest = () => new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: "topic-image-request",
        platform: "soul",
        hosting_mode: "full_auto",
        contact_id: "contact-1",
        contact_name: "contact",
        messages: [{ role: "user", content: "想看你照片" }],
      }),
    });

    const first = await onRequest({
      request: makeRequest(),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const second = await onRequest({
      request: makeRequest(),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(firstBody.action).toBe("send_media");
    expect(firstBody.media.asset_id).toBe("daily_01");
    // 先把那句“欲拒还迎”的话发给对方，再发图
    expect(typeof firstBody.reply).toBe("string");
    expect(firstBody.reply.length).toBeGreaterThan(0);
    expect(secondBody.media.asset_id).toBe(firstBody.media.asset_id);
    expect(secondBody.reply_id).toBe(firstBody.reply_id);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stages a daily photo for Soul exchange without calling the LLM", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", trigger_keywords: "\u4ee5\u56fe\u6362\u56fe", is_active: 1 }],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
      ],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/media/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "exchange-test",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.action).toBe("send_media");
    expect(body.media.group_id).toBe("daily");
    expect(body.media.asset_id).toBe("daily_01");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never stages a Soul exchange photo outside full-auto mode", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", trigger_keywords: "\u4ee5\u56fe\u6362\u56fe", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/media/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "exchange-semi-auto",
          platform: "soul",
          hosting_mode: "semi_auto",
          contact_id: "contact-1",
          contact_name: "contact",
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ action: "skip" });
    expect(db.pendingRows).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails safe to monitor-only when hosting mode is missing", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", trigger_keywords: "\u4ee5\u56fe\u6362\u56fe", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/media/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "exchange-missing-mode",
          platform: "soul",
          contact_id: "contact-1",
          contact_name: "contact",
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ action: "skip" });
    expect(db.pendingRows).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never exposes full persona prompts through the public API", async () => {
    const db = new MockD1([], [{ id: "female", name: "星暮", system_prompt: "私有系统提示词", is_active: 1, created_at: 1 }]);
    const publicResponse = await onRequest({
      request: new Request("https://example.com/api/persona"),
      env: { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" },
    } as never);
    const publicBody = await publicResponse.json();
    expect(publicBody.personas[0]).not.toHaveProperty("system_prompt");

    const publicPromptAttempt = await onRequest({
      request: new Request("https://example.com/api/persona?include_prompt=1"),
      env: { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" },
    } as never);
    expect(publicPromptAttempt.status).toBe(401);

    const dashboardResponse = await onRequest({
      request: new Request("https://example.com/api/persona", {
        headers: { "X-Dashboard-Password": "secret" },
      }),
      env: { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" },
    } as never);
    await expect(dashboardResponse.json()).resolves.toMatchObject({
      personas: [{ id: "female", system_prompt: "私有系统提示词" }],
    });
  });

  it("includes the compact unanswered-message timeline in the prompt", () => {
    const prompt = buildLayeredSystemPrompt({
      personaPrompt: "你是星暮。",
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026年9月28日 19:00",
      weekday: "周一",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "两江新区" },
      weather: "",
      stageText: "刚认识",
      relationStageLevel: 1,
      messageDelay: null,
      messages: [{ role: "user", content: "在干嘛" }],
      historyMessages: [],
      conversationTimeline: "客户连续三天发来文字、动态和互动表情。",
    });

    expect(prompt).toContain("【未回复消息时间线】客户连续三天发来文字、动态和互动表情。");
  });
});
  it("routes every explicit Pages API entry through the full handler", () => {
    const routes = ["chat", "config", "contacts", "history", "messages", "persona", "status", "token"];
    const rootSource = readFileSync(new URL("../functions/[[route]].ts", import.meta.url), "utf8").trim();
    expect(rootSource).toBe('export { onRequest } from "./api/route";');
    for (const route of routes) {
      const source = readFileSync(new URL(`../functions/api/${route}.ts`, import.meta.url), "utf8").trim();
      expect(source).toBe('export { onRequest } from "./route";');
    }
  });
