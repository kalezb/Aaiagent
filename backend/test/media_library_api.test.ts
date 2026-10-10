import { describe, expect, it } from "vitest";
import { handleMediaLibraryRequest } from "../functions/api/_media_library_api";

function authorizedRequest(url = "https://example.com/api/media-library") {
  return new Request(url, {
    headers: { "X-Dashboard-Password": "dashboard-secret" },
  });
}

describe("media library API", () => {
  it("leaves unrelated requests for the main route", async () => {
    const response = await handleMediaLibraryRequest({
      request: authorizedRequest("https://example.com/api/chat"),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      path: "/api/chat",
      method: "POST",
    });
    expect(response).toBeNull();
  });

  it("keeps media library access behind the dashboard password", async () => {
    const response = await handleMediaLibraryRequest({
      request: new Request("https://example.com/api/media-library"),
      env: { DASHBOARD_PASSWORD: "dashboard-secret" },
      path: "/api/media-library",
      method: "GET",
    });
    expect(response?.status).toBe(401);
  });

  it("returns an authenticated image stored in KV", async () => {
    const stored = new Uint8Array([1, 2, 3]).buffer;
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            id: "media_1",
            file_name: "test.png",
            content_type: "image/png",
            storage_key: "dashboard-media:media_1",
          }),
        }),
      }),
    };
    const response = await handleMediaLibraryRequest({
      request: authorizedRequest("https://example.com/api/media-library/assets/media_1"),
      env: {
        DASHBOARD_PASSWORD: "dashboard-secret",
        DB: db,
        KV: { get: async () => stored },
      },
      path: "/api/media-library/assets/media_1",
      method: "GET",
    });

    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toBe("image/png");
    expect(Array.from(new Uint8Array(await response!.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it("lists every asset inside one group", async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => sql.includes("FROM media_groups")
            ? { id: "group_1", name: "周末照" }
            : null,
          all: async () => sql.includes("FROM media_assets")
            ? {
              results: [
                {
                  id: "media_1",
                  file_name: "one.jpg",
                  content_type: "image/jpeg",
                  source_url: "",
                  created_at: 1,
                },
              ],
            }
            : { results: [] },
        }),
      }),
    };
    const response = await handleMediaLibraryRequest({
      request: authorizedRequest("https://example.com/api/media-library/groups/group_1/assets"),
      env: { DASHBOARD_PASSWORD: "dashboard-secret", DB: db },
      path: "/api/media-library/groups/group_1/assets",
      method: "GET",
    });
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      group: { id: "group_1", name: "周末照" },
      assets: [{ id: "media_1", view_url: "/media-library/assets/media_1" }],
    });
  });

  it("copies one asset into another group without moving the original", async () => {
    const inserted: unknown[][] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => ({
          first: async () => {
            if (sql.includes("FROM media_assets")) {
              return {
                id: "media_1",
                group_id: "group_1",
                file_name: "one.jpg",
                content_type: "image/jpeg",
                source_url: "",
                storage_key: "dashboard-media:media_1",
              };
            }
            if (sql.includes("FROM media_groups")) return { id: params[0] };
            return null;
          },
          run: async () => {
            if (sql.includes("INSERT INTO media_assets")) inserted.push(params);
            return { success: true };
          },
        }),
      }),
    };
    const request = new Request("https://example.com/api/media-library/copy-asset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dashboard-Password": "dashboard-secret",
      },
      body: JSON.stringify({ asset_id: "media_1", target_group_id: "group_2" }),
    });
    const response = await handleMediaLibraryRequest({
      request,
      env: { DASHBOARD_PASSWORD: "dashboard-secret", DB: db },
      path: "/api/media-library/copy-asset",
      method: "POST",
    });
    expect(response?.status).toBe(201);
    expect(inserted).toHaveLength(1);
    expect(inserted[0][0]).not.toBe("media_1");
    expect(inserted[0][1]).toBe("group_2");
  });
});
