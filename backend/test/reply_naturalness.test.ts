import { describe, expect, it } from "vitest";
import { replyOpeningHint } from "../functions/api/_reply_naturalness";

describe("reply opening naturalness", () => {
  it("keeps the current fallback when there are no assistant replies", () => {
    expect(replyOpeningHint([])).toBe("不要每条都用哈哈、在的或确实开头。");
    expect(replyOpeningHint([{ role: "user", content: "在吗" }]))
      .toBe("不要每条都用哈哈、在的或确实开头。");
  });

  it("keeps the current unique opening list format", () => {
    const hint = replyOpeningHint([
      { role: "assistant", content: "在的 刚忙完" },
      { role: "user", content: "怎么了" },
      { role: "assistant", content: "知道了 你说" },
    ]);

    expect(hint).toBe(
      "最近你的回复开头有：在的 刚忙、知道了 你。这次换一种自然开头，不要连续用哈哈、在的、确实。"
    );
  });
});
