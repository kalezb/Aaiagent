import { afterEach, describe, expect, it, vi } from "vitest";
import { getWeather } from "../functions/api/_weather_runtime";

describe("weather runtime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses a fresh cache without making another network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const kv = {
      get: vi.fn(async () => ({
        city: "重庆",
        condition: "多云",
        temp: 26,
        updated_at: Math.floor(Date.now() / 1000),
      })),
      put: vi.fn(),
    };

    await expect(getWeather("重庆", kv, "key")).resolves.toEqual({
      condition: "多云",
      temp: 26,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads and caches current weather when the cache is stale", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ location: [{ id: "101040100" }] }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ now: { text: "小雨", temp: "18" } }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(),
    };

    await expect(getWeather("重庆", kv, "secret")).resolves.toEqual({
      condition: "小雨",
      temp: 18,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(kv.put).toHaveBeenCalledWith(
      "weather:cache",
      expect.stringContaining("\"condition\":\"小雨\""),
    );
  });

  it("keeps the existing calm fallback when the weather service fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(),
    };

    await expect(getWeather("重庆", kv, "key")).resolves.toEqual({
      condition: "晴",
      temp: 20,
    });
  });
});
