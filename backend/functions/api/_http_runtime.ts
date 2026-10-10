export const DEFAULT_CHAT_LLM_TIMEOUT_MS = 10_000;
export const MAX_CHAT_LLM_TIMEOUT_MS = 60_000;

export function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function resolveChatLlmTimeoutMs(env) {
  const configured = Number(env?.CHAT_LLM_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_CHAT_LLM_TIMEOUT_MS;
  return Math.min(MAX_CHAT_LLM_TIMEOUT_MS, Math.max(10, Math.floor(timeoutMs)));
}

export function createTimeoutSignal(timeoutMs) {
  const boundedTimeoutMs = Math.max(1, Math.floor(Number(timeoutMs) || 1));
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(boundedTimeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => {
    const timeoutError = new Error("llm_timeout");
    timeoutError.name = "TimeoutError";
    controller.abort(timeoutError);
  }, boundedTimeoutMs);
  return controller.signal;
}

export function isAbortError(error) {
  const name = String(error?.name || "");
  return name === "AbortError" || name === "TimeoutError";
}

export function elapsedSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

export async function upstreamErrorDetail(response, maxChars = 600) {
  let body = "";
  try {
    body = await response.text();
  } catch {
    return "";
  }
  const trimmed = String(body || "").trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    const message = parsed?.error?.message || parsed?.message || parsed?.detail || parsed?.error;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, maxChars);
  } catch {
    // Keep the bounded raw body when the upstream does not return JSON.
  }
  return trimmed.slice(0, maxChars);
}

export async function parseJsonBody(request, maxBytes = 64 * 1024) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return { error: "request_too_large", status: 413 };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { error: "request_too_large", status: 413 };
  }
  try {
    return { body: text ? JSON.parse(text) : {} };
  } catch (_) {
    return { error: "invalid_json", status: 400 };
  }
}
