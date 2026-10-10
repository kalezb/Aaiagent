import {
  buildMediaGroupQuery,
  chooseMediaAsset,
  isRealtimeImageRequest,
  mediaDownloadUrl,
  normalizePersonalPhotoIntent,
} from "./_media_policy";
import { loadOrCreatePendingReply } from "./_reply_policy";
import { requestReplyRepair } from "./_model_call_runtime";

export function buildMediaPayload(asset) {
  const assetId = String(asset?.id || "").trim();
  if (!assetId) return null;
  return {
    type: "image",
    asset_id: assetId,
    group_id: String(asset.group_id || "").trim(),
    download_url: mediaDownloadUrl(assetId),
    content_type: String(asset.content_type || "image/jpeg").trim(),
    file_name: String(asset.file_name || assetId + ".jpg").trim(),
  };
}

export async function loadScopedMediaGroups(db, personaId, platform, groupId = "") {
  const { sql, params } = buildMediaGroupQuery(personaId, platform, groupId);
  const { results } = await db.prepare(sql).bind(...params).all();
  return results || [];
}

export async function stageScopedMediaReply({
  db,
  token,
  personaId,
  personaVersion,
  platform,
  contactId,
  contactName,
  requestId,
  group,
  createdAt,
}) {
  const groupId = String(group?.id || "").trim();
  if (!groupId) return null;

  const { results: mediaAssets } = await db.prepare(
    "SELECT id, group_id, file_name, content_type FROM media_assets WHERE group_id = ? ORDER BY created_at ASC, id ASC"
  ).bind(groupId).all();
  const { results: recentMedia } = await db.prepare(
    "SELECT asset_id FROM media_send_log WHERE token = ? AND persona_id = ? AND platform = ? AND contact_id = ? AND group_id = ? AND status = 'confirmed' ORDER BY confirmed_at DESC LIMIT 2"
  ).bind(token, personaId, platform, contactId, groupId).all();
  const selectedMedia = chooseMediaAsset(
    mediaAssets || [],
    (recentMedia || []).map((item) => String(item.asset_id || ""))
  );
  const mediaPayload = buildMediaPayload(selectedMedia);
  if (!mediaPayload) return null;

  const pending = await loadOrCreatePendingReply(db, {
    token,
    requestId,
    platform,
    contactId,
    contactName,
    content: "[图片:" + mediaPayload.asset_id + "]",
    actionType: "image",
    mediaGroupId: mediaPayload.group_id,
    mediaAssetId: mediaPayload.asset_id,
    createdAt,
    personaId,
    personaVersion,
  });
  return { mediaPayload, pending };
}

const MEDIA_TEASER_LINES = [
  "你这人倒是挺直接的呀，行吧",
  "行吧 就给你看一眼",
  "先说好 就一张啊",
  "看可以 别到处说呀",
];

export function mediaTeaserLine(seed) {
  const text = String(seed || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return MEDIA_TEASER_LINES[Math.abs(hash) % MEDIA_TEASER_LINES.length];
}

export function mediaDirectiveFallback(incomingText) {
  if (isRealtimeImageRequest(incomingText)) return "这会儿不方便拍，打字聊吧。";
  const incoming = String(incomingText || "").replace(/\s+/gu, "");
  if (/^(?:看一下|看看|看下|看啥|看什么)(?:呗|吧|呀|啊)?[？?]?$/u.test(incoming)) return "看什么？";
  return "急啥呀，先聊着";
}

const PHOTO_INTENT_CLASSIFIER_SYSTEM_PROMPT =
  "你是聊天照片意图分类器。只输出 DAILY、BODY 或 NONE，不能解释。结合最近完整对话，判断最后一条用户消息是否在要求聊天对象本人发已有照片。" +
  "DAILY：明确想看对方本人、样子、长相、日常照或普通照片，但没有指定身材、腿或腰。" +
  "BODY：明确指定要看对方本人的身材照、腿照、腰照或身体部位。" +
  "NONE：讨论、夸奖或拒绝照片；聊机器、设备、手机、电脑、房间、截图或物品；要求实时拍摄，询问当下天气、位置、穿着或正在做什么；只说“看一下、发一下、给一下”但上文指向物品；含义不清。" +
  "不要因为出现“看、发、照片”等词就判为请求，必须判断最后一句实际指向的对象。";
const PHOTO_INTENT_CLASSIFIER_TIMEOUT_MS = 2_500;

export function buildPhotoIntentClassifierPrompt(texts) {
  const recent = (Array.isArray(texts) ? texts : [])
    .map((text) => String(text || "").trim())
    .filter(Boolean)
    .slice(-6);
  return "最近用户消息（从旧到新）：\n" +
    recent.map((text, index) => String(index + 1) + ". " + text).join("\n") +
    "\n最后一条用户消息：" + (recent[recent.length - 1] || "") +
    "\n只输出标签：";
}

export async function classifyPersonalPhotoIntent({
  env,
  token,
  apiKey,
  modelConfig,
  modelName,
  recentUserTexts,
  deadlineAt,
}) {
  if (!apiKey) return "none";
  try {
    const classification = await requestReplyRepair({
      env,
      token,
      apiKey,
      modelConfig,
      modelName,
      systemPrompt: PHOTO_INTENT_CLASSIFIER_SYSTEM_PROMPT,
      userPrompt: buildPhotoIntentClassifierPrompt(recentUserTexts),
      maxTokens: 8,
      deadlineAt: Math.min(
        Number(deadlineAt || 0),
        Date.now() + PHOTO_INTENT_CLASSIFIER_TIMEOUT_MS,
      ),
    });
    return normalizePersonalPhotoIntent(classification);
  } catch {
    return "none";
  }
}
