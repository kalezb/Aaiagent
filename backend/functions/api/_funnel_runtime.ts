import {
  emptyFunnelState,
  normalizeFunnelState,
} from "./_funnel";
import { makeSingleGroupId } from "./_history_runtime";
import { XINGMU_PRODUCT_REPLY } from "./_reply_policy";

export async function loadActivityStats(db, token, aliases, nowSec) {
  const clauses = aliases.map(() => "(platform = ? AND contact_id = ?)");
  const flat = aliases.flatMap((alias) => [alias.platform, alias.contact_id]);
  const since = nowSec - 7 * 86400;
  const recent = await db.prepare(
    "SELECT COUNT(*) AS total, COUNT(DISTINCT DATE(created_at, 'unixepoch', 'localtime')) AS active_days FROM chat_history WHERE token = ? AND role = 'user' AND (" + clauses.join(" OR ") + ") AND created_at > ?"
  ).bind(token, ...flat, since).first();
  const total = await db.prepare(
    "SELECT COUNT(*) AS n FROM chat_history WHERE token = ? AND role = 'user' AND (" + clauses.join(" OR ") + ")"
  ).bind(token, ...flat).first();
  return {
    activeDays: Number(recent?.active_days || 0),
    userMsgs7d: Number(recent?.total || 0),
    totalExchanges: Number(total?.n || 0),
  };
}

export function parseFunnelStateRow(row) {
  if (!row) return emptyFunnelState();
  let evidence = {};
  try {
    evidence = row.evidence_json ? JSON.parse(String(row.evidence_json)) : {};
  } catch (_) {
    evidence = {};
  }
  return normalizeFunnelState({
    stage: row.stage,
    userTurnCount: row.user_turn_count,
    evidence,
    evaluationQuoteSent: Number(row.evaluation_quote_sent || 0) !== 0,
    completed: Number(row.completed || 0) !== 0,
    lastRequestId: row.last_request_id || "",
    stageEnteredAt: row.stage_entered_at,
    lastAdvancedAt: row.last_advanced_at,
    lastUserMessageAt: row.last_user_message_at,
    lastNegativeAt: row.last_negative_at,
    updatedAt: row.updated_at,
  });
}

export async function loadFunnelState(db, token, groupId, nowSec) {
  if (!groupId) return emptyFunnelState();
  const row = await db.prepare(
    "SELECT stage, user_turn_count, evidence_json, evaluation_quote_sent, completed, last_request_id, stage_entered_at, last_advanced_at, last_user_message_at, last_negative_at, updated_at FROM customer_funnel_states WHERE token = ? AND group_id = ? LIMIT 1"
  ).bind(token, groupId).first();
  if (row) return parseFunnelStateRow(row);
  const state = {
    ...emptyFunnelState(),
    stageEnteredAt: nowSec,
    updatedAt: nowSec,
  };
  await persistFunnelState(db, token, groupId, state);
  return state;
}

export async function persistFunnelState(db, token, groupId, state) {
  if (!groupId) return;
  const normalized = normalizeFunnelState(state);
  await db.prepare(
    "INSERT INTO customer_funnel_states (token, group_id, stage, user_turn_count, evidence_json, evaluation_quote_sent, completed, last_request_id, stage_entered_at, last_advanced_at, last_user_message_at, last_negative_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
    + "ON CONFLICT(token, group_id) DO UPDATE SET stage = excluded.stage, user_turn_count = excluded.user_turn_count, evidence_json = excluded.evidence_json, evaluation_quote_sent = excluded.evaluation_quote_sent, completed = excluded.completed, last_request_id = excluded.last_request_id, stage_entered_at = excluded.stage_entered_at, last_advanced_at = excluded.last_advanced_at, last_user_message_at = excluded.last_user_message_at, last_negative_at = excluded.last_negative_at, updated_at = excluded.updated_at"
  ).bind(
    token,
    groupId,
    normalized.stage,
    normalized.userTurnCount,
    JSON.stringify(normalized.evidence),
    normalized.evaluationQuoteSent ? 1 : 0,
    normalized.completed ? 1 : 0,
    normalized.lastRequestId,
    normalized.stageEnteredAt,
    normalized.lastAdvancedAt,
    normalized.lastUserMessageAt,
    normalized.lastNegativeAt,
    normalized.updatedAt,
  ).run();
}

export async function markFunnelQuoteSent(db, token, platform, contactId, content, nowSec) {
  if (!/(?:评估报价|shanhs668)/iu.test(String(content || ""))) return;
  const link = await db.prepare(
    "SELECT group_id FROM contact_links WHERE token = ? AND platform = ? AND contact_id = ? LIMIT 1"
  ).bind(token, platform, contactId).first();
  const groupId = link?.group_id || makeSingleGroupId(token, platform, contactId);
  await db.prepare(
    "UPDATE customer_funnel_states SET evaluation_quote_sent = 1, completed = 1, updated_at = ? WHERE token = ? AND group_id = ?"
  ).bind(nowSec, token, groupId).run();
}

export async function loadPendingEvaluationQuote(
  db,
  token,
  platform,
  contactId,
  nowSec,
  personaId = "",
  personaVersion = 0,
) {
  const row = await db.prepare(
    "SELECT id, content, status, created_at FROM pending_replies WHERE token = ? AND platform = ? AND contact_id = ? AND status = 'pending' AND content = ? AND (persona_id = '' OR persona_id = ?) AND (persona_version = 0 OR persona_version = ?) ORDER BY created_at DESC LIMIT 1"
  ).bind(
    token,
    platform,
    contactId,
    XINGMU_PRODUCT_REPLY,
    String(personaId || ""),
    Number(personaVersion || 0),
  ).first();
  if (!row) return null;
  const createdAt = Number(row.created_at || 0);
  if (!createdAt || nowSec - createdAt > 15 * 60) return null;
  return row;
}
