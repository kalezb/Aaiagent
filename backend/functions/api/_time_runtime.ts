export const CHINA_TIME_ZONE = "Asia/Shanghai";
export const SYNCED_TIME_KINDS = new Set(["ui_explicit", "first_observed", "derived"]);

export function getChinaTimeContext(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: CHINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    currentDatetime: value("year") + "-" + value("month") + "-" + value("day") + " " +
      value("hour") + ":" + value("minute") + ":" + value("second"),
    weekday: value("weekday"),
  };
}

export function formatChinaMessageTime(epochSeconds) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: CHINA_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(epochSeconds * 1000));
}

export function requestMessageEpochSeconds(message) {
  const raw = Number(message?.created_at || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 1_000_000_000_000 ? Math.floor(raw / 1000) : Math.floor(raw);
}

export function currentMonthKey(epochSeconds = Math.floor(Date.now() / 1000)) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CHINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).format(new Date(epochSeconds * 1000));
}

export function formatChinaClock(epochSeconds) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: CHINA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(epochSeconds * 1000));
}

export function formatChineseDuration(seconds) {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  if (totalMinutes < 60) return totalMinutes + " 分钟";
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) return totalHours + " 小时" + (minutes ? " " + minutes + " 分" : "");
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days + " 天" + (hours ? " " + hours + " 小时" : "");
}
