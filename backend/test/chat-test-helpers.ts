import { afterEach, vi } from "vitest";

export class MockD1 {
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

export class MockKV {
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

export function mockChatSequence(contents: string[]) {
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

export function visionRequest(imageBase64 = "ZmFrZS1pbWFnZQ==") {
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
