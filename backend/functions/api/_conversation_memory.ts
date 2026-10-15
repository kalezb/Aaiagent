const QUESTION_MARKERS =
  /(?:\?|？|什么|怎么|为什么|哪|哪里|谁|吗|呢|多少|几|是不是|要不要|行不行|好不好)/u;
const PROMISE_MARKERS =
  /(?:我会|我回头|下次|到时候|等你|我给你|我发你|改天|晚点|记得)/u;
const FACT_MARKERS =
  /(?:我|本人)(?:是|做|住|在|已经|有|养|开|离|结|单身|未婚|岁|娃|孩子|老公|老婆)/u;
const PREFERENCE_MARKERS =
  /(?:我)?(?:喜欢|不喜欢|讨厌|习惯|爱|想要|不能吃|不吃|偏爱)/u;

export interface ConversationMemory {
  facts: string[];
  open_threads: string[];
  promises: string[];
  preferences: string[];
  last_user_question: string;
  last_assistant_question: string;
  last_topic: string;
  relationship_stage: string;
  updated_at: number;
}

function cleanLine(value, limit = 80) {
  return String(value || "")
    .replace(/[\r\n]+/gu, " ")
    .trim()
    .slice(0, limit);
}

function uniqueRecent(values, limit) {
  const seen = new Set();
  const output = [];
  for (const value of [...(Array.isArray(values) ? values : [])].reverse()) {
    const line = cleanLine(value, 120);
    const key = line.replace(/\s+/gu, "");
    if (!line || seen.has(key)) continue;
    seen.add(key);
    output.push(line);
    if (output.length >= limit) break;
  }
  return output.reverse();
}

export function emptyConversationMemory(): ConversationMemory {
  return {
    facts: [],
    open_threads: [],
    promises: [],
    preferences: [],
    last_user_question: "",
    last_assistant_question: "",
    last_topic: "",
    relationship_stage: "",
    updated_at: 0,
  };
}

export function normalizeConversationMemory(value): ConversationMemory {
  const source = value && typeof value === "object" ? value : {};
  const empty = emptyConversationMemory();
  return {
    facts: uniqueRecent(source.facts, 8),
    open_threads: uniqueRecent(source.open_threads, 3),
    promises: uniqueRecent(source.promises, 4),
    preferences: uniqueRecent(source.preferences, 6),
    last_user_question: cleanLine(source.last_user_question, 120),
    last_assistant_question: cleanLine(source.last_assistant_question, 120),
    last_topic: cleanLine(source.last_topic, 120),
    relationship_stage: cleanLine(source.relationship_stage, 30),
    updated_at: Math.max(0, Number(source.updated_at || 0)),
  };
}

function lastMatching(messages, role, pattern) {
  return [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) =>
      String(message?.role || "") === role &&
      pattern.test(cleanLine(message?.content, 160))
    ) || null;
}

function userStatements(messages, pattern) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => String(message?.role || "") === "user")
    .map((message) => cleanLine(message?.content, 120))
    .filter((text) => text && pattern.test(text));
}

export function mergeConversationMemory({
  previous = emptyConversationMemory(),
  messages = [],
  assistantReply = "",
  relationshipStage = "",
  nowSec = Math.floor(Date.now() / 1000),
} = {}): ConversationMemory {
  const memory = normalizeConversationMemory(previous);
  const currentUserText = (Array.isArray(messages) ? messages : [])
    .filter((message) => String(message?.role || "") === "user")
    .map((message) => cleanLine(message?.content, 120))
    .filter(Boolean);
  const lastUser = currentUserText.at(-1) || "";
  const reply = cleanLine(assistantReply, 160);

  const facts = uniqueRecent([
    ...memory.facts,
    ...userStatements(messages, FACT_MARKERS),
  ], 8);
  const preferences = uniqueRecent([
    ...memory.preferences,
    ...userStatements(messages, PREFERENCE_MARKERS),
  ], 6);
  const promises = uniqueRecent([
    ...memory.promises,
    ...(reply && PROMISE_MARKERS.test(reply) ? [reply] : []),
  ], 4);
  const userQuestion = lastUser && QUESTION_MARKERS.test(lastUser) ? lastUser : "";
  const assistantQuestion = reply && QUESTION_MARKERS.test(reply) ? reply : "";
  const openThreads = memory.open_threads.slice(0, Math.max(0, memory.open_threads.length - (currentUserText.length ? 1 : 0)));
  if (assistantQuestion) openThreads.push(assistantQuestion);

  return {
    facts,
    open_threads: uniqueRecent(openThreads, 3),
    promises,
    preferences,
    last_user_question: userQuestion || memory.last_user_question,
    last_assistant_question: assistantQuestion || memory.last_assistant_question,
    last_topic: lastUser || memory.last_topic,
    relationship_stage: cleanLine(relationshipStage, 30) || memory.relationship_stage,
    updated_at: Math.max(memory.updated_at, Number(nowSec || 0)),
  };
}

