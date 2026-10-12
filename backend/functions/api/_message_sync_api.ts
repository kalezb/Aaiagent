import { validateToken } from "./_access_runtime";
import {
  countInsertedRows,
  loadRecentAiReplyFingerprints,
  makeSyncedMessageKey,
  normalizeMessageSource,
  normalizeTranscriptFingerprint,
  updateConversationStats,
} from "./_history_runtime";
import { json } from "./_http_runtime";
import { loadRuntimePersonaFacts } from "./_persona_runtime";
import { maybeExtractCustomerProfile } from "./_profile_runtime";
import { maybeSummarizeConversation } from "./_temporal_state";
import {
  SYNCED_TIME_KINDS,
} from "./_time_runtime";
import { resolveMessageTranscript } from "./_transcript_runtime";

export async function handleMessageSyncRequest({
  request,
  env,
  context,
  path,
  method,
}) {
  // POST /api/messages/sync — monitor mode
  if (path === "/api/messages/sync" && method === "POST") {
    const authHeader = request.headers.get("Authorization") || "";
    const tokenRow = await validateToken(env.DB, authHeader);
    if (!tokenRow) return json({ error: "\u65e0\u6548\u7684\u8bbe\u5907\u5bc6\u94a5" }, 401);
    const body = await request.json();
    const { platform, contact_id, contact_name, messages } = body;
    if (!platform || !contact_id || !contact_name || !messages || !Array.isArray(messages)) {
      return json({ error: "\u7f3a\u5c11\u5fc5\u8981\u53c2\u6570" }, 400);
    }
    if (messages.length > 200) return json({ error: "单次最多同步200条" }, 413);
    const nowSec = Math.floor(Date.now() / 1000);
    const validMessages = [];
    const activePersonaId = String(tokenRow.active_persona_id || "female");
    const effectivePersona = await loadRuntimePersonaFacts(
      env.DB,
      tokenRow.token,
      activePersonaId,
    );
    const aiReplyFingerprints = await loadRecentAiReplyFingerprints(
      env.DB,
      tokenRow.token,
      platform,
      contact_id,
      nowSec,
    );
    let skippedDuplicates = 0;
    // 2026-10-07（方案 B 第二层）：手机重读同一条消息时，消息 key 可能变（时间标签会变），
    // 以前就会在历史里插出重复行（稀奇真机就是这样）。这里按“谁发的+内容”再做一道时间窗去重。
    const recentContentKeys = new Set();
    try {
      const recentRows = await env.DB.prepare(
        "SELECT role, content FROM chat_history WHERE token = ? AND platform = ? AND contact_id = ? AND created_at > ?"
      ).bind(tokenRow.token, platform, contact_id, nowSec - 6 * 3600).all();
      for (const row of recentRows?.results || []) {
        recentContentKeys.add(
          String(row.role) + "\u001f" + normalizeTranscriptFingerprint(row.content),
        );
      }
    } catch (_) {
      // 查不到就跳过去重，不影响正常同步。
    }
    for (let index = 0; index < messages.length; index++) {
      const msg = messages[index] || {};
      const role = msg.role === "assistant" ? "assistant" : "user";
      const content = String(msg.content || "").trim();
      if (!content || content.length > 4000) continue;
      if (role === "assistant" && aiReplyFingerprints.size > 0) {
        const fingerprint = normalizeTranscriptFingerprint(content);
        if (fingerprint && aiReplyFingerprints.has(fingerprint)) {
          skippedDuplicates += 1;
          continue;
        }
      }
      const source = normalizeMessageSource(msg.source);
      const contentKey = role + "\u001f" + normalizeTranscriptFingerprint(content);
      // 只挡“纯重复同步”；如果这次报的是 human_phone（本人手打确认），
      // 那是对已有行的来源修正，不能挡。
      if (source !== "human_phone" && recentContentKeys.has(contentKey)) {
        skippedDuplicates += 1;
        continue;
      }
      recentContentKeys.add(contentKey);
      validMessages.push({
        role,
        content,
        created_at: Number(msg.created_at || nowSec),
        source,
        message_key: makeSyncedMessageKey(tokenRow.token, platform, contact_id, msg),
        persona_id: role === "assistant" && source !== "human_phone" ? activePersonaId : "",
        persona_version: role === "assistant" && source !== "human_phone"
          ? effectivePersona.version
          : 0,
        // 2026-10-07（时间可信）：手机告诉我们“界面到底有没有写出这条的时间”。
        // ui_explicit=界面写了（他真实发送时间）；其余按首次读到算。
        time_kind: SYNCED_TIME_KINDS.has(String(msg.time_kind || ""))
          ? String(msg.time_kind)
          : "first_observed",
        // 2026-10-07 方案A：语音转写与时长单独存，不塞进 content（身份锚点不能变）。
        transcript: resolveMessageTranscript(content, msg.transcript),
        voice_seconds: Math.max(0, Math.min(600, Number(msg.voice_seconds || 0) || 0)),
      });
    }
    const stmt = env.DB.prepare(
      "INSERT OR IGNORE INTO chat_history (token, platform, contact_id, contact_name, role, content, created_at, source, message_key, persona_id, persona_version, time_kind, transcript, voice_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const batch = validMessages.map((msg) => stmt.bind(
      tokenRow.token,
      platform,
      contact_id,
      contact_name,
      msg.role,
      msg.content,
      msg.created_at,
      msg.source,
      msg.message_key,
      msg.persona_id,
      msg.persona_version,
      msg.time_kind,
      msg.transcript,
      msg.voice_seconds,
    ));
    const batchResults = batch.length ? await env.DB.batch(batch) : [];
    // 2026-10-07 方案A：转写往往是“先同步了 [语音]，之后才点开转文字”的。
    // 同一条消息的 message_key 不变，所以 INSERT OR IGNORE 会把它忽略掉 ——
    // 这里再补一刀：把后到的转写/时长填到已经存在的那一行上（只补空值，不覆盖已有内容）。
    const transcriptFills = [];
    for (const msg of validMessages) {
      if (msg.transcript) {
        transcriptFills.push(env.DB.prepare(
          "UPDATE chat_history SET transcript = ? WHERE token = ? AND message_key = ? AND transcript = ''"
        ).bind(msg.transcript, tokenRow.token, msg.message_key));
      }
      if (Number(msg.voice_seconds || 0) > 0) {
        transcriptFills.push(env.DB.prepare(
          "UPDATE chat_history SET voice_seconds = ? WHERE token = ? AND message_key = ? AND voice_seconds = 0"
        ).bind(Number(msg.voice_seconds), tokenRow.token, msg.message_key));
      }
    }
    if (transcriptFills.length) await env.DB.batch(transcriptFills);
    const insertedCount = countInsertedRows(batchResults);
    const latestMessage = validMessages.reduce(
      (latest, message) => !latest || message.created_at >= latest.created_at
        ? message
        : latest,
      null,
    );
    if (insertedCount > 0) {
      await updateConversationStats(
        env.DB,
        tokenRow.token,
        platform,
        contact_id,
        contact_name,
        insertedCount,
        latestMessage,
        nowSec,
      );
      await env.DB.prepare(
        "UPDATE tokens SET last_used_at = ? WHERE token = ?"
      ).bind(nowSec, tokenRow.token).run();
      const profileJob = maybeExtractCustomerProfile(
        env,
        tokenRow,
        platform,
        contact_id,
      ).catch((error) => {
        console.error(
          "profile extraction failed",
          error instanceof Error ? error.message : String(error),
        );
      });
      const summarizeJob = maybeSummarizeConversation(
        env,
        tokenRow,
        platform,
        contact_id,
      ).catch(() => {});
      if (typeof context.waitUntil === "function") {
        context.waitUntil(profileJob);
        context.waitUntil(summarizeJob);
      } else {
        await profileJob;
      }
    }
    return json({
      ok: true,
      accepted: validMessages.length,
      inserted: insertedCount,
      skipped_duplicates: skippedDuplicates,
    });
  }

  return null;
}
