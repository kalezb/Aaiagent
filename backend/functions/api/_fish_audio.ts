export interface FishAudioEnv {
  FISH_AUDIO_API_KEY?: string;
  FISH_AUDIO_API_BASE?: string;
  FISH_TTS_MODEL?: string;
  FISH_ASR_MODEL?: string;
  FISH_VOICE_DESIGN_MODEL?: string;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type JsonObject = Record<string, unknown>;

const DEFAULT_API_BASE = "https://api.fish.audio";
const DEFAULT_TTS_MODEL = "s2.1-pro";
const DEFAULT_ASR_MODEL = "transcribe-1";
const DEFAULT_VOICE_DESIGN_MODEL = "voice-design-1";
const MAX_TTS_CHARS = 5_000;
const MAX_ASR_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_MODEL_UPLOAD_BYTES = 30 * 1024 * 1024;

const TTS_MODELS = new Set([
  "s1",
  "s2-pro",
  "s2.1-pro",
  "s2.1-pro-free",
  "drama-3-preview",
]);
const TTS_FORMATS = new Set(["wav", "pcm", "mp3", "opus"]);
const TTS_LATENCY = new Set(["low", "normal", "balanced"]);
const ASR_MODELS = new Set(["transcribe-1", "transcribe-1-pro"]);
const MODEL_VISIBILITY = new Set(["private", "unlist", "public"]);
const MODEL_SORTS = new Set(["score", "task_count", "created_at"]);

export class FishAudioInputError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message === code ? code : `${code}: ${message}`);
    this.name = "FishAudioInputError";
    this.code = code;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}

function inputError(error: FishAudioInputError): Response {
  return json({ error: error.code, message: error.message }, 400);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  const normalized = stringValue(value, maxLength);
  return normalized || undefined;
}

function finiteNumber(
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

function optionalFiniteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  code: string,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return finiteNumber(value, minimum, maximum, code);
}

