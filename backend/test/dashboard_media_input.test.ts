import { describe, expect, it } from "vitest";
import { decodeDashboardImage } from "../functions/api/_dashboard_media_input";

describe("dashboard media input", () => {
  it("decodes a supported data URL", () => {
    const decoded = decodeDashboardImage({
      data_base64: "data:image/png;base64,YWJj",
      file_name: "测试/图片.png",
    });

    expect(decoded.error).toBeUndefined();
    expect(decoded.contentType).toBe("image/png");
    expect(decoded.fileName).toBe("测试_图片.png");
    expect(Array.from(decoded.bytes)).toEqual([97, 98, 99]);
  });

  it("rejects unsupported or invalid image input", () => {
    expect(decodeDashboardImage({
      data_base64: "YWJj",
      content_type: "text/plain",
    }).error).toBe("只支持 JPG、PNG、WebP、GIF 图片");
    expect(decodeDashboardImage({
      data_base64: "%",
      content_type: "image/png",
    }).error).toBe("图片内容无效");
  });

  it("rejects an empty image", () => {
    expect(decodeDashboardImage({
      data_base64: "",
      content_type: "image/jpeg",
    }).error).toBe("图片内容无效");
    expect(decodeDashboardImage({
      data_base64: " ",
      content_type: "image/jpeg",
    }).error).toBe("图片内容无效");
  });
});
