import {
  FishAudioInputError,
  MAX_TTS_CHARS,
  TTS_FORMATS,
  TTS_LATENCY,
  booleanValue,
  enumValue,
  isObject,
  optionalFiniteNumber,
  optionalInteger,
  optionalString,
  referenceIds,
  stringValue,
  type JsonObject,
} from "./_fish_audio_shared";

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