function optionalInteger(
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

function booleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function enumValue<T extends string>(
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

function referenceIds(value: unknown): string | string[] | undefined {
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

function modelId(value: string): string {
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

function isBlobLike(value: unknown): value is Blob {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as Blob).arrayBuffer === "function"
    && typeof (value as Blob).size === "number"
    && typeof (value as Blob).type === "string";
}

function uploadName(value: Blob, fallback: string): string {
  const name = typeof (value as File).name === "string" ? (value as File).name.trim() : "";
  return name.replace(/[^\w.\-]+/gu, "_").slice(0, 160) || fallback;
}

function contentLengthTooLarge(request: Request, maxBytes: number): boolean {
  const length = Number(request.headers.get("Content-Length") || 0);
  return Number.isFinite(length) && length > maxBytes;
}

async function readJsonObject(request: Request, maxBytes = 64 * 1024): Promise<JsonObject> {
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

function requireMultipart(request: Request): void {
  const contentType = String(request.headers.get("Content-Type") || "").toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    throw new FishAudioInputError(
      "unsupported_content_type",
      "Fish Audio ASR and voice cloning require multipart/form-data",
    );
  }
}

function requireFishAudioKey(env: FishAudioEnv): string {
  const key = String(env.FISH_AUDIO_API_KEY || "").trim();
  if (!key) {
    throw new FishAudioInputError(
      "fish_audio_not_configured",
      "FISH_AUDIO_API_KEY is not configured on the AiaAgent backend",
    );
  }
  return key;
}

function fishBaseUrl(env: FishAudioEnv): string {
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

async function fishFetch(
  env: FishAudioEnv,
  path: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", "Bearer " + requireFishAudioKey(env));
  return fetchImpl(fishBaseUrl(env) + path, { ...init, headers });
}

async function relayUpstream(response: Response, fallbackContentType: string): Promise<Response> {
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

export function fishAudioCapabilities(env: FishAudioEnv) {
  return {
    provider: "fish-audio",
    configured: Boolean(String(env.FISH_AUDIO_API_KEY || "").trim()),
    models: {
      tts: String(env.FISH_TTS_MODEL || DEFAULT_TTS_MODEL),
      asr: String(env.FISH_ASR_MODEL || DEFAULT_ASR_MODEL),
      voice_design: String(env.FISH_VOICE_DESIGN_MODEL || DEFAULT_VOICE_DESIGN_MODEL),
    },
    features: {
      text_to_speech: true,
      streaming_audio_response: true,
      speech_to_text: true,
      voice_cloning: true,
      voice_design: true,
      manage_voices: true,
      realtime_websocket_proxy: false,
    },
    endpoints: {
      tts: "/api/voice/tts",
      asr: "/api/voice/asr",
      voice_design: "/api/voice/design",
      create_model: "/api/voice/models",
      list_models: "/api/voice/models",
      model: "/api/voice/models/:id",
    },
  };
}

export function buildFishTtsPayload(input: JsonObject): JsonObject {
  const text = stringValue(input.text, MAX_TTS_CHARS + 1);
  if (!text || text.length > MAX_TTS_CHARS) {
    throw new FishAudioInputError("invalid_text", `text: expected 1..${MAX_TTS_CHARS} characters`);
  }

  const payload: JsonObject = {
    text,
    format: enumValue(input.format, TTS_FORMATS, "mp3", "invalid_format"),
  };
  const referenceId = referenceIds(input.reference_id);
  if (referenceId) payload.reference_id = referenceId;

  const temperature = optionalFiniteNumber(input.temperature, 0, 1, "invalid_temperature");
  if (temperature !== undefined) payload.temperature = temperature;
  const topP = optionalFiniteNumber(input.top_p, 0, 1, "invalid_top_p");
  if (topP !== undefined) payload.top_p = topP;
  const chunkLength = optionalInteger(input.chunk_length, 100, 300, "invalid_chunk_length");
  if (chunkLength !== undefined) payload.chunk_length = chunkLength;
  const sampleRate = optionalInteger(input.sample_rate, 8_000, 48_000, "invalid_sample_rate");
  if (sampleRate !== undefined) payload.sample_rate = sampleRate;
  const mp3Bitrate = optionalInteger(input.mp3_bitrate, 64, 192, "invalid_mp3_bitrate");
  if (mp3Bitrate !== undefined && ![64, 128, 192].includes(mp3Bitrate)) {
    throw new FishAudioInputError("invalid_mp3_bitrate", "mp3_bitrate must be 64, 128, or 192");
  }
  if (mp3Bitrate !== undefined) payload.mp3_bitrate = mp3Bitrate;
  const opusBitrate = optionalInteger(input.opus_bitrate, -1_000, 64_000, "invalid_opus_bitrate");
  if (opusBitrate !== undefined && ![-1_000, 24_000, 32_000, 48_000, 64_000].includes(opusBitrate)) {
    throw new FishAudioInputError("invalid_opus_bitrate", "opus_bitrate is not supported");
  }
  if (opusBitrate !== undefined) payload.opus_bitrate = opusBitrate;
  const maxNewTokens = optionalInteger(input.max_new_tokens, 1, 4_096, "invalid_max_new_tokens");
  if (maxNewTokens !== undefined) payload.max_new_tokens = maxNewTokens;
  const repetitionPenalty = optionalFiniteNumber(
    input.repetition_penalty,
    0.8,
    2,
    "invalid_repetition_penalty",
  );
  if (repetitionPenalty !== undefined) payload.repetition_penalty = repetitionPenalty;
  const minChunkLength = optionalInteger(input.min_chunk_length, 0, 100, "invalid_min_chunk_length");
  if (minChunkLength !== undefined) payload.min_chunk_length = minChunkLength;
  const earlyStopThreshold = optionalFiniteNumber(
    input.early_stop_threshold,
    0,
    1,
    "invalid_early_stop_threshold",
  );
  if (earlyStopThreshold !== undefined) payload.early_stop_threshold = earlyStopThreshold;

  if (input.normalize !== undefined) payload.normalize = booleanValue(input.normalize);
  if (input.condition_on_previous_chunks !== undefined) {
    payload.condition_on_previous_chunks = booleanValue(input.condition_on_previous_chunks, true);
  }
  if (input.latency !== undefined) {
    payload.latency = enumValue(input.latency, TTS_LATENCY, "normal", "invalid_latency");
  }

  if (input.prosody !== undefined && input.prosody !== null) {
    if (!isObject(input.prosody)) throw new FishAudioInputError("invalid_prosody", "prosody must be an object");
    const prosody: JsonObject = {};
    const speed = optionalFiniteNumber(input.prosody.speed, 0.5, 2, "invalid_prosody_speed");
    const volume = optionalFiniteNumber(input.prosody.volume, -20, 20, "invalid_prosody_volume");
    if (speed !== undefined) prosody.speed = speed;
    if (volume !== undefined) prosody.volume = volume;
    if (input.prosody.normalize_loudness !== undefined) {
      prosody.normalize_loudness = booleanValue(input.prosody.normalize_loudness, true);
    }
    if (Object.keys(prosody).length) payload.prosody = prosody;
  }

  if (input.features !== undefined) {
    if (!Array.isArray(input.features) || input.features.length > 16) {
      throw new FishAudioInputError("invalid_features", "features must contain at most 16 values");
    }
    payload.features = input.features
      .map((value) => stringValue(value, 80))
      .filter(Boolean);
  }

  if (input.pronunciation_dictionary !== undefined && input.pronunciation_dictionary !== null) {
    if (!Array.isArray(input.pronunciation_dictionary) || input.pronunciation_dictionary.length > 3) {
      throw new FishAudioInputError(
        "invalid_pronunciation_dictionary",
        "pronunciation_dictionary must contain at most 3 dictionaries",
      );
    }
    if (JSON.stringify(input.pronunciation_dictionary).length > 64 * 1024) {
      throw new FishAudioInputError("invalid_pronunciation_dictionary", "pronunciation dictionary is too large");
    }
    payload.pronunciation_dictionary = input.pronunciation_dictionary;
  }

  return payload;
}

export function buildFishVoiceDesignPayload(input: JsonObject): JsonObject {
  const instruction = stringValue(input.instruction, 2_001);
  if (!instruction || instruction.length > 2_000) {
    throw new FishAudioInputError("invalid_instruction", "instruction: expected 1..2000 characters");
  }
  const payload: JsonObject = {
    instruction,
    n: optionalInteger(input.n, 1, 4, "invalid_candidate_count") ?? 2,
  };
  const referenceText = optionalString(input.reference_text, 151);
  if (referenceText) {
    if (referenceText.length > 150) {
      throw new FishAudioInputError("invalid_reference_text", "reference_text is longer than 150 characters");
    }
    payload.reference_text = referenceText;
  }
  const language = optionalString(input.language, 32);
  if (language) payload.language = language;
  const speed = optionalFiniteNumber(input.speed, Number.EPSILON, 3, "invalid_speed");
  if (speed !== undefined) payload.speed = speed;
  const numStep = optionalInteger(input.num_step, 1, 128, "invalid_num_step");
  if (numStep !== undefined) payload.num_step = numStep;
  const guidanceScale = optionalFiniteNumber(input.guidance_scale, 0, 20, "invalid_guidance_scale");
  if (guidanceScale !== undefined) payload.guidance_scale = guidanceScale;
  const instructGuidanceScale = optionalFiniteNumber(
    input.instruct_guidance_scale,
    0,
    20,
    "invalid_instruct_guidance_scale",
  );
  if (instructGuidanceScale !== undefined) payload.instruct_guidance_scale = instructGuidanceScale;
  const seed = optionalInteger(input.seed, -2_147_483_648, 2_147_483_647, "invalid_seed");
  if (seed !== undefined) payload.seed = seed;
  return payload;
}

async function handleTts(
  request: Request,
  env: FishAudioEnv,
  fetchImpl: FetchLike,
): Promise<Response> {
  const input = await readJsonObject(request);
  const payload = buildFishTtsPayload(input);
  const model = enumValue(
    input.model || env.FISH_TTS_MODEL,
    TTS_MODELS,
    DEFAULT_TTS_MODEL,
    "invalid_tts_model",
  );
  const upstream = await fishFetch(env, "/v1/tts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      model,
    },
    body: JSON.stringify(payload),
  }, fetchImpl);
  return relayUpstream(upstream, "audio/mpeg");
}

async function handleAsr(
  request: Request,
  env: FishAudioEnv,
  fetchImpl: FetchLike,
): Promise<Response> {
  requireMultipart(request);
  if (contentLengthTooLarge(request, MAX_ASR_UPLOAD_BYTES)) {
    throw new FishAudioInputError("request_too_large", "ASR upload is too large");
  }
  const input = await request.formData();
  const audio = input.get("audio");
  if (!isBlobLike(audio) || audio.size < 1) {
    throw new FishAudioInputError("missing_audio", "multipart field audio is required");
  }
  if (audio.size > MAX_ASR_UPLOAD_BYTES) {
    throw new FishAudioInputError("request_too_large", "ASR upload is too large");
  }

  const outbound = new FormData();
  outbound.append("audio", audio, uploadName(audio, "audio.wav"));
  const language = optionalString(input.get("language"), 32);
  if (language) outbound.append("language", language);
  if (input.has("ignore_timestamps")) {
    outbound.append("ignore_timestamps", booleanValue(input.get("ignore_timestamps"), true) ? "true" : "false");
  }
  const model = enumValue(
    input.get("model") || env.FISH_ASR_MODEL,
    ASR_MODELS,
    DEFAULT_ASR_MODEL,
    "invalid_asr_model",
  );

  const upstream = await fishFetch(env, "/v1/asr", {
    method: "POST",
    headers: { model },
    body: outbound,
  }, fetchImpl);
  return relayUpstream(upstream, "application/json; charset=utf-8");
}

async function handleVoiceDesign(
  request: Request,
  env: FishAudioEnv,
  fetchImpl: FetchLike,
): Promise<Response> {
  const payload = buildFishVoiceDesignPayload(await readJsonObject(request));
  const model = stringValue(
    env.FISH_VOICE_DESIGN_MODEL || DEFAULT_VOICE_DESIGN_MODEL,
    80,
  );
  if (model !== DEFAULT_VOICE_DESIGN_MODEL) {
    throw new FishAudioInputError(
      "invalid_voice_design_model",
      `voice design requires model ${DEFAULT_VOICE_DESIGN_MODEL}`,
    );
  }
  const upstream = await fishFetch(env, "/v1/voice-design", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      model,
    },
    body: JSON.stringify(payload),
  }, fetchImpl);
  return relayUpstream(upstream, "application/json; charset=utf-8");
}

async function handleCreateModel(
  request: Request,
  env: FishAudioEnv,
  fetchImpl: FetchLike,
): Promise<Response> {
  requireMultipart(request);
  if (contentLengthTooLarge(request, MAX_MODEL_UPLOAD_BYTES)) {
    throw new FishAudioInputError("request_too_large", "voice model upload is too large");
  }
  const input = await request.formData();
  const title = stringValue(input.get("title"), 120);
  if (!title) throw new FishAudioInputError("missing_title", "multipart field title is required");
  const voices = input.getAll("voices").filter(isBlobLike);
  if (!voices.length || voices.length > 20) {
    throw new FishAudioInputError("invalid_voices", "voices: expected 1..20 audio files");
  }
  const totalBytes = voices.reduce((total, voice) => total + voice.size, 0);
  if (voices.some((voice) => voice.size < 1) || totalBytes > MAX_MODEL_UPLOAD_BYTES) {
    throw new FishAudioInputError("request_too_large", "voice model upload is too large");
  }

  const outbound = new FormData();
  outbound.append("type", "tts");
  outbound.append("train_mode", "fast");
  outbound.append("title", title);
  outbound.append("visibility", enumValue(
    input.get("visibility"),
    MODEL_VISIBILITY,
    "private",
    "invalid_visibility",
  ));
  const description = optionalString(input.get("description"), 1_000);
  if (description) outbound.append("description", description);
  const tags = optionalString(input.get("tags"), 500);
  if (tags) outbound.append("tags", tags);
  if (input.has("enhance_audio_quality")) {
    outbound.append("enhance_audio_quality", booleanValue(input.get("enhance_audio_quality"), true) ? "true" : "false");
  }
  if (input.has("generate_sample")) {
    outbound.append("generate_sample", booleanValue(input.get("generate_sample")) ? "true" : "false");
  }
  voices.forEach((voice, index) => {
    outbound.append("voices", voice, uploadName(voice, `voice-${index + 1}.wav`));
  });
  input.getAll("texts")
    .map((value) => stringValue(value, 1_000))
    .filter(Boolean)
    .slice(0, 20)
    .forEach((text) => outbound.append("texts", text));

  const upstream = await fishFetch(env, "/model", {
    method: "POST",
    body: outbound,
  }, fetchImpl);
  return relayUpstream(upstream, "application/json; charset=utf-8");
}

function modelListQuery(url: URL): URLSearchParams {
  const allowed = new Set([
    "page_size",
    "page_number",
    "title",
    "tag",
    "self",
    "author_id",
    "language",
    "title_language",
    "licensed",
    "sort_by",
  ]);
  const query = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (allowed.has(key)) query.append(key, value.slice(0, 500));
  }
  const pageSize = optionalInteger(query.get("page_size") ?? 10, 1, 100, "invalid_page_size") ?? 10;
  const pageNumber = optionalInteger(query.get("page_number") ?? 1, 1, 100_000, "invalid_page_number") ?? 1;
  query.set("page_size", String(pageSize));
  query.set("page_number", String(pageNumber));
  if (!query.has("self")) query.set("self", "true");
  const sortBy = query.get("sort_by");
  if (sortBy && !MODEL_SORTS.has(sortBy)) {
    throw new FishAudioInputError("invalid_sort_by", "sort_by is not supported");
  }
  return query;
}

