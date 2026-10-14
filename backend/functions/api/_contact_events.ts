import { formatChinaMessageTime } from "./_time_runtime";

export interface ContactEvent {
  id?: number;
  event_type: string;
  content: string;
  happened_at: number;
}

interface DetectedEvent {
  event_type: string;
  content: string;
  happened_at: number;
}

const EVENT_PATTERNS: Array<{
  type: string;
  pattern: RegExp;
}> = [
  { type: "meeting", pattern: /(?:见面|见个面|出来见|约个时间|约一下|碰个头)/u },
  { type: "birthday", pattern: /(?:生日|过生|生辰)/u },
  { type: "health", pattern: /(?:生病|发烧|感冒|医院|看病|不舒服)/u },
  { type: "move", pattern: /(?:搬家|搬东西|新家|搬走)/u },
  { type: "work", pattern: /(?:上班|下班|加班|公司|出差|面试|工作)/u },
  { type: "travel", pattern: /(?:出发|到家|回家|在路上|去机场|去车站)/u },
  { type: "exam", pattern: /(?:考试|考证|答辩|开学)/u },
  { type: "photo", pattern: /(?:照片|自拍|发张图|拍个照)/u },
  { type: "voice", pattern: /(?:打电话|语音|电话)/u },
];

function normalizeEventText(value: unknown): string {
  return String(value || "")
    .replace(/[\s\u200b\u200c\u200d\uFEFF]+/gu, " ")
    .trim()
    .slice(0, 120);
}

export function detectImportantEvents(
  text: string,
  happenedAt: number,
): DetectedEvent[] {
  const content = normalizeEventText(text);
  if (!content) return [];
  return EVENT_PATTERNS
    .filter((entry) => entry.pattern.test(content))
    .slice(0, 3)
    .map((entry) => ({
      event_type: entry.type,
      content,
      happened_at: Math.max(0, Math.floor(happenedAt || 0)),
    }));
}

export async function recordContactEvents(
  db,
  token: string,
  platform: string,
  contactId: string,
  messages: Array<Record<string, any>>,
  nowSec: number,
): Promise<void> {
  const events: DetectedEvent[] = [];
  for (const message of messages || []) {
    if (String(message?.role || "") !== "user") continue;
    const createdAt = Number(message?.created_at || nowSec);
    events.push(...detectImportantEvents(String(message?.content || ""), createdAt));
    if (events.length >= 6) break;
  }
  for (const event of events.slice(0, 6)) {
    await db.prepare(
      "INSERT INTO contact_events (token, platform, contact_id, event_type, content, happened_at, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      token,
      platform,
      contactId,
      event.event_type,
      event.content,
      event.happened_at,
      nowSec,
    ).run();
  }
}

export async function loadRecentContactEvents(
  db,
  token: string,
  platform: string,
  contactId: string,
  limit = 6,
): Promise<ContactEvent[]> {
  const queryLimit = Math.max(1, Math.min(12, Number(limit || 6)));
  const { results } = await db.prepare(
    "SELECT id, event_type, content, happened_at FROM contact_events " +
    "WHERE token = ? AND platform = ? AND contact_id = ? " +
    "ORDER BY happened_at DESC, id DESC LIMIT ?"
  ).bind(token, platform, contactId, queryLimit).all();
  return (results || []).map((row) => ({
    id: Number(row.id || 0),
    event_type: String(row.event_type || ""),
    content: normalizeEventText(row.content),
    happened_at: Number(row.happened_at || 0),
  })).filter((event) => event.content);
}

export function buildContactEventsPrompt(
  events: ContactEvent[],
  options: { enabled?: boolean } = {},
): string {
  if (options.enabled === false || !events?.length) return "";
  const lines = events
    .filter((event) => event.content)
    .slice(0, 6)
    .map((event) => {
      const when = event.happened_at > 0
        ? formatChinaMessageTime(event.happened_at)
        : "";
      return `- ${when ? when + " " : ""}对方提到：${event.content}`;
    });
  if (!lines.length) return "";
  return [
    "最近确认过的重要事情（只作背景，不要生硬复述，也不要假装每件都刚发生）：",
    ...lines,
  ].join("\n");
}
