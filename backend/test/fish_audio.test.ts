import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/[[route]]";
import {
  buildFishTtsPayload,
  buildFishVoiceDesignPayload,
  fishAudioCapabilities,
} from "../functions/api/_fish_audio";

class MockAuthDb {
  prepare(sql: string) {
    return {
      bind: (...params: unknown[]) => ({
        first: async () => {
          if (sql.includes("FROM tokens") && params[0] === "test-token") {
            return {
              token: "test-token",
              is_active: 1,
              monthly_limit: 100,
              spent: 0,
              spent_month: "",
              active_persona_id: "female",
            };
          }
          return null;
        },
      }),
    };
  }
}

function authHeaders(extra: Record<string, string> = {}) {
  return {
    Authorization: "Bearer test-token",
    ...extra,
  };
}

function jsonRequest(path: string, method: string, body: unknown) {
  return new Request("https://example.com" + path, {
    method,
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Fish Audio integration", () => {
  it("advertises capabilities without exposing the API key", () => {
    expect(fishAudioCapabilities({
      FISH_AUDIO_API_KEY: "fish-secret",
      FISH_TTS_MODEL: "s2.1-pro-free",
    })).toMatchObject({
      provider: "fish-audio",
      configured: true,
      models: {
        tts: "s2.1-pro-free",
        asr: "transcribe-1",
        voice_design: "voice-design-1",
      },
      features: {
        text_to_speech: true,
        streaming_audio_response: true,
        speech_to_text: true,
        voice_cloning: true,
        realtime_websocket_proxy: false,
      },
    });

    expect(JSON.stringify(fishAudioCapabilities({ FISH_AUDIO_API_KEY: "fish-secret" })))
      .not.toContain("fish-secret");
  });

  it("builds a documented TTS request and rejects unbounded input", () => {
    expect(buildFishTtsPayload({
      text: "你好，我是 AiaAgent。",
      reference_id: "voice-model-id",
      model: "s2.1-pro",
      format: "mp3",
      latency: "balanced",
      prosody: { speed: 1.1, normalize_loudness: true },
      temperature: 0.7,
    })).toEqual({
      text: "你好，我是 AiaAgent。",
      format: "mp3",
      reference_id: "voice-model-id",
      temperature: 0.7,
      latency: "balanced",
      prosody: { speed: 1.1, normalize_loudness: true },
    });

    expect(() => buildFishTtsPayload({ text: "" })).toThrow("invalid_text");
    expect(() => buildFishTtsPayload({
      text: "hello",
      reference_id: ["a", "b", "c", "d", "e"],
    })).toThrow("invalid_reference_id");
    expect(() => buildFishTtsPayload({
      text: "hello",
      prosody: { speed: 3 },
    })).toThrow("invalid_prosody_speed");
  });

  it("validates voice-design fields", () => {
    expect(buildFishVoiceDesignPayload({
      instruction: "温和、清晰的中文女声",
      reference_text: "欢迎使用 Fish Audio。",
      language: "zh",
      n: 2,
      seed: 42,
    })).toEqual({
      instruction: "温和、清晰的中文女声",
      n: 2,
      reference_text: "欢迎使用 Fish Audio。",
      language: "zh",
      seed: 42,
    });
    expect(() => buildFishVoiceDesignPayload({ instruction: "" })).toThrow("invalid_instruction");
    expect(() => buildFishVoiceDesignPayload({
      instruction: "warm voice",
      n: 5,
    })).toThrow("invalid_candidate_count");
  });

  it("streams TTS audio through the authenticated AiaAgent route", async () => {
    const audio = new Uint8Array([73, 68, 51, 4, 5, 6]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(audio, {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: jsonRequest("/api/voice/tts", "POST", {
        text: "你好",
        model: "s2.1-pro-free",
        format: "mp3",
      }),
      env: {
        DB: new MockAuthDb(),
        FISH_AUDIO_API_KEY: "fish-key",
      },
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(audio));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.fish.audio/v1/tts");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer fish-key");
    expect(headers.get("model")).toBe("s2.1-pro-free");
    expect(JSON.parse(String(init.body))).toMatchObject({
      text: "你好",
      format: "mp3",
    });
  });

  it("forwards multipart ASR and asks for timestamps", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: "你好",
      duration: 1.2,
      segments: [{ text: "你好", start: 0, end: 1.2 }],
      language_code: "zh",
      language: "Chinese",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }), "voice.wav");
    form.append("language", "zh");
    form.append("ignore_timestamps", "false");
    form.append("model", "transcribe-1-pro");

    const response = await onRequest({
      request: new Request("https://example.com/api/voice/asr", {
        method: "POST",
        headers: authHeaders(),
        body: form,
      }),
      env: {
        DB: new MockAuthDb(),
        FISH_AUDIO_API_KEY: "fish-key",
      },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      text: "你好",
      language_code: "zh",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.fish.audio/v1/asr");
    expect(new Headers(init.headers).get("model")).toBe("transcribe-1-pro");
    expect(init.body).toBeInstanceOf(FormData);
    const outbound = init.body as FormData;
    expect(outbound.get("ignore_timestamps")).toBe("false");
    expect((outbound.get("audio") as File).name).toBe("voice.wav");
  });

  it("creates a fast voice model and lists only owned models by default", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ _id: "model-1", state: "created" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        total: 1,
        items: [{ _id: "model-1", title: "星暮音色" }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const createForm = new FormData();
    createForm.append("title", "星暮音色");
    createForm.append("visibility", "private");
    createForm.append("texts", "这是参考音频的准确文字。");
    createForm.append("voices", new Blob([new Uint8Array([7, 8, 9])], { type: "audio/wav" }), "sample.wav");

    const created = await onRequest({
      request: new Request("https://example.com/api/voice/models", {
        method: "POST",
        headers: authHeaders(),
        body: createForm,
      }),
      env: {
        DB: new MockAuthDb(),
        FISH_AUDIO_API_KEY: "fish-key",
      },
    } as never);
    expect(created.status).toBe(201);

    const [createUrl, createInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(createUrl).toBe("https://api.fish.audio/model");
    const outbound = createInit.body as FormData;
    expect(outbound.get("type")).toBe("tts");
    expect(outbound.get("train_mode")).toBe("fast");
    expect(outbound.get("title")).toBe("星暮音色");
    expect((outbound.get("voices") as File).name).toBe("sample.wav");

    const listed = await onRequest({
      request: new Request("https://example.com/api/voice/models?page_size=5&sort_by=created_at", {
        headers: authHeaders(),
      }),
      env: {
        DB: new MockAuthDb(),
        FISH_AUDIO_API_KEY: "fish-key",
      },
    } as never);
    expect(listed.status).toBe(200);

    const [listUrl] = fetchMock.mock.calls[1] as [string];
    expect(listUrl).toContain("page_size=5");
    expect(listUrl).toContain("sort_by=created_at");
    expect(listUrl).toContain("self=true");
  });

  it("updates and deletes a voice model through the proxy", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const updated = await onRequest({
      request: jsonRequest("/api/voice/models/model-1", "PATCH", {
        title: "新名称",
        tags: ["客服", "女声"],
      }),
      env: {
        DB: new MockAuthDb(),
        FISH_AUDIO_API_KEY: "fish-key",
      },
    } as never);
    expect(updated.status).toBe(204);

    const deleted = await onRequest({
      request: new Request("https://example.com/api/voice/models/model-1", {
        method: "DELETE",
        headers: authHeaders(),
      }),
      env: {
        DB: new MockAuthDb(),
        FISH_AUDIO_API_KEY: "fish-key",
      },
    } as never);
    expect(deleted.status).toBe(204);

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.fish.audio/model/model-1");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PATCH");
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("DELETE");
  });

  it("fails closed without a Fish API key and maps upstream auth failures", async () => {
    const unconfiguredFetch = vi.fn();
    vi.stubGlobal("fetch", unconfiguredFetch);
    const unconfigured = await onRequest({
      request: jsonRequest("/api/voice/tts", "POST", { text: "hello" }),
      env: { DB: new MockAuthDb() },
    } as never);
    expect(unconfigured.status).toBe(503);
    await expect(unconfigured.json()).resolves.toMatchObject({
      error: "fish_audio_not_configured",
    });
    expect(unconfiguredFetch).not.toHaveBeenCalled();

    const upstreamFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 401,
      message: "invalid api key",
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", upstreamFetch);
    const upstreamFailure = await onRequest({
      request: jsonRequest("/api/voice/tts", "POST", { text: "hello" }),
      env: {
        DB: new MockAuthDb(),
        FISH_AUDIO_API_KEY: "bad-key",
      },
    } as never);
    expect(upstreamFailure.status).toBe(502);
    await expect(upstreamFailure.json()).resolves.toMatchObject({
      error: "fish_audio_upstream_error",
      upstream_status: 401,
      detail: "invalid api key",
    });
  });
});
