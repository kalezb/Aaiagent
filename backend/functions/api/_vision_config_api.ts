import { validateToken } from "./_access_runtime";
import {
  normalizePlatform,
} from "./_chat_input";
import {
  loadDeviceSettings,
  parseBoolean,
  saveDeviceSetting,
} from "./_device_runtime";
import { json } from "./_http_runtime";
import {
  buildModelHeaders,
  buildModelRequestPayload,
  invalidateLlmConfigCache,
  isGeminiModelConfig,
  loadLlmConfig,
} from "./_model_runtime";
import {
  enforceTokenBudget,
  estimateLlmCost,
  recordTokenUsage,
} from "./_model_call_runtime";
import { activatePersonaForToken } from "./_persona_admin";

export async function handleVisionConfigRequest({ request, env, path, method }) {
  // POST /api/vision/describe - image/sticker understanding for chat media
  if (path === "/api/vision/describe" && method === "POST") {
    const authHeader = request.headers.get("Authorization") || "";
    const tokenRow = await validateToken(env.DB, authHeader);
    if (!tokenRow) return json({ error: "无效的设备密钥" }, 401);

    const body = await request.json();
    const imageBase64 = typeof body.image_base64 === "string"
      ? body.image_base64.trim()
      : "";
    const mimeType = typeof body.mime_type === "string" && body.mime_type.startsWith("image/")
      ? body.mime_type
      : "image/jpeg";
    if (!imageBase64) return json({ success: false, error: "missing_image_base64" }, 400);
    if (imageBase64.length > 8_000_000) {
      return json({ success: false, error: "image_too_large" }, 413);
    }

    const prompt = typeof body.prompt === "string" && body.prompt.trim()
      ? body.prompt.trim()
      : "只用简洁中文描述这张聊天图片或表情包中的可见文字、人物、物体、情绪和可能含义，不要展开分析过程。";

    const budget = await enforceTokenBudget(env.DB, tokenRow);
    if (!budget.allowed) return json({ success: false, error: "monthly_budget_exhausted" }, 429);

    // Gemini and DeepSeek both accept text and image content through their OpenAI-compatible endpoints.
    const visionSettings = await loadDeviceSettings(env.DB, tokenRow.token);
    const visionConfig = await loadLlmConfig(env.KV, env, visionSettings.model_line);
    const usingGeminiVision = isGeminiModelConfig(visionConfig);
    const visionKey = usingGeminiVision
      ? (visionConfig.apiKeyOverride || env.GEMINI_API_KEY || "")
      : (env.VISION_API_KEY || env.DEEPSEEK_API_KEY || "");
    if (!visionKey) return json({ success: false, error: "vision_not_configured" }, 503);
    const visionBase = usingGeminiVision
      ? visionConfig.baseUrl
      : (env.VISION_API_BASE || env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1")
        .replace(/\/+$/, "");
    const visionModel = usingGeminiVision
      ? visionConfig.modelName
      : (env.VISION_MODEL || "deepseek-flash");
    const upstream = await fetch(visionBase + "/chat/completions", {
      method: "POST",
      headers: buildModelHeaders(
        visionKey,
        usingGeminiVision ? visionConfig : { provider: "deepseek" },
      ),
      body: JSON.stringify(buildModelRequestPayload(
        usingGeminiVision ? visionConfig : { provider: "deepseek" },
        visionModel,
        [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: "data:" + mimeType + ";base64," + imageBase64 },
            },
          ],
        }],
        0.2,
        512,
      )),
    });
    if (!upstream.ok) {
      return json({
        success: false,
        error: "vision_upstream_error",
        status: upstream.status,
      }, 502);
    }
    const result = await upstream.json();
    const description = result.choices?.[0]?.message?.content?.trim() || "";
    await recordTokenUsage(
      env.DB,
      tokenRow.token,
      estimateLlmCost({
        usage: result.usage,
        inputChars: prompt.length + imageBase64.length / 8,
        outputChars: description.length,
      }, env, usingGeminiVision ? visionConfig : { provider: "deepseek" }),
    );
    if (!description) {
      return json({ success: false, error: "vision_empty_response" }, 502);
    }
    return json({
      success: true,
      description,
      provider: usingGeminiVision ? "gemini" : "deepseek",
    });
  }

  // POST /api/config/save — unified config save (device_key required)
  if (path === "/api/config/save" && method === "POST") {
    const body = await request.json();
    const { device_key, action } = body;
    if (!device_key) return json({ error: "缺少 device_key" }, 400);
    const tokenRow = await validateToken(env.DB, "Bearer " + device_key);
    if (!tokenRow) return json({ error: "设备钥匙无效" }, 401);

    // Verify token
    if (action === "verify_token") return json({ success: true, message: "钥匙有效" });

    // Activate persona
    if (action === "activate_persona") {
      const persona = await activatePersonaForToken(
        env.DB,
        tokenRow.token,
        String(body.persona_id || ""),
      );
      if (!persona) return json({ success: false, error: "人设不存在" });
      return json({
        success: true,
        message: "已切换到" + persona.name,
        active_persona_id: persona.id,
        active_persona_name: persona.name,
      });
    }

    // Verify persona
    if (action === "verify_persona") {
      const personaId = body.persona_id || "female";
      const persona = await env.DB.prepare(
        "SELECT id, name FROM personas WHERE id = ?"
      ).bind(personaId).first();
      if (!persona) return json({ success: false, error: "人设不存在" });
      return json({ success: true, message: "人设已验证: " + persona.name });
    }

    // Shared personas are edited only from the dashboard. Older APK versions
    // still call these actions, so reject them instead of silently creating
    // a second device-specific copy.
    if (action === "save_persona_facts") {
      return json({
        success: false,
        error: "共享人设只能在客户看板修改",
        code: "shared_persona_dashboard_only",
      }, 409);
    }

    // Save location
    if (action === "save_location") {
      return json({
        success: false,
        error: "共享人设只能在客户看板修改",
        code: "shared_persona_dashboard_only",
      }, 409);
    }

    // Switch platform
    if (action === "switch_platform") {
      const platform = normalizePlatform(body.platform);
      if (!platform) return json({ success: false, error: "不支持的平台" }, 400);
      const settings = await saveDeviceSetting(
        env.DB,
        tokenRow.token,
        "platform",
        platform,
      );
      return json({
        success: true,
        message: "已切换到 " + platform,
        platform: settings.platform,
      });
    }

    // Toggle hosting / monitoring
    if (action === "toggle_hosting" || action === "toggle_monitor") {
      const enabled = parseBoolean(body.enabled, false);
      const field = action === "toggle_hosting" ? "hosting_enabled" : "monitor_enabled";
      const settings = await saveDeviceSetting(
        env.DB,
        tokenRow.token,
        field,
        enabled,
      );
      return json({
        success: true,
        message: enabled ? "已开启" : "已暂停",
        settings,
      });
    }

    // Switch model line (disguised: a=default, b=backup). Phone + dashboard use this.
    if (action === "switch_line") {
      const line = String(body.line || "").trim().toLowerCase();
      if (line !== "a" && line !== "b") {
        return json({ success: false, error: "line 无效" }, 400);
      }
      await saveDeviceSetting(env.DB, tokenRow.token, "model_line", line);
      invalidateLlmConfigCache(env.KV);
      return json({
        success: true,
        message: line === "b" ? "已切到线路B" : "已切到线路A",
        line,
      });
    }

    // Toggle weather / time
    if (action === "toggle_weather" || action === "toggle_time") {
      const enabled = parseBoolean(body.enabled, true);
      const field = action === "toggle_weather" ? "weather_enabled" : "time_enabled";
      const settings = await saveDeviceSetting(
        env.DB,
        tokenRow.token,
        field,
        enabled,
      );
      return json({ success: true, message: "设置已保存", settings });
    }

    return json({ success: false, error: "未知 action: " + (action || "null") }, 400);
  }

  return null;
}