async function handleListModels(
  request: Request,
  env: FishAudioEnv,
  fetchImpl: FetchLike,
): Promise<Response> {
  const query = modelListQuery(new URL(request.url));
  const upstream = await fishFetch(env, "/model?" + query.toString(), {
    method: "GET",
  }, fetchImpl);
  return relayUpstream(upstream, "application/json; charset=utf-8");
}

async function handleGetModel(
  env: FishAudioEnv,
  id: string,
  fetchImpl: FetchLike,
): Promise<Response> {
  const upstream = await fishFetch(env, "/model/" + encodeURIComponent(modelId(id)), {
    method: "GET",
  }, fetchImpl);
  return relayUpstream(upstream, "application/json; charset=utf-8");
}

async function handleUpdateModel(
  request: Request,
  env: FishAudioEnv,
  id: string,
  fetchImpl: FetchLike,
): Promise<Response> {
  const input = await readJsonObject(request);
  const payload: JsonObject = {};
  const title = optionalString(input.title, 120);
  if (title) payload.title = title;
  if (input.description !== undefined) payload.description = stringValue(input.description, 1_000);
  if (input.visibility !== undefined) {
    payload.visibility = enumValue(input.visibility, MODEL_VISIBILITY, "private", "invalid_visibility");
  }
  if (input.tags !== undefined) {
    if (Array.isArray(input.tags)) {
      payload.tags = input.tags.map((value) => stringValue(value, 80)).filter(Boolean).slice(0, 20);
    } else {
      payload.tags = stringValue(input.tags, 500);
    }
  }
  if (!Object.keys(payload).length) {
    throw new FishAudioInputError("empty_update", "at least one editable model field is required");
  }
  const upstream = await fishFetch(env, "/model/" + encodeURIComponent(modelId(id)), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, fetchImpl);
  return relayUpstream(upstream, "application/json; charset=utf-8");
}

