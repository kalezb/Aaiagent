const CHINA_OFFSET_SECONDS = 8 * 60 * 60;
const SESSION_GAP_SECONDS = 4 * 60 * 60;

function epochOf(value: unknown) {
  const raw = Number(value || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 10_000_000_000 ? Math.floor(raw / 1000) : Math.floor(raw);
}

function messageEpoch(message: any) {
  return epochOf(message?.created_at || message?.createdAt || message?.timestamp);
}

function datetimeEpoch(value: string) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/u.test(text)
    ? text
    : text.replace(" ", "T") + "+08:00";
  const parsed = Date.parse(withZone);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function chinaParts(epoch: number) {
  const date = new Date((epoch + CHINA_OFFSET_SECONDS) * 1000);
  return {
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function daypartLabel(hour: number) {
  if (hour < 5) return "凌晨";
  if (hour < 8) return "早上";
  if (hour < 11) return "上午";
  if (hour < 13) return "中午";
  if (hour < 17) return "下午";
  if (hour < 19) return "傍晚";
  if (hour < 23) return "晚上";
  return "深夜";
}

function clockLabel(epoch: number) {
  const parts = chinaParts(epoch);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function durationLabel(seconds: number) {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}小时${rest}分钟` : `${hours}小时`;
}

function preview(value: unknown) {
  return String(value || "").split("|||")[0].trim().slice(0, 40);
}

export function buildConversationTimeStatePrompt(
  messages: any[] = [],
  historyMessages: any[] = [],
  currentDatetime = "",
) {
  const list = [
    ...(Array.isArray(historyMessages) ? historyMessages : []),
    ...(Array.isArray(messages) ? messages : []),
  ].filter((message) => message && String(message.content || "").trim());
  if (!list.length) return "";

  const nowEpoch = datetimeEpoch(currentDatetime) || Math.floor(Date.now() / 1000);
  const nowParts = chinaParts(nowEpoch);
  const users = list
    .map((message, index) => ({ message, index }))
    .filter((entry) => entry.message.role === "user" && messageEpoch(entry.message) > 0);
  const latestUser = users.at(-1);
  if (!latestUser) return "";

  const currentEpoch = messageEpoch(latestUser.message);
  const currentParts = chinaParts(currentEpoch);
  const responseDelay = Math.max(0, nowEpoch - currentEpoch);
  const previousExplicitUser = [...users.slice(0, -1)].reverse()
    .find((entry) =>
      String(entry.message.time_kind || "") === "ui_explicit" &&
      messageEpoch(entry.message) < currentEpoch - 60
    );
  const previousExplicitEpoch = previousExplicitUser ? messageEpoch(previousExplicitUser.message) : 0;
  const sessionGap = previousExplicitEpoch > 0 ? Math.max(0, currentEpoch - previousExplicitEpoch) : 0;
  const newSession = sessionGap >= SESSION_GAP_SECONDS;
  const previousAssistant = [...list.slice(0, latestUser.index)].reverse()
    .find((message) => message.role === "assistant" && String(message.content || "").trim());

  const lines = [
    "【对话时间状态｜代码已判定】",
    `- 现在是${daypartLabel(nowParts.hour)} ${clockLabel(nowEpoch)}；他最新这条是${daypartLabel(currentParts.hour)} ${clockLabel(currentEpoch)}。`,
  ];

  if (responseDelay >= 30 * 60) {
    lines.push(`- 他这条已经放了${durationLabel(responseDelay)}。按现在的时间回答，不要演成他刚说完时的场景。`);
  }

  if (newSession) {
    lines.push(`- 这是新一段对话：和上一条有明确时间的消息隔了${durationLabel(sessionGap)}，旧对话已经结束。`);
    if (previousAssistant) {
      lines.push(`- 旧对话里你最后说“${preview(previousAssistant.content)}”，这只代表当时；不能把睡觉、吃饭、上班、出门、忙碌等旧状态续到现在。`);
    }
  }

  if (daypartLabel(currentParts.hour) !== daypartLabel(nowParts.hour)) {
    lines.push(`- 时段已经从${daypartLabel(currentParts.hour)}变到${daypartLabel(nowParts.hour)}，回复必须按现在的时段接。`);
  }

  return lines.join("\n");
}
