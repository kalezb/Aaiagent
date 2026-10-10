import { describe, expect, it } from "vitest";
import {
  buildPhotoIntentClassifierPrompt,
  mediaDirectiveFallback,
  mediaTeaserLine,
} from "../functions/api/_media_runtime";

describe("media runtime", () => {
  it("builds a bounded photo-intent prompt from recent messages", () => {
    const prompt = buildPhotoIntentClassifierPrompt(["1", "2", "3", "4", "5", "6", "7"]);
    expect(prompt).toContain("1. 2");
    expect(prompt).not.toContain("1. 1");
    expect(prompt).toContain("最后一条用户消息：7");
  });

  it("keeps photo fallback text separate from the chat route", () => {
    expect(mediaDirectiveFallback("看看")).toBe("看什么？");
    expect(mediaDirectiveFallback("今天好累")).toBe("急啥呀，先聊着");
  });

  it("rotates teaser lines without making the selector random", () => {
    expect(mediaTeaserLine("same-seed")).toBe(mediaTeaserLine("same-seed"));
  });
});
