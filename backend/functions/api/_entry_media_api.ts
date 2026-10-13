import { validateToken } from "./_access_runtime";
import {
  normalizeHostingMode,
  normalizePlatform,
} from "./_chat_input";
import { handleFishAudioRequest } from "./_fish_audio";
import { json, parseJsonBody } from "./_http_runtime";
import {
  buildMediaPayload,
  loadScopedMediaGroups,
} from "./_media_runtime";
import { serveMediaImage } from "./_media_image_response";
import {
  chooseMediaAsset,
} from "./_media_policy";
import {
  estimateLlmCost,
  recordTokenUsage,
} from "./_model_call_runtime";
import {
  loadRuntimePersonaFacts,
} from "./_persona_runtime";
import { loadOrCreatePendingReply } from "./_reply_policy";
import { requestVoicePerformance } from "./_voice_performance";

export async function handleEntryMediaRequest({ request, env, path, method }) {
  // GET /api/status — health check
  if (path === "/api/status" && method === "GET") {
    await env.DB.prepare("SELECT 1").first();
    return json({ status: "ok", time: Math.floor(Date.now() / 1000) });
  }

  // Fish Audio API proxy. The Fish API key stays in Cloudflare Secrets.
  if (path.startsWith("/api/voice/")) {
    const authHeader = request.headers.get("Authorization") || "";
    const tokenRow = await validateToken(env.DB, authHeader);
    if (!tokenRow) return json({ error: "unauthorized" }, 401);

    // 情绪表演层：把一条**已经定稿**的回复变成"带官方情绪标签的 TTS 文本"。
    // 单独做成一个接口，是为了完全不碰现有文字回复管线 ——
    // 不打算发语音时根本不会走到这里；就算走到这里失败了，
    // 也只是这条语音没有情绪，不影响文字回复本身。
    if (path === "/api/voice/performance" && method === "POST") {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const replyText = String(body?.reply_text || "").trim();
      if (!replyText) return json({ error: "缺少 reply_text" }, 400);
      const contextLines = Array.isArray(body?.context)
        ? (body.context as unknown[]).slice(0, 12).map((line) => String(line ?? ""))
        : [];
      const performance = await requestVoicePerformance(env, {
        replyText,
        contextLines,
        previousState: typeof body?.previous_state === "string"
          ? body.previous_state
          : null,
      });
      // 这是一次真实计费调用，用量要入账，否则成本统计会漏。
      if (typeof performance.promptChars === "number") {
        await recordTokenUsage(
          env.DB,
          tokenRow.token,
          estimateLlmCost({
            usage: performance.usage,
            inputChars: performance.promptChars,
            outputChars: performance.outputChars ?? 0,
          }, env),
        );
      }
      return json({
        success: true,
        tagged_text: performance.taggedText,
        state: performance.stateJson,
        dominant_emotion: performance.dominantEmotion,
        raw_emotion: performance.rawEmotion ?? "",
        segments: performance.segments ?? [],
        planned: performance.planned,
        reason: performance.reason ?? "",
      });
    }

    const fishResponse = await handleFishAudioRequest(request, env, path, method);
    if (fishResponse) return fishResponse;
  }

  // GET /api/media/:id - authenticated proxy for topic-triggered images.
  if (path.startsWith("/api/media/") && method === "GET") {
    const authHeader = request.headers.get("Authorization") || "";
    const tokenRow = await validateToken(env.DB, authHeader);
    if (!tokenRow) return json({ error: "无效的设备密钥" }, 401);

    let assetId = "";
    try {
      assetId = decodeURIComponent(path.slice("/api/media/".length));
    } catch (_) {
      return json({ error: "图片编号无效" }, 400);
    }
    if (!/^[A-Za-z0-9._:-]{1,160}$/u.test(assetId)) {
      return json({ error: "图片编号无效" }, 400);
    }

    const asset = await env.DB.prepare(
      "SELECT id, file_name, content_type, source_url, storage_key FROM media_assets WHERE id = ? LIMIT 1"
    ).bind(assetId).first();
    return serveMediaImage({
      env,
      asset,
      assetId,
      options: {
        missingError: "图片不存在",
        missingStorageError: "image_not_found",
        storageUnavailableError: "image_storage_unavailable",
        maxStorageBytes: 12 * 1024 * 1024,
        storageTooLargeError: "image_too_large",
        maxProxyBytes: 12 * 1024 * 1024,
        proxyTooLargeError: "图片过大",
        checkProxyContentLength: true,
        preferUpstreamContentType: true,
        includeCors: true,
      },
    });
  }

  // POST /api/media/exchange - stage the approved daily photo for Soul exchange.
  if (path === "/api/media/exchange" && method === "POST") {
    const authHeader = request.headers.get("Authorization") || "";
    const tokenRow = await validateToken(env.DB, authHeader);
    if (!tokenRow) return json({ error: "无效的设备密钥" }, 401);
    const parsedBody = await parseJsonBody(request, 32 * 1024);
    if (parsedBody.error) return json({ error: parsedBody.error }, parsedBody.status);
    const body = parsedBody.body;
    const platform = normalizePlatform(body.platform);
    const hostingMode = normalizeHostingMode(body.hosting_mode);
    const contactId = String(body.contact_id || "").trim().slice(0, 200);
    const contactName = String(body.contact_name || "").trim().slice(0, 200);
    const requestId = String(body.request_id || "").trim().slice(0, 120) || crypto.randomUUID();
    const activePersonaId = String(tokenRow.active_persona_id || "female");
    // 只做"平台 + 托管模式"这两道门，**不再硬编码人设**。
    //
    // 原来这里还有 `!isStarSoulMediaScope(activePersonaId, platform)`，等于写死
    // "只有 persona_id === 'female' 能用日常照换图"。用户实际用的是 female_sutang，
    // 于是每一次以图换图都被判 skip，而且 skip 里连原因都不给 ——
    // App 那边把它当成"媒体还没准备好"，每 6 秒重试一次、无限空转。
    //
    // 人设的归属由下面 loadScopedMediaGroups(..., "daily") 精确决定：
    // 那个查询会带上 persona_id，只有真正配了 daily 组的人设才拿得到，
    // 没配就会走到 daily_media_group_not_found —— 那是一个**带原因**的答复。
    // 所以这道硬编码的门既没必要，又把真正的原因挡住了。
    if (platform !== "soul" || hostingMode !== "full_auto") {
      return json({ action: "skip", error: "exchange_not_enabled_for_mode_or_platform" });
    }
    if (!contactId || !contactName) return json({ error: "缺少必要参数" }, 400);

    const groups = await loadScopedMediaGroups(env.DB, activePersonaId, platform, "daily");
    const group = groups[0];
    if (!group) return json({ action: "skip", error: "daily_media_group_not_found" }, 404);
    const { results: mediaAssets } = await env.DB.prepare(
      "SELECT id, group_id, file_name, content_type FROM media_assets WHERE group_id = ? ORDER BY created_at ASC, id ASC"
    ).bind(group.id).all();
    const { results: recentMedia } = await env.DB.prepare(
      "SELECT asset_id FROM media_send_log WHERE token = ? AND persona_id = ? AND platform = ? AND contact_id = ? AND group_id = ? AND status = 'confirmed' ORDER BY confirmed_at DESC LIMIT 2"
    ).bind(tokenRow.token, activePersonaId, platform, contactId, group.id).all();
    const selectedMedia = chooseMediaAsset(
      mediaAssets || [],
      (recentMedia || []).map((item) => String(item.asset_id || "")),
    );
    const mediaPayload = buildMediaPayload(selectedMedia);
    if (!mediaPayload) return json({ action: "skip", error: "daily_media_not_found" }, 404);

    const nowSec = Math.floor(Date.now() / 1000);
    const effectivePersona = await loadRuntimePersonaFacts(
      env.DB,
      tokenRow.token,
      activePersonaId,
    );
    const pending = await loadOrCreatePendingReply(env.DB, {
      token: tokenRow.token,
      requestId,
      platform,
      contactId,
      contactName,
      content: "[图片:" + mediaPayload.asset_id + "]",
      actionType: "image",
      mediaGroupId: mediaPayload.group_id,
      mediaAssetId: mediaPayload.asset_id,
      createdAt: nowSec,
      personaId: activePersonaId,
      personaVersion: effectivePersona.version,
    });
    return json({
      action: pending.status === "confirmed" ? "skip" : "send_media",
      reply: pending.content,
      reply_id: pending.id,
      media: {
        ...mediaPayload,
        asset_id: pending.media_asset_id || mediaPayload.asset_id,
        group_id: pending.media_group_id || mediaPayload.group_id,
      },
      status: pending.status,
    });
  }

  // POST /api/dashboard/login - verify password without exposing it in the client bundle.
  if (path === "/api/dashboard/login" && method === "POST") {
    if (!env.DASHBOARD_PASSWORD) {
      return json({ success: false, error: "dashboard_not_configured" }, 503);
    }
    const body = await request.json();
    if (String(body.password || "") !== env.DASHBOARD_PASSWORD) {
      return json({ success: false, error: "invalid_password" }, 401);
    }
    return json({ success: true });
  }

  return null;
}