export async function loadConversationMemory(
  db,
  token,
  platform,
  contactId,
): Promise<ConversationMemory> {
  const row = await db.prepare(
    "SELECT memory_json, updated_at FROM conversation_memory WHERE token = ? AND platform = ? AND contact_id = ? LIMIT 1"
  ).bind(token, platform, contactId).first();
  if (!row) return emptyConversationMemory();
  try {
    return normalizeConversationMemory({
      ...JSON.parse(String(row.memory_json || "{}")),
      updated_at: Number(row.updated_at || 0),
    });
  } catch (_) {
    return emptyConversationMemory();
  }
}

export async function persistConversationMemory(
  db,
  token,
  platform,
  contactId,
  memory,
): Promise<ConversationMemory> {
  const normalized = normalizeConversationMemory(memory);
  const updatedAt = normalized.updated_at || Math.floor(Date.now() / 1000);
  normalized.updated_at = updatedAt;
  await db.prepare(
    "INSERT INTO conversation_memory (token, platform, contact_id, memory_json, updated_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(token, platform, contact_id) DO UPDATE SET memory_json = excluded.memory_json, updated_at = excluded.updated_at"
  ).bind(
    token,
    platform,
    contactId,
    JSON.stringify(normalized),
    updatedAt,
  ).run();
  return normalized;
}

export async function updateConversationMemory({
  db,
  token,
  platform,
  contactId,
  messages,
  assistantReply,
  relationshipStage,
  nowSec,
}) {
  const previous = await loadConversationMemory(db, token, platform, contactId);
  const merged = mergeConversationMemory({
    previous,
    messages,
    assistantReply,
    relationshipStage,
    nowSec,
  });
  return persistConversationMemory(db, token, platform, contactId, merged);
}

/**
 * 长期记忆只放对下一轮有用的东西，不把旧聊天原样塞回去。
 */
export function buildConversationMemoryPrompt({
  summary = "",
  olderMessages = [],
  memory = emptyConversationMemory(),
} = {}) {
  const saved = normalizeConversationMemory(memory);
  const older = (Array.isArray(olderMessages) ? olderMessages : [])
    .filter((message) => message && cleanLine(message.content));
  const fallbackQuestion = lastMatching(older, "user", QUESTION_MARKERS);
  const fallbackPromise = lastMatching(older, "assistant", PROMISE_MARKERS);

  const lines = [];
  if (saved.facts.length) lines.push("- 已确认事实：" + saved.facts.join(" / "));
  if (saved.preferences.length) lines.push("- 对方偏好：" + saved.preferences.join(" / "));
  if (saved.open_threads.length) lines.push("- 没聊完：" + saved.open_threads.join(" / "));
  if (saved.promises.length) lines.push("- 我上次答应过：" + saved.promises.join(" / "));
  if (saved.last_assistant_question) lines.push("- 我上次问过：" + saved.last_assistant_question);
  if (saved.last_topic) lines.push("- 最近话题：" + saved.last_topic);
  if (fallbackQuestion && !saved.last_user_question) {
    lines.push("- 没聊完的：" + cleanLine(fallbackQuestion.content));
  }
  if (fallbackPromise && !saved.promises.length) {
    lines.push("- 我上次答应过：" + cleanLine(fallbackPromise.content));
  }
  const compactSummary = cleanLine(summary, 300);
  if (compactSummary) lines.push("- 更早的摘要：" + compactSummary);
  if (!lines.length) return "";
  return "【长期记忆｜只作背景，不要硬复述】\n" + lines.join("\n");
}
