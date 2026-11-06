import {
  activeMemoryCards,
  createMemoryCard,
  formatMemoryCard,
  memoryCardKey,
  normalizeMemoryCards,
  type MemoryCard,
  type MemoryCardKind,
} from "./_memory_cards";

const QUESTION_MARKERS =
  /(?:\?|？|什么|怎么|为什么|哪|哪里|谁|吗|呢|多少|几|是不是|要不要|行不行|好不好)/u;
const PROMISE_MARKERS =
  /(?:我会|我回头|下次|到时候|等你|我给你|我发你|改天|晚点|记得)/u;
const FACT_MARKERS =
  /(?:我|本人)(?:是|做|住|在|已经|有|养|开|离|结|单身|未婚|岁|娃|孩子|老公|老婆)/u;
const PREFERENCE_MARKERS =
  /(?:我)?(?:喜欢|不喜欢|讨厌|习惯|爱|想要|不能吃|不吃|偏爱)/u;
const OPEN_THREAD_MARKERS =
  /(?:明天|后天|周末|下周|下次|改天|回头|晚点|到时候|等我|见面|一起|几点|在哪|有空|约好|喝咖啡|吃饭)/u;

export interface ConversationMemory {
  facts: string[];
  open_threads: string[];
  promises: string[];
  preferences: string[];
  cards: MemoryCard[];
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
    cards: [],
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
  const updatedAt = Math.max(0, Number(source.updated_at || 0));
  const facts = uniqueRecent(source.facts, 8);
  const openThreads = uniqueRecent(source.open_threads, 6);
  const promises = uniqueRecent(source.promises, 6);
  const preferences = uniqueRecent(source.preferences, 6);
  return {
    facts,
    open_threads: openThreads,
    promises,
    preferences,
    cards: normalizeMemoryCards(source, {
      facts,
      open_threads: openThreads,
      promises,
      preferences,
    }, updatedAt),
    last_user_question: cleanLine(source.last_user_question, 120),
    last_assistant_question: cleanLine(source.last_assistant_question, 120),
    last_topic: cleanLine(source.last_topic, 120),
    relationship_stage: cleanLine(source.relationship_stage, 30),
    updated_at: updatedAt,
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
  const currentMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && cleanLine(message.content, 160));
  const currentUserText = currentMessages
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
  const openThreads = uniqueRecent([
    ...memory.open_threads,
    ...userStatements(messages, OPEN_THREAD_MARKERS),
    assistantQuestion,
  ], 6);

  const cards = [...memory.cards];
  const cardKeys = new Set(cards.map(memoryCardKey));
  const addCard = (card: MemoryCard) => {
    const key = memoryCardKey(card);
    if (!card.text || cardKeys.has(key)) return;
    cardKeys.add(key);
    cards.push(card);
  };
  currentMessages.forEach((message, index) => {
    const role = String(message?.role || "user");
    const text = cleanLine(message?.content, 160);
    if (!text) return;
    if (role === "user" && FACT_MARKERS.test(text)) {
      addCard(createMemoryCard({ kind: "fact", text, message, index, nowSec }));
    }
    if (role === "user" && PREFERENCE_MARKERS.test(text)) {
      addCard(createMemoryCard({ kind: "preference", text, message, index, nowSec }));
    }
    if (role === "user" && OPEN_THREAD_MARKERS.test(text)) {
      addCard(createMemoryCard({ kind: "open_thread", text, message, index, nowSec }));
    }
  });
  if (reply && PROMISE_MARKERS.test(reply)) {
    addCard(createMemoryCard({
      kind: "promise",
      text: reply,
      message: { role: "assistant", content: reply, created_at: nowSec },
      index: currentMessages.length,
      nowSec,
    }));
  }
  if (assistantQuestion) {
    addCard(createMemoryCard({
      kind: "assistant_question",
      text: assistantQuestion,
      message: { role: "assistant", content: assistantQuestion, created_at: nowSec },
      index: currentMessages.length + 1,
      nowSec,
    }));
  }
  const activeCards = activeMemoryCards(cards, nowSec)
    .slice(-40);

  return {
    facts,
    open_threads: openThreads,
    promises,
    preferences,
    cards: activeCards,
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
 * 在调用模型前先把对方这轮明确说出的信息存下来。
 * 即使模型超时、空回复或被安全规则拦下，下一轮也不会忘掉。
 */
export async function captureUserMemoryBeforeReply({
  db,
  token,
  platform,
  contactId,
  previous,
  messages,
  relationshipStage,
  nowSec,
}) {
  const merged = mergeConversationMemory({
    previous,
    messages,
    assistantReply: "",
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
  nowSec = Math.floor(Date.now() / 1000),
} = {}) {
  const saved = normalizeConversationMemory(memory);
  const activeCards = activeMemoryCards(saved.cards, nowSec);
  const cardsOf = (kind: MemoryCardKind) =>
    activeCards.filter((card) => card.kind === kind).slice(-6);
  const older = (Array.isArray(olderMessages) ? olderMessages : [])
    .filter((message) => message && cleanLine(message.content));
  const fallbackQuestion = lastMatching(older, "user", QUESTION_MARKERS);
  const fallbackPromise = lastMatching(older, "assistant", PROMISE_MARKERS);

  const lines = [];
  const factCards = cardsOf("fact");
  const preferenceCards = cardsOf("preference");
  const openThreadCards = cardsOf("open_thread");
  const promiseCards = cardsOf("promise");
  const questionCards = cardsOf("assistant_question");
  if (factCards.length || saved.facts.length) {
    lines.push("- 已确认事实：" + (factCards.length
      ? factCards.map(formatMemoryCard).join(" / ")
      : saved.facts.join(" / ")));
  }
  if (preferenceCards.length || saved.preferences.length) {
    lines.push("- 对方偏好：" + (preferenceCards.length
      ? preferenceCards.map(formatMemoryCard).join(" / ")
      : saved.preferences.join(" / ")));
  }
  if (openThreadCards.length || saved.open_threads.length) {
    lines.push("- 没聊完：" + (openThreadCards.length
      ? openThreadCards.map(formatMemoryCard).join(" / ")
      : saved.open_threads.join(" / ")));
  }
  if (promiseCards.length || saved.promises.length) {
    lines.push("- 我上次答应过：" + (promiseCards.length
      ? promiseCards.map(formatMemoryCard).join(" / ")
      : saved.promises.join(" / ")));
  }
  if (questionCards.length) {
    lines.push("- 我上次问过：" + formatMemoryCard(questionCards.at(-1) as MemoryCard));
  }
  if (!questionCards.length && saved.last_assistant_question) {
    lines.push("- 我上次问过：" + saved.last_assistant_question);
  }
  if (saved.last_user_question) {
    lines.push("- 对方上一轮问过：" + saved.last_user_question + "（已经回答过就不要重复回答）");
  }
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
