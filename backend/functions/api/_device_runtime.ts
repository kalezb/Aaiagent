import { normalizePlatform } from "./_chat_input";
import { CHINA_TIME_ZONE } from "./_time_runtime";

export const DEFAULT_DEVICE_SETTINGS = Object.freeze({
  platform: "soul",
  hosting_enabled: false,
  monitor_enabled: true,
  weather_enabled: true,
  time_enabled: true,
  reply_pace_sec: 0,
  ai_hours_enabled: false,
  ai_start_hour: 8,
  ai_end_hour: 23,
  model_line: "",
});

export function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

export function isWithinAiHours(settings, nowSec = Math.floor(Date.now() / 1000)) {
  if (!settings?.ai_hours_enabled) return true;
  const hour = Number(new Intl.DateTimeFormat("zh-CN", {
    timeZone: CHINA_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date(nowSec * 1000)));
  const start = Math.max(0, Math.min(23, Number(settings.ai_start_hour ?? 8)));
  const end = Math.max(0, Math.min(23, Number(settings.ai_end_hour ?? 23)));
  if (start <= end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export async function loadDeviceSettings(db, token) {
  const row = await db.prepare(
    "SELECT platform, hosting_enabled, monitor_enabled, weather_enabled, time_enabled, reply_pace_sec, ai_hours_enabled, ai_start_hour, ai_end_hour, model_line FROM device_settings WHERE token = ? LIMIT 1"
  ).bind(token).first();
  if (!row) return { ...DEFAULT_DEVICE_SETTINGS };
  return {
    platform: normalizePlatform(row.platform, DEFAULT_DEVICE_SETTINGS.platform),
    hosting_enabled: parseBoolean(row.hosting_enabled, DEFAULT_DEVICE_SETTINGS.hosting_enabled),
    monitor_enabled: parseBoolean(row.monitor_enabled, DEFAULT_DEVICE_SETTINGS.monitor_enabled),
    weather_enabled: parseBoolean(row.weather_enabled, DEFAULT_DEVICE_SETTINGS.weather_enabled),
    time_enabled: parseBoolean(row.time_enabled, DEFAULT_DEVICE_SETTINGS.time_enabled),
    reply_pace_sec: Math.max(0, Math.min(300, Number(row.reply_pace_sec ?? 0) || 0)),
    ai_hours_enabled: parseBoolean(row.ai_hours_enabled, false),
    ai_start_hour: Math.max(0, Math.min(23, Number(row.ai_start_hour ?? 8) || 0)),
    ai_end_hour: Math.max(0, Math.min(23, Number(row.ai_end_hour ?? 23) || 0)),
    model_line: ["a", "b"].includes(String(row.model_line || "").trim().toLowerCase())
      ? String(row.model_line).trim().toLowerCase()
      : "",
  };
}

export async function saveDeviceSetting(db, token, field, value) {
  const allowedFields = new Set([
    "platform",
    "hosting_enabled",
    "monitor_enabled",
    "weather_enabled",
    "time_enabled",
    "reply_pace_sec",
    "ai_hours_enabled",
    "ai_start_hour",
    "ai_end_hour",
    "model_line",
  ]);
  if (!allowedFields.has(field)) throw new Error("unsupported_device_setting");
  const now = Math.floor(Date.now() / 1000);
  const defaults = DEFAULT_DEVICE_SETTINGS;
  const insert = "INSERT INTO device_settings (token, platform, hosting_enabled, monitor_enabled, weather_enabled, time_enabled, reply_pace_sec, ai_hours_enabled, ai_start_hour, ai_end_hour, model_line, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ";
  const conflict = `ON CONFLICT(token) DO UPDATE SET ${field} = excluded.${field}, updated_at = excluded.updated_at`;
  const base = {
    platform: defaults.platform,
    hosting_enabled: defaults.hosting_enabled ? 1 : 0,
    monitor_enabled: defaults.monitor_enabled ? 1 : 0,
    weather_enabled: defaults.weather_enabled ? 1 : 0,
    time_enabled: defaults.time_enabled ? 1 : 0,
    reply_pace_sec: 0,
    ai_hours_enabled: 0,
    ai_start_hour: 8,
    ai_end_hour: 23,
    model_line: "",
  };
  if (field === "platform") base.platform = String(value);
  else if (field === "hosting_enabled") base.hosting_enabled = parseBoolean(value, false) ? 1 : 0;
  else if (field === "monitor_enabled") base.monitor_enabled = parseBoolean(value, false) ? 1 : 0;
  else if (field === "weather_enabled") base.weather_enabled = parseBoolean(value, false) ? 1 : 0;
  else if (field === "time_enabled") base.time_enabled = parseBoolean(value, false) ? 1 : 0;
  else if (field === "reply_pace_sec") base.reply_pace_sec = Math.max(0, Math.min(300, Number(value) || 0));
  else if (field === "ai_hours_enabled") base.ai_hours_enabled = parseBoolean(value, false) ? 1 : 0;
  else if (field === "ai_start_hour") base.ai_start_hour = Math.max(0, Math.min(23, Number(value) || 0));
  else if (field === "ai_end_hour") base.ai_end_hour = Math.max(0, Math.min(23, Number(value) || 0));
  else if (field === "model_line") base.model_line = ["a", "b"].includes(String(value || "").trim().toLowerCase())
    ? String(value).trim().toLowerCase()
    : "";
  await db.prepare(insert + conflict).bind(
    token,
    base.platform,
    base.hosting_enabled,
    base.monitor_enabled,
    base.weather_enabled,
    base.time_enabled,
    base.reply_pace_sec,
    base.ai_hours_enabled,
    base.ai_start_hour,
    base.ai_end_hour,
    base.model_line,
    now,
  ).run();
  return loadDeviceSettings(db, token);
}

export async function enforceChatRateLimit(db, token, limitPerMinute = 30) {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSec / 60) * 60;
  const row = await db.prepare(
    "SELECT window_start, request_count FROM request_limits WHERE token = ? AND scope = 'chat' LIMIT 1"
  ).bind(token).first();
  if (row && Number(row.window_start || 0) === windowStart && Number(row.request_count || 0) >= limitPerMinute) {
    return { allowed: false, windowStart, requestCount: Number(row.request_count || 0) };
  }
  if (row && Number(row.window_start || 0) === windowStart) {
    await db.prepare("UPDATE request_limits SET request_count = request_count + 1 WHERE token = ? AND scope = 'chat'")
      .bind(token).run();
  } else {
    await db.prepare(
      "INSERT INTO request_limits (token, scope, window_start, request_count) VALUES (?, 'chat', ?, 1) " +
      "ON CONFLICT(token, scope) DO UPDATE SET window_start = excluded.window_start, request_count = 1"
    ).bind(token, windowStart).run();
  }
  const requestCount = row && Number(row.window_start || 0) === windowStart
    ? Number(row.request_count || 0) + 1
    : 1;
  return { allowed: true, windowStart, requestCount };
}
