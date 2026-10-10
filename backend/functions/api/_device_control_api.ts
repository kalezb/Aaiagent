import {
  isDashboardAuthorized,
  validateToken,
} from "./_access_runtime";
import {
  DEFAULT_DEVICE_SETTINGS,
  loadDeviceSettings,
  saveDeviceSetting,
} from "./_device_runtime";
import {
  createTimeoutSignal,
  isAbortError,
  json,
  upstreamErrorDetail,
} from "./_http_runtime";
import {
  buildModelHeaders,
  buildModelRequestPayload,
  invalidateLlmConfigCache,
  isGeminiModelConfig,
  loadLlmConfig,
} from "./_model_runtime";

export async function handleDeviceControlRequest({
  request,
  env,
  url,
  path,
  method,
}) {
  // GET /api/hosting-config - dashboard reads one device pacing + duty hours
  if (path === "/api/hosting-config" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const token = String(url.searchParams.get("token") || "").trim();
    if (!token) return json({ error: "missing token" }, 400);
    return json(await loadDeviceSettings(env.DB, token));
  }

  // GET /api/model-route/health - phone checks whether one line is actually reachable.
  if (path === "/api/model-route/health" && method === "GET") {
    const authHeader = request.headers.get("Authorization") || "";
    const tokenRow = await validateToken(env.DB, authHeader);
    if (!tokenRow) return json({ ok: false, error: "设备钥匙无效" }, 401);
    const line = String(url.searchParams.get("line") || "").trim().toLowerCase();
    if (line !== "a" && line !== "b") return json({ ok: false, error: "line 无效" }, 400);
    const modelConfig = await loadLlmConfig(env.KV, env, line);
    const usingGemini = isGeminiModelConfig(modelConfig);
    const apiKey = usingGemini
      ? (modelConfig.apiKeyOverride || env.GEMINI_API_KEY || "")
      : (env.DEEPSEEK_API_KEY || "");
    if (!apiKey) {
      return json({ ok: false, line, error: usingGemini ? "线路B未配置" : "线路A未配置" }, 503);
    }
    const startedAt = Date.now();
    try {
      const response = await fetch(modelConfig.baseUrl + "/chat/completions", {
        method: "POST",
        headers: buildModelHeaders(apiKey, modelConfig),
        body: JSON.stringify(buildModelRequestPayload(
          modelConfig,
          modelConfig.modelName,
          [{ role: "user", content: "只回复 ok" }],
          0,
          usingGemini ? 512 : 8,
        )),
        signal: createTimeoutSignal(8_000),
      });
      if (!response.ok) {
        const detail = await upstreamErrorDetail(response);
        return json({
          ok: false,
          line,
          error: "线路连接失败",
          upstream_status: response.status,
          upstream_detail: detail,
        }, 503);
      }
      return json({
        ok: true,
        line,
        provider: usingGemini ? "gemini" : "deepseek",
        latency_ms: Date.now() - startedAt,
      });
    } catch (error) {
      return json({
        ok: false,
        line,
        error: isAbortError(error) ? "线路连接超时" : "线路连接失败",
      }, 503);
    }
  }

  // GET /api/model-route - dashboard reads the selected device's own line
  if (path === "/api/model-route" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const token = String(url.searchParams.get("token") || "").trim();
    if (!token) return json({ error: "missing token" }, 400);
    const settings = await loadDeviceSettings(env.DB, token);
    const provider = String(await env.KV.get("llm:provider") || "").trim().toLowerCase();
    return json({ line: settings.model_line || (provider === "gemini" ? "b" : "a") });
  }

  // PUT /api/model-route - dashboard switches this device only
  if (path === "/api/model-route" && method === "PUT") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const token = String(body.token || "").trim();
    const line = String(body.line || "").trim().toLowerCase();
    if (!token) return json({ error: "missing token" }, 400);
    if (line !== "a" && line !== "b") return json({ error: "line 无效" }, 400);
    await saveDeviceSetting(env.DB, token, "model_line", line);
    invalidateLlmConfigCache(env.KV);
    return json({ success: true, line });
  }

  // PUT /api/hosting-config - reply-pace + AI duty hours (borrows xiniuzi reply-pace + ai-hours)
  if (path === "/api/hosting-config" && method === "PUT") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "未授权" }, 401);
    const body = await request.json();
    const token = String(body.token || "").trim();
    if (!token) return json({ error: "缺少 token" }, 400);
    if (body.platform !== undefined) {
      await saveDeviceSetting(env.DB, token, "platform", body.platform);
    }
    if (body.hosting_enabled !== undefined) {
      await saveDeviceSetting(env.DB, token, "hosting_enabled", body.hosting_enabled);
    }
    if (body.monitor_enabled !== undefined) {
      await saveDeviceSetting(env.DB, token, "monitor_enabled", body.monitor_enabled);
    }
    if (body.weather_enabled !== undefined) {
      await saveDeviceSetting(env.DB, token, "weather_enabled", body.weather_enabled);
    }
    if (body.time_enabled !== undefined) {
      await saveDeviceSetting(env.DB, token, "time_enabled", body.time_enabled);
    }
    if (body.reply_pace_sec !== undefined) {
      await saveDeviceSetting(env.DB, token, "reply_pace_sec", body.reply_pace_sec);
    }
    if (body.ai_hours_enabled !== undefined) {
      await saveDeviceSetting(env.DB, token, "ai_hours_enabled", body.ai_hours_enabled);
    }
    if (body.ai_start_hour !== undefined) {
      await saveDeviceSetting(env.DB, token, "ai_start_hour", body.ai_start_hour);
    }
    if (body.ai_end_hour !== undefined) {
      await saveDeviceSetting(env.DB, token, "ai_end_hour", body.ai_end_hour);
    }
    return json({ success: true, settings: await loadDeviceSettings(env.DB, token) });
  }

  return null;
}
