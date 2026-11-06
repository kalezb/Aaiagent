export type MemoryCardKind =
  | "fact"
  | "preference"
  | "open_thread"
  | "promise"
  | "assistant_question";

export interface MemoryCard {
  id: string;
  kind: MemoryCardKind;
  text: string;
  source_role: "user" | "assistant" | "legacy";
  source_message_id: string;
  learned_at: number;
  expires_at: number;
  status: "active" | "resolved" | "expired";
}

interface LegacyMemoryLists {
  facts: string[];
  preferences: string[];
  open_threads: string[];
  promises: string[];
}

function compact(value: unknown, limit = 160) {
  return String(value ?? "")
    .replace(/[\r\n]+/gu, " ")
    .trim()
    .slice(0, limit);
}

function hashText(value: unknown) {
  const text = String(value || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function sourceId(message, kind, index) {
  const stable = compact(
    message?.client_message_id ||
    message?.message_key ||
    message?.id ||
    "",
    160,
  );
  return stable || `${kind}:${index}:${hashText(message?.content)}`;
}

export function createMemoryCard({
  kind,
  text,
  message,
  index = 0,
  nowSec,
  sourceRole,
}: {
  kind: MemoryCardKind;
  text: string;
  message?: any;
  index?: number;
  nowSec: number;
  sourceRole?: MemoryCard["source_role"];
}): MemoryCard {
  const content = compact(text);
  const source = sourceRole || (message?.role === "assistant" ? "assistant" : "user");
  const ttl = kind === "open_thread"
    ? 30 * 86400
    : kind === "promise" || kind === "assistant_question"
      ? 14 * 86400
      : 0;
  return {
    id: `${kind}:${sourceId(message, kind, index)}:${hashText(content)}`,
    kind,
    text: content,
    source_role: source,
    source_message_id: sourceId(message, kind, index),
    learned_at: Math.max(0, Number(message?.created_at || nowSec || 0)),
    expires_at: ttl > 0 ? Math.max(0, Number(nowSec || 0)) + ttl : 0,
    status: "active",
  };
}

export function normalizeMemoryCards(
  source,
  legacy: LegacyMemoryLists,
  updatedAt: number,
): MemoryCard[] {
  const rawCards = Array.isArray(source?.cards) ? source.cards : [];
  const cards = rawCards
    .filter((card) => card && typeof card === "object")
    .map((card, index): MemoryCard => {
      const kind = ["fact", "preference", "open_thread", "promise", "assistant_question"]
        .includes(String(card.kind))
        ? card.kind as MemoryCardKind
        : "fact";
      const text = compact(card.text);
      return {
        id: compact(card.id, 220) || `card:${index}:${hashText(text)}`,
        kind,
        text,
        source_role: ["user", "assistant", "legacy"].includes(String(card.source_role))
          ? card.source_role
          : "legacy",
        source_message_id: compact(card.source_message_id),
        learned_at: Math.max(0, Number(card.learned_at || updatedAt || 0)),
        expires_at: Math.max(0, Number(card.expires_at || 0)),
        status: ["active", "resolved", "expired"].includes(String(card.status))
          ? card.status
          : "active",
      };
    })
    .filter((card) => card.text);
  if (cards.length) return cards;

  return [
    ...legacy.facts.map((text, index) => createMemoryCard({
      kind: "fact",
      text,
      index,
      nowSec: updatedAt,
      sourceRole: "legacy",
    })),
    ...legacy.preferences.map((text, index) => createMemoryCard({
      kind: "preference",
      text,
      index,
      nowSec: updatedAt,
      sourceRole: "legacy",
    })),
    ...legacy.open_threads.map((text, index) => createMemoryCard({
      kind: "open_thread",
      text,
      index,
      nowSec: updatedAt,
      sourceRole: "legacy",
    })),
    ...legacy.promises.map((text, index) => createMemoryCard({
      kind: "promise",
      text,
      index,
      nowSec: updatedAt,
      sourceRole: "legacy",
    })),
  ];
}

export function activeMemoryCards(cards: MemoryCard[], nowSec: number) {
  return (Array.isArray(cards) ? cards : [])
    .filter((card) => card.status === "active")
    .filter((card) => !card.expires_at || card.expires_at > nowSec);
}

export function memoryCardKey(card: MemoryCard) {
  return `${card.kind}\u0000${card.text.replace(/\s+/gu, "")}`;
}

export function formatMemoryCard(card: MemoryCard) {
  if (!card.learned_at) return card.text;
  const date = new Date((card.learned_at + 8 * 3600) * 1000);
  const dateLabel = `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
  return `${card.text}（${dateLabel}${card.source_role === "assistant" ? "我说" : "对方说"}）`;
}