async function handleDeleteModel(
  env: FishAudioEnv,
  id: string,
  fetchImpl: FetchLike,
): Promise<Response> {
  const upstream = await fishFetch(env, "/model/" + encodeURIComponent(modelId(id)), {
    method: "DELETE",
  }, fetchImpl);
  return relayUpstream(upstream, "application/json; charset=utf-8");
}

export async function handleFishAudioRequest(
  request: Request,
  env: FishAudioEnv,
  path: string,
  method: string,
  fetchImpl: FetchLike = fetch,
): Promise<Response | null> {
  if (!path.startsWith("/api/voice/")) return null;

  try {
    if (path === "/api/voice/capabilities" && method === "GET") {
      return json(fishAudioCapabilities(env));
    }
    if (path === "/api/voice/tts" && method === "POST") {
      return await handleTts(request, env, fetchImpl);
    }
    if (path === "/api/voice/asr" && method === "POST") {
      return await handleAsr(request, env, fetchImpl);
    }
    if (path === "/api/voice/design" && method === "POST") {
      return await handleVoiceDesign(request, env, fetchImpl);
    }
    if (path === "/api/voice/models" && method === "POST") {
      return await handleCreateModel(request, env, fetchImpl);
    }
    if (path === "/api/voice/models" && method === "GET") {
      return await handleListModels(request, env, fetchImpl);
    }

    const modelMatch = path.match(/^\/api\/voice\/models\/([^/]+)$/u);
    if (modelMatch) {
      if (method === "GET") return await handleGetModel(env, modelMatch[1], fetchImpl);
      if (method === "PATCH") return await handleUpdateModel(request, env, modelMatch[1], fetchImpl);
      if (method === "DELETE") return await handleDeleteModel(env, modelMatch[1], fetchImpl);
    }

    return json({ error: "not_found" }, 404);
  } catch (error) {
    if (error instanceof FishAudioInputError) {
      return error.code === "fish_audio_not_configured"
        ? json({ error: error.code, message: error.message }, 503)
        : inputError(error);
    }
    console.error(
      "Fish Audio proxy failed",
      error instanceof Error ? error.stack || error.message : String(error),
    );
    return json({ error: "fish_audio_proxy_failed" }, 502);
  }
}
