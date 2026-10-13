export interface FishAudioEnv {
  FISH_AUDIO_API_KEY?: string;
  FISH_AUDIO_API_BASE?: string;
  FISH_TTS_MODEL?: string;
  FISH_ASR_MODEL?: string;
  FISH_VOICE_DESIGN_MODEL?: string;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type JsonObject = Record<string, unknown>;

export const DEFAULT_API_BASE = "https://api.fish.audio";
export const DEFAULT_TTS_MODEL = "s2.1-pro";
export const DEFAULT_ASR_MODEL = "transcribe-1";
export const DEFAULT_VOICE_DESIGN_MODEL = "voice-design-1";
export const MAX_TTS_CHARS = 5_000;
export const MAX_ASR_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_MODEL_UPLOAD_BYTES = 30 * 1024 * 1024;

export const TTS_MODELS = new Set([
  "s1",
  "s2-pro",
  "s2.1-pro",
  "s2.1-pro-free",
  "drama-3-preview",
]);
export const TTS_FORMATS = new Set(["wav", "pcm", "mp3", "opus"]);
export const TTS_LATENCY = new Set(["low", "normal", "balanced"]);
export const ASR_MODELS = new Set(["transcribe-1", "transcribe-1-pro"]);
export const MODEL_VISIBILITY = new Set(["private", "unlist", "public"]);
export const MODEL_SORTS = new Set(["score", "task_count", "created_at"]);

export class FishAudioInputError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message === code ? code : `${code}: ${message}`);
    this.name = "FishAudioInputError";
    this.code = code;
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

export function inputError(error: FishAudioInputError): Response {
  return json({ error: error.code, message: error.message }, 400);
}

export function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stringValue(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function optionalString(value: unknown, maxLength: number): string | undefined {
  const normalized = stringValue(value, maxLength);
  return normalized || undefined;
}

export function finiteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new FishAudioInputError(code, `${code}: expected ${minimum}..${maximum}`);
  }
  return number;
}

export function optionalFiniteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return finiteNumber(value, minimum, maximum, code);
}

export function optionalInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
): number | undefined {
  const number = optionalFiniteNumber(value, minimum, maximum, code);
  if (number === undefined) return undefined;
  if (!Number.isInteger(number)) throw new FishAudioInputError(code, `${code}: expected integer`);
  return number;
}

export function booleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function enumValue<T extends string>(
  value: unknown,
  allowed: Set<T>,
  fallback: T,
  code: string,
): T {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase() as T;
  if (!allowed.has(normalized)) throw new FishAudioInputError(code, `${code}: unsupported value`);
  return normalized;
}

export function referenceIds(value: unknown): string | string[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const values = Array.isArray(value) ? value : [value];
  if (values.length < 1 || values.length > 4) {
    throw new FishAudioInputError("invalid_reference_id", "reference_id: expected 1..4 values");
  }
  const ids = values.map((item) => stringValue(item, 200));
  if (ids.some((id) => !/^[A-Za-z0-9._:-]{1,200}$/u.test(id))) {
    throw new FishAudioInputError("invalid_reference_id", "reference_id contains invalid characters");
  }
  return Array.isArray(value) ? ids : ids[0];
}

export function modelId(value: string): string {
  let decoded = "";
  try {
    decoded = decodeURIComponent(value).trim();
  } catch {
    throw new FishAudioInputError("invalid_model_id", "model id is not valid URL encoding");
  }
  if (!/^[A-Za-z0-9._:-]{1,200}$/u.test(decoded)) {
    throw new FishAudioInputError("invalid_model_id", "model id contains invalid characters");
  }
  return decoded;
}

export function isBlobLike(value: unknown): value is Blob {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as Blob).arrayBuffer === "function"
    && typeof (value as Blob).size === "number"
    && typeof (value as Blob).type === "string";
}

export function uploadName(value: Blob, fallback: string): string {
  const name = typeof (value as File).name === "string" ? (value as File).name.trim() : "";
  return name.replace(/[^\w.\-]+/gu, "_").slice(0, 160) || fallback;
}

export function contentLengthTooLarge(request: Request, maxBytes: number): boolean {
  const length = Number(request.headers.get("Content-Length") || 0);
  return Number.isFinite(length) && length > maxBytes;
}

export async function readJsonObject(request: Request, maxBytes = 64 * 1024): Promise<JsonObject> {
  if (contentLengthTooLarge(request, maxBytes)) {
    throw new FishAudioInputError("request_too_large", "request body is too large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new FishAudioInputError("request_too_large", "request body is too large");
  }
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw new FishAudioInputError("invalid_json", "request body must be valid JSON");
  }
  if (!isObject(value)) throw new FishAudioInputError("invalid_json", "request body must be a JSON object");
  return value;
}

export function requireMultipart(request: Request): void {
  const contentType = String(request.headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    throw new FishAudioInputError(
      "unsupported_content_type",
      "Fish Audio ASR and voice cloning require multipart/form-data",
    );
  }
}

export function requireFishAudioKey(env: FishAudioEnv): string {
  const key = String(env.FISH_AUDIO_API_KEY || "").trim();
  if (!key) {
    throw new FishAudioInputError(
      "fish_audio_not_configured",
      "FISH_AUDIO_API_KEY is not configured on the AiaAgent backend",
    );
  }
  return key;
}

export function fishBaseUrl(env: FishAudioEnv): string {
  const raw = String(env.FISH_AUDIO_API_BASE || DEFAULT_API_BASE).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FishAudioInputError("invalid_fish_audio_base", "FISH_AUDIO_API_BASE is not a valid URL");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new FishAudioInputError("invalid_fish_audio_base", "FISH_AUDIO_API_BASE must use HTTPS");
  }
  return url.toString().replace(/\/+$/u, "");
}

export async function fishFetch(
  env: FishAudioEnv,
  path: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", "Bearer " + requireFishAudioKey(env));
  return fetchImpl(fishBaseUrl(env) + path, { ...init, headers });
}

export async function relayUpstream(response: Response, fallbackContentType: string): Promise<Response> {
  const contentType = response.headers.get("Content-Type") || fallbackContentType;
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  if (contentType) headers.set("Content-Type", contentType);
  const contentDisposition = response.headers.get("Content-Disposition");
  if (contentDisposition) headers.set("Content-Disposition", contentDisposition);

  if (response.status === 204 || response.status === 205) {
    return new Response(null, { status: response.status, headers });
  }

  if (!response.ok) {
    const body = await response.text();
    let detail = body.slice(0, 500);
    try {
      const parsed = JSON.parse(body);
      detail = String(parsed?.message || parsed?.detail || parsed?.error || detail).slice(0, 500);
    } catch {
      // Keep the bounded raw body when Fish Audio does not return JSON.
    }
    const status = [401, 402, 403].includes(response.status) ? 502 : response.status;
    return json({
      error: "fish_audio_upstream_error",
      upstream_status: response.status,
      detail: detail || "Fish Audio request failed",
    }, status);
  }

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
