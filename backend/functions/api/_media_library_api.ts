import { isDashboardAuthorized } from "./_access_runtime";
import { normalizePlatform } from "./_chat_input";
import { decodeDashboardImage } from "./_dashboard_media_input";
import { json, parseJsonBody } from "./_http_runtime";
import { serveMediaImage } from "./_media_image_response";

export async function handleMediaLibraryRequest({ request, env, path, method }) {
  // GET /api/media-library/assets/:id - dashboard-authenticated image preview
  if (path.startsWith("/api/media-library/assets/") && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    let assetId = "";
    try {
      assetId = decodeURIComponent(path.slice("/api/media-library/assets/".length));
    } catch (_) {
      return json({ error: "图片编号无效" }, 400);
    }
    if (!/^[A-Za-z0-9._:-]{1,160}$/u.test(assetId)) return json({ error: "图片编号无效" }, 400);
    const asset = await env.DB.prepare(
      "SELECT id, file_name, content_type, source_url, storage_key FROM media_assets WHERE id = ? LIMIT 1"
    ).bind(assetId).first();
    return serveMediaImage({
      env,
      asset,
      assetId,
      options: {
        missingError: "图片不存在",
        missingStorageError: "图片不存在",
        maxProxyBytes: 12 * 1024 * 1024,
        proxyTooLargeError: "图片过大",
        checkProxyContentLength: false,
        preferUpstreamContentType: false,
        includeCors: false,
      },
    });
  }

  // GET /api/media-library - dashboard gallery page: groups + counts + samples
  if (path === "/api/media-library" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const { results } = await env.DB.prepare(
      "SELECT id, name, topic_key, trigger_keywords, persona_id, platform, is_active FROM media_groups ORDER BY id"
    ).all();
    const groups = [];
    for (const g of results || []) {
      const cnt = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM media_assets WHERE group_id = ?"
      ).bind(g.id).first();
      const samples = await env.DB.prepare(
        "SELECT id, file_name, content_type, source_url, storage_key FROM media_assets WHERE group_id = ? ORDER BY created_at DESC, id DESC LIMIT 12"
      ).bind(g.id).all();
      groups.push({
        id: g.id,
        name: g.name,
        topic_key: g.topic_key,
        trigger_keywords: g.trigger_keywords,
        persona_id: g.persona_id,
        platform: g.platform,
        is_active: g.is_active !== 0,
        asset_count: (cnt && cnt.n) || 0,
        samples: ((samples && samples.results) || []).map((asset) => ({
          id: asset.id,
          file_name: asset.file_name,
          content_type: asset.content_type,
          source_url: asset.source_url || "",
          view_url: "/media-library/assets/" + encodeURIComponent(asset.id),
        })),
      });
    }
    return json({ groups });
  }

  // POST /api/media-library/groups - create or update one gallery group
  if (path === "/api/media-library/groups" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const requestedId = String(body.id || "").trim();
    const name = String(body.name || "").trim().slice(0, 80);
    if (!name) return json({ error: "分组名字不能为空" }, 400);
    const id = requestedId || ("custom_" + crypto.randomUUID().replace(/-/gu, "").slice(0, 16));
    if (!/^[A-Za-z0-9_-]{1,80}$/u.test(id)) {
      return json({ error: "分组编号只能用字母、数字、横线或下划线" }, 400);
    }
    const topicKey = String(body.topic_key || id).trim().slice(0, 80);
    const triggerKeywords = String(body.trigger_keywords || "").trim().slice(0, 1000);
    const personaId = String(body.persona_id || "").trim().slice(0, 80);
    const platform = normalizePlatform(body.platform);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT INTO media_groups (id, name, topic_key, trigger_keywords, persona_id, platform, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?) " +
      "ON CONFLICT(id) DO UPDATE SET name = excluded.name, topic_key = excluded.topic_key, trigger_keywords = excluded.trigger_keywords, persona_id = excluded.persona_id, platform = excluded.platform"
    ).bind(id, name, topicKey, triggerKeywords, personaId, platform, now).run();
    return json({
      success: true,
      group: {
        id,
        name,
        topic_key: topicKey,
        trigger_keywords: triggerKeywords,
        persona_id: personaId,
        platform,
        is_active: true,
      },
    });
  }

  // POST /api/media-library/upload - store one dashboard image privately
  if (path === "/api/media-library/upload" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const parsedBody = await parseJsonBody(request, 16 * 1024 * 1024);
    if (parsedBody.error) return json({ error: parsedBody.error }, parsedBody.status);
    const body = parsedBody.body;
    const groupId = String(body.group_id || "").trim();
    if (!groupId) return json({ error: "缺少分组" }, 400);
    const group = await env.DB.prepare(
      "SELECT id, name FROM media_groups WHERE id = ? LIMIT 1"
    ).bind(groupId).first();
    if (!group) return json({ error: "分组不存在" }, 404);
    const decoded = decodeDashboardImage(body);
    if (decoded.error) return json({ error: decoded.error }, 400);
    const assetId = "media_" + crypto.randomUUID().replace(/-/gu, "");
    const storageKey = "dashboard-media:" + assetId;
    const stored = decoded.bytes.buffer.slice(
      decoded.bytes.byteOffset,
      decoded.bytes.byteOffset + decoded.bytes.byteLength,
    );
    await env.KV.put(storageKey, stored);
    const now = Math.floor(Date.now() / 1000);
    try {
      await env.DB.prepare(
        "INSERT INTO media_assets (id, group_id, file_name, content_type, source_url, storage_key, created_at) VALUES (?, ?, ?, ?, '', ?, ?)"
      ).bind(assetId, groupId, decoded.fileName, decoded.contentType, storageKey, now).run();
    } catch (error) {
      await env.KV.delete(storageKey);
      throw error;
    }
    return json({
      success: true,
      asset: {
        id: assetId,
        group_id: groupId,
        file_name: decoded.fileName,
        content_type: decoded.contentType,
        view_url: "/media-library/assets/" + encodeURIComponent(assetId),
      },
    }, 201);
  }

  // GET /api/media-library/groups/:id/assets - list all assets in one group
  if (/^\/api\/media-library\/groups\/[^/]+\/assets$/u.test(path) && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const groupId = decodeURIComponent(path.slice("/api/media-library/groups/".length, -"/assets".length));
    if (!groupId) return json({ error: "分组不存在" }, 404);
    const group = await env.DB.prepare("SELECT id, name FROM media_groups WHERE id = ? LIMIT 1").bind(groupId).first();
    if (!group) return json({ error: "分组不存在" }, 404);
    const { results } = await env.DB.prepare(
      "SELECT id, file_name, content_type, source_url, created_at FROM media_assets WHERE group_id = ? ORDER BY created_at DESC, id DESC"
    ).bind(groupId).all();
    const assets = (results || []).map((asset) => ({
      id: asset.id,
      file_name: asset.file_name,
      content_type: asset.content_type,
      source_url: asset.source_url || "",
      view_url: "/media-library/assets/" + encodeURIComponent(asset.id),
      created_at: asset.created_at,
    }));
    return json({ group: { id: group.id, name: group.name }, assets });
  }

  // POST /api/media-library/copy-asset - copy one image to another group
  if (path === "/api/media-library/copy-asset" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const srcId = String(body.asset_id || "").trim();
    const targetGroupId = String(body.target_group_id || "").trim();
    if (!srcId || !targetGroupId) return json({ error: "缺少图片编号或目标分组" }, 400);
    const src = await env.DB.prepare(
      "SELECT id, group_id, file_name, content_type, source_url, storage_key FROM media_assets WHERE id = ? LIMIT 1"
    ).bind(srcId).first();
    if (!src) return json({ error: "图片不存在" }, 404);
    const target = await env.DB.prepare("SELECT id FROM media_groups WHERE id = ? LIMIT 1").bind(targetGroupId).first();
    if (!target) return json({ error: "目标分组不存在" }, 404);
    const newId = "media_" + crypto.randomUUID().replace(/-/gu, "");
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      "INSERT INTO media_assets (id, group_id, file_name, content_type, source_url, storage_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(newId, targetGroupId, src.file_name, src.content_type, src.source_url || "", src.storage_key || "", now).run();
    return json({
      success: true,
      asset: { id: newId, group_id: targetGroupId, view_url: "/media-library/assets/" + encodeURIComponent(newId) },
    }, 201);
  }

  // DELETE /api/media-library/assets - delete one gallery image
  if (path === "/api/media-library/assets" && method === "DELETE") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const assetId = String(body.id || "").trim();
    if (!assetId) return json({ error: "缺少图片编号" }, 400);
    const asset = await env.DB.prepare(
      "SELECT id, group_id, storage_key FROM media_assets WHERE id = ? LIMIT 1"
    ).bind(assetId).first();
    if (!asset) return json({ error: "图片不存在" }, 404);
    await env.DB.prepare("DELETE FROM media_assets WHERE id = ?").bind(assetId).run();
    if (asset.storage_key) await env.KV.delete(String(asset.storage_key));
    return json({ success: true, id: assetId, group_id: asset.group_id });
  }

  // PUT /api/media-library - toggle or edit one group
  if (path === "/api/media-library" && method === "PUT") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json();
    const id = String(body.id || "").trim();
    if (!id) return json({ error: "missing id" }, 400);
    const updates = [];
    const params = [];
    if (body.is_active !== undefined) {
      updates.push("is_active = ?");
      params.push(body.is_active ? 1 : 0);
    }
    if (body.name !== undefined) {
      const name = String(body.name || "").trim().slice(0, 80);
      if (!name) return json({ error: "分组名字不能为空" }, 400);
      updates.push("name = ?");
      params.push(name);
    }
    if (body.topic_key !== undefined) {
      updates.push("topic_key = ?");
      params.push(String(body.topic_key || "").trim().slice(0, 80));
    }
    if (body.trigger_keywords !== undefined) {
      updates.push("trigger_keywords = ?");
      params.push(String(body.trigger_keywords || "").trim().slice(0, 1000));
    }
    if (body.persona_id !== undefined) {
      updates.push("persona_id = ?");
      params.push(String(body.persona_id || "").trim().slice(0, 80));
    }
    if (body.platform !== undefined) {
      updates.push("platform = ?");
      params.push(normalizePlatform(body.platform));
    }
    if (!updates.length) return json({ error: "没有要修改的内容" }, 400);
    params.push(id);
    const result = await env.DB.prepare(
      "UPDATE media_groups SET " + updates.join(", ") + " WHERE id = ?"
    ).bind(...params).run();
    if (!result?.meta?.changes) return json({ error: "分组不存在" }, 404);
    return json({ success: true, id });
  }

  return null;
}
