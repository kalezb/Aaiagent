import { validateToken } from "./_access_runtime";
import { json } from "./_http_runtime";
import { loadRuntimePersonaFacts } from "./_persona_runtime";
import {
  countInsertedRows,
  updateConversationStats,
} from "./_history_runtime";
import { markFunnelQuoteSent } from "./_funnel_runtime";

export async function handleChatConfirmRequest({ request, env, path, method }) {
  if (path !== "/api/chat/confirm" || method !== "POST") return null;

  const authHeader = request.headers.get("Authorization") || "";
  const tokenRow = await validateToken(env.DB, authHeader);
  if (!tokenRow) return json({ error: "无效的设备密钥" }, 401);
  const body = await request.json();
  const replyId = String(body.reply_id || "").trim();
  if (!replyId) return json({ error: "缺少 reply_id" }, 400);
  const pending = await env.DB.prepare(
    "SELECT id, request_id, platform, contact_id, contact_name, content, status, action_type, media_group_id, media_asset_id, persona_id, persona_version FROM pending_replies WHERE id = ? AND token = ? LIMIT 1"
  ).bind(replyId, tokenRow.token).first();
  if (!pending) return json({ error: "待确认回复不存在" }, 404);
  if (pending.status === "confirmed") return json({ success: true, status: "confirmed", duplicate: true });
  const currentPersonaId = String(tokenRow.active_persona_id || "female");
  const currentPersona = await loadRuntimePersonaFacts(env.DB, tokenRow.token, currentPersonaId);
  if (pending.status === "superseded" ||
    (pending.persona_id && pending.persona_id !== currentPersonaId) ||
    (Number(pending.persona_version || 0) > 0 && Number(pending.persona_version) !== currentPersona.version)
  ) {
    // 2026-10-07 真机（压到我腿毛了）：手机其实已经把这条发出去了，
    // 但这里因为“待确认回复被新请求顶掉”直接 409 返回、不写历史，
    // 结果云端缺了她说过的话——模型下一轮看不到自己刚说过什么，就会重复或自相矛盾。
    // 手机既然确认发出，就以它的内容为准记进历史。
    const sentByPhone = String(body.sent_content || pending.content || "").trim().slice(0, 4000);
    if (sentByPhone) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO chat_history (token, platform, contact_id, contact_name, role, content, created_at, source, message_key, persona_id, persona_version, time_kind, transcript, voice_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        tokenRow.token,
        pending.platform,
        pending.contact_id,
        pending.contact_name,
        "assistant",
        sentByPhone,
        Math.floor(Date.now() / 1000),
        "ai",
        "ai:" + pending.id,
        pending.persona_id || tokenRow.active_persona_id || "female",
        Number(pending.persona_version || 0),
        "ai_generated",
        "",
        0,
      ).run();
    }
    await env.DB.prepare(
      "UPDATE pending_replies SET status = 'superseded' WHERE id = ? AND token = ?"
    ).bind(pending.id, tokenRow.token).run();
    return json({ error: "待确认回复已过期", code: "reply_superseded" }, 409);
  }
  const sentContent = pending.action_type === "image" && pending.media_asset_id
    ? "[图片:" + String(pending.media_asset_id).trim() + "]"
    : String(body.sent_content || pending.content || "").trim().slice(0, 4000);
  const nowSec = Math.floor(Date.now() / 1000);
  // 2026-10-07 真机（稳重的神盾局特工）：同一条回复被发了两次，云端也存了两行。
  // 安卓侧已经加了“发之前先看这句是不是刚发过”，这里再兜一道：
  // 同一联系人 10 分钟内已经有同样的一条“她发的”，就不再存第二行。
  let duplicateAssistantContent = false;
  try {
    const recentRows = await env.DB.prepare(
      "SELECT id, platform, contact_id, role, content, created_at FROM chat_history " +
        "WHERE token = ? AND platform = ? AND contact_id = ? ORDER BY id DESC LIMIT 20"
    ).bind(tokenRow.token, pending.platform, pending.contact_id).all();
    duplicateAssistantContent = (recentRows?.results || []).some((row) =>
      String(row.role) === "assistant" &&
      String(row.contact_id) === String(pending.contact_id) &&
      String(row.content) === sentContent &&
      Number(row.created_at || 0) > nowSec - 600
    );
  } catch (_) {
    duplicateAssistantContent = false;
  }
  const confirmationStatements = [
    ...(duplicateAssistantContent ? [] : [
    env.DB.prepare(
      "INSERT OR IGNORE INTO chat_history (token, platform, contact_id, contact_name, role, content, created_at, source, message_key, persona_id, persona_version, time_kind, transcript, voice_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      tokenRow.token,
      pending.platform,
      pending.contact_id,
      pending.contact_name,
      "assistant",
      sentContent,
      nowSec,
      "ai",
      "ai:" + pending.id,
      pending.persona_id || tokenRow.active_persona_id || "female",
      Number(pending.persona_version || 0),
      "ai_generated",
      "",
      0,
    )]),
    env.DB.prepare(
      "UPDATE pending_replies SET status = 'confirmed', sent_content = ?, confirmed_at = ? WHERE id = ? AND token = ?"
    ).bind(sentContent, nowSec, pending.id, tokenRow.token),
  ];
  if (pending.action_type === "image" && pending.media_asset_id) {
    confirmationStatements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO media_send_log (token, request_id, group_id, asset_id, status, created_at, confirmed_at, persona_id, platform, contact_id) VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)"
      ).bind(
        tokenRow.token,
        pending.request_id || pending.id,
        pending.media_group_id || "",
        pending.media_asset_id,
        nowSec,
        nowSec,
        String(tokenRow.active_persona_id || "female"),
        pending.platform,
        pending.contact_id,
      )
    );
  }
  const [insertResult] = await env.DB.batch(confirmationStatements);
  const inserted = countInsertedRows([insertResult]);
  if (inserted > 0) {
    await updateConversationStats(
      env.DB,
      tokenRow.token,
      pending.platform,
      pending.contact_id,
      pending.contact_name,
      inserted,
      { role: "assistant", content: sentContent, source: "ai", created_at: nowSec, message_key: "ai:" + pending.id },
      nowSec
    );
  }
  await markFunnelQuoteSent(
    env.DB,
    tokenRow.token,
    pending.platform,
    pending.contact_id,
    sentContent,
    nowSec,
  );
  return json({ success: true, status: "confirmed", inserted });
}
