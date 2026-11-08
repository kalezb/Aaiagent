import { describe, expect, it } from "vitest";
import {
  MEDIA_DISLIKE_REPLIES,
  localMediaDislikeReply,
} from "../functions/api/_reply_media_boundary";

describe("media dislike boundary", () => {
  it("replies with a fixed line when the other side sends voice", () => {
    const reply = localMediaDislikeReply([
      { role: "user", type: "voice", content: "[语音]" },
    ]);
    expect(MEDIA_DISLIKE_REPLIES).toContain(reply);
    expect(reply).toContain("打字");
  });

  it("replies with a fixed line when the other side sends a sticker", () => {
    const reply = localMediaDislikeReply([
      { role: "user", type: "sticker", content: "[表情包：偷笑]" },
    ]);
    expect(MEDIA_DISLIKE_REPLIES).toContain(reply);
  });

  it("does not fire for normal text", () => {
    expect(localMediaDislikeReply([
      { role: "user", type: "text", content: "在干嘛" },
    ])).toBe("");
  });

  it("only looks at messages after her last reply", () => {
    expect(localMediaDislikeReply([
      { role: "user", type: "voice", content: "[语音]" },
      { role: "assistant", content: "别发语音和表情包，我讨厌这个，打字" },
      { role: "user", type: "text", content: "好" },
    ])).toBe("");
  });
});
