import {
  ASR_MODELS,
  DEFAULT_ASR_MODEL,
  DEFAULT_TTS_MODEL,
  DEFAULT_VOICE_DESIGN_MODEL,
  FishAudioInputError,
  MAX_ASR_UPLOAD_BYTES,
  MAX_MODEL_UPLOAD_BYTES,
  MODEL_SORTS,
  MODEL_VISIBILITY,
  TTS_MODELS,
  booleanValue,
  contentLengthTooLarge,
  enumValue,
  fishFetch,
  inputError,
  isBlobLike,
  json,
  modelId,
  optionalInteger,
  optionalString,
  readJsonObject,
  relayUpstream,
  requireMultipart,
  stringValue,
  uploadName,
  type FetchLike,
  type FishAudioEnv,
  type JsonObject,
} from "./_fish_audio_shared";
import {
  buildFishTtsPayload,
  buildFishVoiceDesignPayload,
} from "./_fish_audio_payloads";

export {
  buildFishTtsPayload,
  buildFishVoiceDesignPayload,
} from "./_fish_audio_payloads";
export {
  FishAudioInputError,
} from "./_fish_audio_shared";
export type {
  FishAudioEnv,
} from "./_fish_audio_shared";

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
