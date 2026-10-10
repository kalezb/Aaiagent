import { formatChinaMessageTime } from "./_time_runtime";

const VALID_MESSAGE_SOURCES = new Set(["ai", "human_phone", "dashboard", "sync"]);

export function normalizeMessageSource(value) {
  return VALID_MESSAGE_SOURCES.has(value) ? value : "sync";
}

export function makeContactKey(token, platform, contactId) {
  return `${token}\u0000${platform}\u0000${contactId}`;
}

export function makeSingleGroupId(token, platform, contactId) {
  return `single:${encodeURIComponent(token)}:${encodeURIComponent(platform)}:${encodeURIComponent(contactId)}`;
}

export function parseSingleGroupId(groupId) {
  if (!String(groupId || "").startsWith("single:")) return null;
  const parts = String(groupId).slice(7).split(":");
  if (parts.length !== 3) return null;
  try {
    return {
      token: decodeURIComponent(parts[0]),
      platform: decodeURIComponent(parts[1]),
      contactId: decodeURIComponent(parts[2]),
    };
  } catch (_) {
    return null;
  }
}

export function hashMessagePart(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function makeSyncedMessageKey(token, platform, contactId, message) {
  const clientKey = String(message.message_key || message.messageId || "").trim();
  if (clientKey) return clientKey.slice(0, 220);
  const role = message.role === "assistant" ? "assistant" : "user";
  const createdAt = Number(message.created_at || 0);
  const fingerprint = [role, String(message.content || ""), createdAt].join("\u001f");
  return ["auto", platform, contactId, hashMessagePart(fingerprint)].join(":").slice(0, 220);
}

export function normalizeTranscriptFingerprint(value) {
  return String(value || "")
    .replace(/[\s\u200b]+/gu, "")
    .replace(/[。．.!！?？,，、;；:：]+$/u, "")
    .trim();
}

export async function loadRecentAiReplyFingerprints(db, token, platform, contactId, nowSec) {
  const { results } = await db.prepare(
    "SELECT content FROM pending_replies WHERE token = ? AND platform = ? AND contact_id = ? " +
    "AND status = 'confirmed' AND confirmed_at >= ? ORDER BY confirmed_at DESC LIMIT 40"
  ).bind(token, platform, contactId, nowSec - 6 * 3600).all();
  const fingerprints = new Set();
  for (const row of results || []) {
    for (const part of String(row?.content || "").split("|||")) {
      const key = normalizeTranscriptFingerprint(part);
      if (key) fingerprints.add(key);
    }
  }
  return fingerprints;
}

export async function loadRecentAssistantReplies(
  db,
  token,
  platform,
  contactId,
  personaId = "",
  limit = 6,
) {
  const queryLimit = Math.max(1, Math.min(20, Number(limit || 6)));
  const { results } = await db.prepare(
    "SELECT role, content, created_at, platform, contact_id, source, persona_id FROM chat_history " +
    "WHERE token = ? AND platform = ? AND contact_id = ? AND role = 'assistant' " +
    "AND (source = 'human_phone' OR persona_id = ?) " +
    "ORDER BY created_at DESC LIMIT ?"
  ).bind(token, platform, contactId, String(personaId || ""), queryLimit).all();
  return (results || []).filter((row) =>
    row?.role === "assistant" &&
    row?.platform === platform &&
    row?.contact_id === contactId
  ).slice(0, limit);
}

export function countInsertedRows(results) {
  return (results || []).reduce((total, result) => {
    const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
    return total + (Number.isFinite(changes) ? changes : 0);
  }, 0);
}

export async function updateConversationStats(
  db,
  token,
  platform,
  contactId,
  contactName,
  insertedCount,
  latestMessage,
  nowSec,
) {
  if (!insertedCount || !latestMessage) return;
  const role = latestMessage.role === "assistant" ? "assistant" : "user";
  const source = normalizeMessageSource(latestMessage.source);
  const content = String(latestMessage.content || "").slice(0, 4000);
  const createdAt = Number(latestMessage.created_at || nowSec);
  let latestMessageId = Number(latestMessage.id || 0);
  if (!latestMessageId && latestMessage.message_key) {
    const inserted = await db.prepare(
      "SELECT id FROM chat_history WHERE token = ? AND message_key = ? LIMIT 1"
    ).bind(token, latestMessage.message_key).first();
    latestMessageId = Number(inserted?.id || 0);
  }
  await db.prepare(
    "INSERT INTO conversation_stats (token, platform, contact_id, contact_name, message_count, latest_message_id, latest_role, latest_content, latest_source, latest_at, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(token, platform, contact_id) DO UPDATE SET " +
    "message_count = conversation_stats.message_count + excluded.message_count, " +
    "contact_name = excluded.contact_name, " +
    "latest_message_id = CASE WHEN excluded.latest_at >= conversation_stats.latest_at THEN excluded.latest_message_id ELSE conversation_stats.latest_message_id END, " +
    "latest_role = CASE WHEN excluded.latest_at >= conversation_stats.latest_at THEN excluded.latest_role ELSE conversation_stats.latest_role END, " +
    "latest_content = CASE WHEN excluded.latest_at >= conversation_stats.latest_at THEN excluded.latest_content ELSE conversation_stats.latest_content END, " +
    "latest_source = CASE WHEN excluded.latest_at >= conversation_stats.latest_at THEN excluded.latest_source ELSE conversation_stats.latest_source END, " +
    "latest_at = MAX(conversation_stats.latest_at, excluded.latest_at), " +
    "updated_at = excluded.updated_at"
  ).bind(
    token,
    platform,
    contactId,
    String(contactName || contactId),
    insertedCount,
    latestMessageId,
    role,
    content,
    source,
    createdAt,
    nowSec,
  ).run();
}

export async function loadGroupIdentity(db, groupId, token) {
  const single = parseSingleGroupId(groupId);
  if (single) {
    if (token && token !== single.token) return null;
    const contact = await db.prepare(
      "SELECT contact_name, is_whitelisted, marital_status, voice_warn_at, his_photo_at, her_photo_at FROM contacts WHERE token = ? AND platform = ? AND contact_id = ?"
    ).bind(single.token, single.platform, single.contactId).first();
    return {
      id: groupId,
      token: single.token,
      display_name: contact?.contact_name || single.contactId,
      notes: "",
      priority_reply: 0,
      aliases: [{
        platform: single.platform,
        contact_id: single.contactId,
        contact_name: contact?.contact_name || single.contactId,
        is_whitelisted: contact?.is_whitelisted ?? 1,
        marital_status: contact?.marital_status || "",
        his_photo_at: Number(contact?.his_photo_at || 0),
        her_photo_at: Number(contact?.her_photo_at || 0),
        voice_warn_at: Number(contact?.voice_warn_at || 0),
      }],
    };
  }

  const group = await db.prepare(
    "SELECT id, token, display_name, notes, priority_reply FROM customer_groups WHERE id = ?"
  ).bind(groupId).first();
  if (!group || (token && group.token !== token)) return null;
  const { results } = await db.prepare(
    "SELECT l.platform, l.contact_id, l.contact_name, c.is_whitelisted, c.marital_status, c.voice_warn_at, c.his_photo_at, c.her_photo_at FROM contact_links l LEFT JOIN contacts c ON c.token = l.token AND c.platform = l.platform AND c.contact_id = l.contact_id WHERE l.token = ? AND l.group_id = ? ORDER BY l.created_at"
  ).bind(group.token, groupId).all();
  return { ...group, aliases: results || [] };
}

export async function listCustomerGroups(db, token, platformFilter, searchQuery) {
  const contactQuery = token
    ? "SELECT token, platform, contact_id, contact_name, is_whitelisted, notes, created_at FROM contacts WHERE token = ? ORDER BY created_at DESC"
    : "SELECT token, platform, contact_id, contact_name, is_whitelisted, notes, created_at FROM contacts ORDER BY created_at DESC";
  const contactStmt = db.prepare(contactQuery);
  const contacts = (await (token ? contactStmt.bind(token) : contactStmt).all()).results || [];

  const groupQuery = token
    ? "SELECT id, token, display_name, notes, priority_reply, created_at FROM customer_groups WHERE token = ?"
    : "SELECT id, token, display_name, notes, priority_reply, created_at FROM customer_groups";
  const groupStmt = db.prepare(groupQuery);
  const groups = (await (token ? groupStmt.bind(token) : groupStmt).all()).results || [];

  const linkQuery = token
    ? "SELECT group_id, token, platform, contact_id, contact_name FROM contact_links WHERE token = ?"
    : "SELECT group_id, token, platform, contact_id, contact_name FROM contact_links";
  const linkStmt = db.prepare(linkQuery);
  const links = (await (token ? linkStmt.bind(token) : linkStmt).all()).results || [];

  const historyQuery = token
    ? "SELECT token, platform, contact_id, contact_name, latest_role AS role, latest_content AS content, latest_at AS created_at, message_count FROM conversation_stats WHERE token = ?"
    : "SELECT token, platform, contact_id, contact_name, latest_role AS role, latest_content AS content, latest_at AS created_at, message_count FROM conversation_stats";
  const historyStmt = db.prepare(historyQuery);
  const histories = (await (token ? historyStmt.bind(token) : historyStmt).all()).results || [];
  const contentMatchQuery = token
    ? "SELECT DISTINCT token, platform, contact_id FROM chat_history WHERE token = ? AND lower(content) LIKE ? LIMIT 500"
    : "SELECT DISTINCT token, platform, contact_id FROM chat_history WHERE lower(content) LIKE ? LIMIT 500";
  const normalizedSearch = String(searchQuery || "").trim().toLowerCase();
  let contentHitKeys = new Set();
  if (normalizedSearch) {
    const contentMatchStmt = db.prepare(contentMatchQuery);
    const contentNeedle = "%" + normalizedSearch + "%";
    const contentMatches = (await (
      token
        ? contentMatchStmt.bind(token, contentNeedle)
        : contentMatchStmt.bind(contentNeedle)
    ).all()).results || [];
    contentHitKeys = new Set(contentMatches.map((row) =>
      makeContactKey(row.token, row.platform, row.contact_id)
    ));
  }

  const groupRecords = new Map();
  const groupMeta = new Map(groups.map((group) => [group.id, group]));
  const linkMap = new Map(links.map((link) => [
    makeContactKey(link.token, link.platform, link.contact_id),
    link,
  ]));
  const aliasToGroup = new Map();

  function ensureGroup(record) {
    let group = groupRecords.get(record.id);
    if (!group) {
      group = {
        id: record.id,
        token: record.token,
        display_name: record.display_name || record.contact_name || "未命名客户",
        notes: record.notes || "",
        priority_reply: Boolean(record.priority_reply),
        aliases: [],
        platforms: [],
        message_count: 0,
        last_message: null,
        last_at: 0,
      };
      groupRecords.set(record.id, group);
    }
    return group;
  }

  function addAlias(tokenValue, platform, contactId, contactName) {
    const key = makeContactKey(tokenValue, platform, contactId);
    const link = linkMap.get(key);
    const groupId = link?.group_id || makeSingleGroupId(tokenValue, platform, contactId);
    const meta = groupMeta.get(groupId);
    const group = ensureGroup({
      id: groupId,
      token: tokenValue,
      display_name: meta?.display_name || contactName || link?.contact_name,
      notes: meta?.notes,
      priority_reply: meta?.priority_reply,
    });
    if (!group.aliases.some((alias) => alias.platform === platform && alias.contact_id === contactId)) {
      group.aliases.push({ platform, contact_id: contactId, contact_name: contactName || contactId });
    }
    if (!group.platforms.includes(platform)) group.platforms.push(platform);
    aliasToGroup.set(key, groupId);
  }

  for (const contact of contacts) {
    if (platformFilter && contact.platform !== platformFilter) continue;
    addAlias(contact.token, contact.platform, contact.contact_id, contact.contact_name);
  }
  for (const link of links) {
    if (platformFilter && link.platform !== platformFilter) continue;
    addAlias(link.token, link.platform, link.contact_id, link.contact_name);
  }

  for (const message of histories) {
    if (platformFilter && message.platform !== platformFilter) continue;
    const key = makeContactKey(message.token, message.platform, message.contact_id);
    if (!aliasToGroup.has(key)) {
      addAlias(message.token, message.platform, message.contact_id, message.contact_name);
    }
    const group = groupRecords.get(aliasToGroup.get(key));
    if (!group) continue;
    group.message_count += Number(message.message_count || 0);
    group.last_at = Number(message.created_at || 0);
    group.last_message = {
      role: message.role,
      content: message.content,
      platform: message.platform,
      contact_name: message.contact_name,
      created_at: message.created_at,
    };
  }

  const query = String(searchQuery || "").trim().toLowerCase();
  const rows = [...groupRecords.values()].filter((group) => {
    if (!query) return true;
    const aliasHit = group.aliases.some((alias) =>
      String(alias.contact_name || "").toLowerCase().includes(query)
    );
    const contentHit = Array.from(contentHitKeys).some((key) => {
      const [messageToken, messagePlatform, contactId] = key.split("\u0000");
      return aliasToGroup.get(makeContactKey(messageToken, messagePlatform, contactId)) === group.id;
    });
    return String(group.display_name || "").toLowerCase().includes(query) || aliasHit || contentHit;
  });
  rows.sort((a, b) => (b.last_at || 0) - (a.last_at || 0));
  return rows;
}

export async function loadCustomerMessages(db, identity, limit = 300, sinceId = 0) {
  if (!identity || !identity.aliases.length) return { messages: [], latest_id: 0 };
  const clauses = identity.aliases.map(() => "(platform = ? AND contact_id = ?)");
  const params = [identity.token, ...identity.aliases.flatMap((alias) => [alias.platform, alias.contact_id])];
  const safeLimit = Math.min(Math.max(Number(limit) || 300, 1), 300);
  let query;
  if (sinceId > 0) {
    query = "SELECT id, platform, contact_id, contact_name, role, content, source, message_key, created_at, time_kind, transcript, voice_seconds FROM chat_history WHERE token = ? AND (" + clauses.join(" OR ") + ") AND id > ? ORDER BY id ASC LIMIT ?";
    params.push(sinceId, safeLimit);
  } else {
    query = "SELECT id, platform, contact_id, contact_name, role, content, source, message_key, created_at, time_kind, transcript, voice_seconds FROM (SELECT id, platform, contact_id, contact_name, role, content, source, message_key, created_at, time_kind, transcript, voice_seconds FROM chat_history WHERE token = ? AND (" + clauses.join(" OR ") + ") ORDER BY id DESC LIMIT ?) ORDER BY id ASC";
    params.push(safeLimit);
  }
  const { results } = await db.prepare(query).bind(...params).all();
  const messages = results || [];
  return {
    messages,
    latest_id: messages.reduce((max, message) => Math.max(max, Number(message.id || 0)), 0),
  };
}

export function formatMemoryLines(messages, maxChars = 800) {
  const lines = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const speaker = message.role === "user" ? "对方" : "你";
    const line = `[${message.platform || "未知"} ${formatChinaMessageTime(message.created_at)}] ${speaker}：${String(message.content || "").slice(0, 160)}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.reverse().join("\n");
}

export function mergeMemorySummary(existingSummary, messages, maxChars = 800) {
  const addition = formatMemoryLines(messages);
  const merged = [String(existingSummary || "").trim(), addition].filter(Boolean).join("\n");
  return merged.length <= maxChars ? merged : merged.slice(merged.length - maxChars);
}

export function dedupeNearbyHistory(messages) {
  const result = [];
  for (const message of messages || []) {
    const previous = result[result.length - 1];
    const sameSpeaker = previous &&
      String(previous.role || "user") === String(message.role || "user") &&
      String(previous.platform || "") === String(message.platform || "") &&
      String(previous.contact_id || "") === String(message.contact_id || "");
    const sameContent = previous &&
      String(previous.content || "").trim() === String(message.content || "").trim();
    const nearby = previous &&
      Math.abs(Number(previous.created_at || 0) - Number(message.created_at || 0)) <= 10;
    if (sameSpeaker && sameContent && nearby) continue;
    result.push(message);
  }
  return result;
}

export function dedupeHistoryAgainstCurrent(historyMessages, currentMessages) {
  historyMessages = dedupeNearbyHistory(historyMessages);
  const remaining = new Map();
  for (const message of currentMessages || []) {
    const key = String(message.role || "user") + "\u0000" + String(message.content || "").trim();
    remaining.set(key, (remaining.get(key) || 0) + 1);
  }
  const result = [];
  for (let index = historyMessages.length - 1; index >= 0; index--) {
    const message = historyMessages[index];
    const key = String(message.role || "user") + "\u0000" + String(message.content || "").trim();
    const count = remaining.get(key) || 0;
    if (count > 0) {
      remaining.set(key, count - 1);
      continue;
    }
    result.push(message);
  }
  return result.reverse();
}

export async function loadMemorySummary(db, token, groupId, aliases) {
  if (groupId) {
    const shared = await db.prepare(
      "SELECT summary, summarized_up_to_id FROM customer_summaries WHERE token = ? AND group_id = ?"
    ).bind(token, groupId).first();
    if (shared) {
      return {
        summary: shared.summary || "",
        summarizedUpToId: Number(shared.summarized_up_to_id || 0),
        shared: true,
      };
    }
  }
  if (!aliases.length) return { summary: "", summarizedUpToId: 0, shared: false };
  const clauses = aliases.map(() => "(platform = ? AND contact_id = ?)");
  const { results } = await db.prepare(
    "SELECT summary, summarized_up_to_id FROM session_summary WHERE token = ? AND (" + clauses.join(" OR ") + ")"
  ).bind(token, ...aliases.flatMap((alias) => [alias.platform, alias.contact_id])).all();
  const rows = results || [];
  return {
    summary: rows.map((row) => row.summary).filter(Boolean).join("\n"),
    summarizedUpToId: Math.max(0, ...rows.map((row) => Number(row.summarized_up_to_id || 0))),
    shared: false,
  };
}

export async function persistMemorySummary(db, token, groupId, aliases, summary, summarizedUpToId) {
  const now = Math.floor(Date.now() / 1000);
  if (groupId) {
    await db.prepare(
      "INSERT INTO customer_summaries (token, group_id, summary, summarized_up_to_id, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(token, group_id) DO UPDATE SET summary = excluded.summary, summarized_up_to_id = excluded.summarized_up_to_id, updated_at = excluded.updated_at"
    ).bind(token, groupId, summary, summarizedUpToId, now).run();
    return;
  }
  for (const alias of aliases) {
    await db.prepare(
      "INSERT INTO session_summary (token, platform, contact_id, summary, summarized_up_to_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(token, platform, contact_id) DO UPDATE SET summary = excluded.summary, summarized_up_to_id = excluded.summarized_up_to_id"
    ).bind(token, alias.platform, alias.contact_id, summary, summarizedUpToId).run();
  }
}
