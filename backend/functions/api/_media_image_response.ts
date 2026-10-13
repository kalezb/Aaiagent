import { json } from "./_http_runtime";

export interface MediaImageAssetRow {
  file_name?: unknown;
  content_type?: unknown;
  source_url?: unknown;
  storage_key?: unknown;
}

export interface MediaImageResponseOptions {
  missingError: string;
  missingStorageError: string;
  storageUnavailableError?: string;
  maxStorageBytes?: number;
  storageTooLargeError?: string;
  maxProxyBytes: number;
  proxyTooLargeError: string;
  checkProxyContentLength: boolean;
  preferUpstreamContentType: boolean;
  includeCors: boolean;
}

function responseHeaders(
  contentType: string,
  fileName: string,
  includeCors: boolean,
): Headers {
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": "inline; filename=\"" + fileName + "\"",
    "Cache-Control": "private, max-age=300",
  });
  if (includeCors) headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}

export async function serveMediaImage({
  env,
  asset,
  assetId,
  options,
}: {
  env: { KV?: { get?: (key: string, type?: string) => Promise<unknown> } };
  asset: MediaImageAssetRow | null | undefined;
  assetId: string;
  options: MediaImageResponseOptions;
}): Promise<Response> {
  if (!asset) return json({ error: options.missingError }, 404);

  const fileName = String(asset.file_name || assetId + ".jpg").replace(/[^\w.\-]+/gu, "_");
  const storedType = String(asset.content_type || "image/jpeg").trim();
  const contentType = storedType.startsWith("image/") ? storedType : "image/jpeg";
  const storageKey = String(asset.storage_key || "").trim();

  if (storageKey) {
    if (
      options.storageUnavailableError
      && (!env.KV || typeof env.KV.get !== "function")
    ) {
      return json({ error: options.storageUnavailableError }, 503);
    }
    const stored = await env.KV?.get?.(storageKey, "arrayBuffer");
    if (!stored || typeof stored !== "object" || !("byteLength" in stored)) {
      return json({ error: options.missingStorageError }, 404);
    }
    const storedBytes = stored as ArrayBuffer;
    if (storedBytes.byteLength < 1) {
      return json({ error: options.missingStorageError }, 404);
    }
    if (
      options.maxStorageBytes !== undefined
      && storedBytes.byteLength > options.maxStorageBytes
    ) {
      return json({ error: options.storageTooLargeError || options.proxyTooLargeError }, 413);
    }
    return new Response(storedBytes, {
      status: 200,
      headers: responseHeaders(contentType, fileName, options.includeCors),
    });
  }

  if (!asset.source_url) return json({ error: options.missingError }, 404);
  let sourceUrl = "";
  try {
    const parsed = new URL(String(asset.source_url));
    if (parsed.protocol !== "https:") return json({ error: "图片地址不安全" }, 400);
    sourceUrl = parsed.toString();
  } catch (_) {
    return json({ error: "图片地址无效" }, 400);
  }

  const upstream = await fetch(sourceUrl, { redirect: "follow" });
  if (!upstream.ok) return json({ error: "图片下载失败" }, 502);
  if (options.checkProxyContentLength) {
    const declaredLength = Number(upstream.headers.get("Content-Length") || 0);
    if (declaredLength > options.maxProxyBytes) {
      return json({ error: options.proxyTooLargeError }, 413);
    }
  }
  const body = await upstream.arrayBuffer();
  if (body.byteLength > options.maxProxyBytes) {
    return json({ error: options.proxyTooLargeError }, 413);
  }

  const headerType = String(upstream.headers.get("Content-Type") || "").split(";")[0].trim();
  const proxyType = options.preferUpstreamContentType && headerType.startsWith("image/")
    ? headerType
    : contentType;
  return new Response(body, {
    status: 200,
    headers: responseHeaders(proxyType, fileName, options.includeCors),
  });
}
