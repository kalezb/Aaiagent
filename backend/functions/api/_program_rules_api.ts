import { isDashboardAuthorized } from "./_access_runtime";
import { json } from "./_http_runtime";
import {
  DEFAULT_PROGRAM_RULES,
  PROGRAM_RULES_KV_KEY,
  isPlatformNoticeContent,
  isUntranscribedVoiceMessage,
  loadProgramRules,
  normalizeProgramRules,
  saveProgramRules,
} from "./_program_rules";
import { translateStickerContent } from "./_reply_policy";

export async function handleProgramRulesRequest({ request, env, path, method }) {
  // GET /api/program-rules - editable rules that are executed by code.
  if (path === "/api/program-rules" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const stored = await env.KV.get(PROGRAM_RULES_KV_KEY, "json");
    return json({
      rules: normalizeProgramRules(stored || {}),
      defaults: DEFAULT_PROGRAM_RULES,
      customized: Boolean(stored),
    });
  }

  // PUT /api/program-rules - save code-backed rules.
  if (path === "/api/program-rules" && method === "PUT") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const rules = await saveProgramRules(env.KV, body?.rules || body || {});
    return json({ success: true, rules });
  }

  // POST /api/program-rules/test - show exactly what the code would do.
  if (path === "/api/program-rules/test" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const content = String(body.content || "").trim().slice(0, 1000);
    if (!content) return json({ error: "请先输入一条测试内容" }, 400);
    const rules = body.rules
      ? normalizeProgramRules(body.rules)
      : await loadProgramRules(env.KV);
    const voice = isUntranscribedVoiceMessage({ role: "user", content, transcript: "" });
    const meanings = rules.sticker.enabled ? rules.sticker.meanings : null;
    return json({
      content,
      platform_notice: isPlatformNoticeContent(content, rules),
      untranscribed_voice: voice,
      untranscribed_voice_action: voice
        ? (rules.untranscribedVoice.enabled ? rules.untranscribedVoice.mode : "disabled")
        : "",
      transformed_content: translateStickerContent(content, meanings),
    });
  }

  return null;
}
