export const MAX_DASHBOARD_MEDIA_BYTES = 8 * 1024 * 1024;

const DASHBOARD_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function decodeDashboardImage(body): any {
  const raw = String(body?.data_base64 || "").trim();
  const dataUrlMatch = raw.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/iu);
  const declaredType = String(body?.content_type || "").trim().toLowerCase();
  const contentType = (dataUrlMatch?.[1] || declaredType || "").toLowerCase();
  const base64 = dataUrlMatch?.[2] || raw;
  if (!DASHBOARD_IMAGE_TYPES.has(contentType)) {
    return { error: "只支持 JPG、PNG、WebP、GIF 图片" };
  }
  if (!base64 || !/^[A-Za-z0-9+/=\s]+$/u.test(base64)) {
    return { error: "图片内容无效" };
  }
  let bytes = new Uint8Array(0);
  try {
    const binary = atob(base64.replace(/\s+/gu, ""));
    bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch (_) {
    return { error: "图片内容无效" };
  }
  if (!bytes.byteLength) return { error: "图片内容为空" };
  if (bytes.byteLength > MAX_DASHBOARD_MEDIA_BYTES) {
    return { error: "图片不能超过 8MB" };
  }
  const originalName = String(body?.file_name || "photo").trim().slice(0, 160);
  const safeName = originalName.replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, "_") || "photo";
  return { bytes, contentType, fileName: safeName };
}
