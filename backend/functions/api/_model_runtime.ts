export const DEFAULT_LLM_BASE_URL = "https://api.deepseek.com/v1";
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_GEMINI_INPUT_COST_PER_MILLION = 0.75;
export const DEFAULT_GEMINI_OUTPUT_COST_PER_MILLION = 3.75;

const LLM_CONFIG_CACHE_MS = 5 * 60 * 1000;
const llmConfigCache = new WeakMap();

export function normalizeLlmBaseUrl(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^\s]+$/iu.test(text)) return "";
  return text;
}

export function isGeminiModelConfig(modelConfig) {
  return String(modelConfig?.provider || "").trim().toLowerCase() === "gemini";
}

export function buildModelHeaders(apiKey, modelConfig) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + apiKey,
  };
  if (isGeminiModelConfig(modelConfig) && apiKey) {
    headers["X-goog-api-key"] = apiKey;
  }
  return headers;
}

export function buildModelRequestPayload(
  modelConfig,
  modelName,
  messages,
  temperature,
  maxTokens,
  responseFormat = "",
) {
  const payload: Record<string, unknown> = {
    model: modelName,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (!isGeminiModelConfig(modelConfig)) {
    // DeepSeek needs thinking disabled to leave room for the visible reply.
    payload.thinking = { type: "disabled" };
    if (responseFormat) {
      payload.response_format = { type: responseFormat };
      const hasJsonWord = messages.some((message) =>
        String(message?.content || "").toLowerCase().includes("json")
      );
      if (!hasJsonWord) {
        payload.messages = [
          ...messages,
          { role: "system", content: "输出格式必须是 json。" },
        ];
      }
    }
    return payload;
  }
  // Gemini's compatible endpoint rejects the DeepSeek `thinking` field.
  // Gemini 3.x cannot turn thinking off; low keeps latency and token use down.
  if (/^gemini-(?:3(?:[.\-]|$)|flash-latest|flash-lite-latest|omni)/iu.test(String(modelName || ""))) {
    payload.reasoning_effort = "low";
  } else if (/^gemini-2\.5/iu.test(String(modelName || ""))) {
    payload.reasoning_effort = "none";
  }
  return payload;
}

export async function loadLlmConfig(kv, env, lineOverride = "") {
  const cached = llmConfigCache.get(kv);
  const now = Date.now();
  let base = cached && now - cached.cachedAt < LLM_CONFIG_CACHE_MS ? cached.value : null;
  if (!base) {
    const [
      temperatureValue,
      maxTokensValue,
      modelNameValue,
      baseUrlValue,
      providerValue,
      geminiModelValue,
      geminiBaseValue,
    ] = await Promise.all([
      kv.get("llm:temperature"),
      kv.get("llm:max_tokens"),
      kv.get("llm:model"),
      kv.get("llm:base_url"),
      kv.get("llm:provider"),
      kv.get("llm:gemini_model"),
      kv.get("llm:gemini_base_url"),
    ]);
    const parsedTemperature = parseFloat(temperatureValue);
    const parsedMaxTokens = parseInt(maxTokensValue, 10);
    base = {
      temperature: Number.isFinite(parsedTemperature) ? parsedTemperature : 0.8,
      maxTokens: Number.isFinite(parsedMaxTokens) ? parsedMaxTokens : 120,
      legacyProvider: String(providerValue || "").trim().toLowerCase() === "gemini" ? "gemini" : "deepseek",
      deepseekModelName: modelNameValue || "deepseek-v4-flash",
      deepseekBaseUrl: normalizeLlmBaseUrl(baseUrlValue) ||
        normalizeLlmBaseUrl(env?.DEEPSEEK_API_BASE) ||
        DEFAULT_LLM_BASE_URL,
      geminiModelName: String(geminiModelValue || "").trim() ||
        String(env?.GEMINI_MODEL || "").trim() ||
        DEFAULT_GEMINI_MODEL,
      geminiBaseUrl: normalizeLlmBaseUrl(geminiBaseValue) ||
        normalizeLlmBaseUrl(env?.GEMINI_API_BASE) ||
        DEFAULT_GEMINI_BASE_URL,
    };
    llmConfigCache.set(kv, { cachedAt: now, value: base });
  }
  const selected = String(lineOverride || base.legacyProvider || "").trim().toLowerCase();
  const usingGemini = selected === "b" || selected === "gemini";
  return {
    temperature: base.temperature,
    maxTokens: base.maxTokens,
    provider: usingGemini ? "gemini" : "deepseek",
    modelName: usingGemini ? base.geminiModelName : base.deepseekModelName,
    baseUrl: usingGemini ? base.geminiBaseUrl : base.deepseekBaseUrl,
    apiKeyOverride: usingGemini ? String(env?.GEMINI_API_KEY || "") : "",
  };
}

export function invalidateLlmConfigCache(kv) {
  llmConfigCache.delete(kv);
}
