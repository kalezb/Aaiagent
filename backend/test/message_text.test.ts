import { describe, expect, it } from "vitest";
import { compactQuestionText, latestIncomingText } from "../functions/api/_message_text";

describe("message text helpers", () => {
  it("returns the latest user message and ignores later assistant output", () => {
    expect(latestIncomingText([
      { role: "user", content: "第一条" },
      { role: "assistant", content: "回复" },
      { role: "user", content: " 最后一条 " },
      { role: "assistant", content: "又一条回复" },
    ])).toBe("最后一条");
  });

  it("returns empty text when there is no user message", () => {
    expect(latestIncomingText([{ role: "assistant", content: "只有回复" }])).toBe("");
  });

  it("compacts whitespace without changing visible characters", () => {
    expect(compactQuestionText(" 你 多大  了？ ")).toBe("你多大了？");
    expect(compactQuestionText(null)).toBe("");
  });
});
