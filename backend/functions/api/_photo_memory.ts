const INCOMING_PHOTO_PATTERN =
  /^\s*\[\s*(?:图片(?::[^\]]*)?|闪照|对方发的图片(?::[^\]]*)?)\]\s*$/u;

function isIncomingPhotoMessage(message: any): boolean {
  if (!message || message.role === "assistant") return false;
  return INCOMING_PHOTO_PATTERN.test(String(message.content || "").trim());
}

function photoMessageTimestamp(message: any): number {
  if (!isIncomingPhotoMessage(message)) return 0;
  const createdAt = Number(message.created_at || message.createdAt || 0);
  return Number.isFinite(createdAt) && createdAt > 0 ? Math.floor(createdAt) : 0;
}

export function latestIncomingPhotoTimestamp(messages: any[] = [], fallback = 0): number {
  const photoMessages = messages.filter(isIncomingPhotoMessage);
  if (!photoMessages.length) return 0;
  const timestamps = photoMessages.map(photoMessageTimestamp).filter((value) => value > 0);
  if (timestamps.length) return Math.max(...timestamps);
  return Math.max(0, Math.floor(Number(fallback) || 0));
}

async function stampIncomingPhoto(
  db: any,
  {
    token,
    platform,
    contactId,
    contactName,
    photoAt,
    nowSec,
  }: {
    token: string;
    platform: string;
    contactId: string;
    contactName: string;
    photoAt: number;
    nowSec: number;
  },
) {
  await db.prepare(
    "INSERT INTO contacts (token, platform, contact_id, contact_name, is_whitelisted, notes, created_at, his_photo_at) " +
    "VALUES (?, ?, ?, ?, 1, '', ?, ?) " +
    "ON CONFLICT(token, platform, contact_id) DO UPDATE SET " +
    "his_photo_at = CASE " +
    "WHEN his_photo_at = 0 OR excluded.his_photo_at < his_photo_at THEN excluded.his_photo_at " +
    "ELSE his_photo_at END"
  ).bind(
    token,
    platform,
    contactId,
    contactName,
    nowSec,
    photoAt,
  ).run();
}

export async function rememberIncomingPhotoFromMessages(
  db: any,
  {
    token,
    platform,
    contactId,
    contactName,
    messages = [],
    nowSec,
  }: {
    token: string;
    platform: string;
    contactId: string;
    contactName: string;
    messages?: any[];
    nowSec: number;
  },
): Promise<number> {
  const photoAt = latestIncomingPhotoTimestamp(messages, nowSec);
  if (!photoAt) return 0;
  await stampIncomingPhoto(db, {
    token,
    platform,
    contactId,
    contactName,
    photoAt,
    nowSec,
  });
  return photoAt;
}

export async function recoverIncomingPhotoFromHistory(
  db: any,
  {
    token,
    platform,
    contactId,
    contactName,
    nowSec,
  }: {
    token: string;
    platform: string;
    contactId: string;
    contactName: string;
    nowSec: number;
  },
): Promise<number> {
  const row = await db.prepare(
    "SELECT MAX(created_at) AS photo_at FROM chat_history " +
    "WHERE token = ? AND platform = ? AND contact_id = ? AND role = 'user' " +
    "AND (TRIM(content) = '[图片]' OR TRIM(content) LIKE '[图片:%]' " +
    "OR TRIM(content) = '[闪照]' OR TRIM(content) = '[对方发的图片]' " +
    "OR TRIM(content) LIKE '[对方发的图片:%]')"
  ).bind(token, platform, contactId).first();
  const photoAt = Math.max(0, Math.floor(Number(row?.photo_at || 0)));
  if (!photoAt) return 0;
  await stampIncomingPhoto(db, {
    token,
    platform,
    contactId,
    contactName,
    photoAt,
    nowSec,
  });
  return photoAt;
}
