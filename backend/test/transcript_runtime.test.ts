import { describe, expect, it } from "vitest";
import {
  formatTranscriptLine,
  resolveMessageTranscript,
} from "../functions/api/_transcript_runtime";

describe("transcript runtime", () => {
  it("keeps legacy and direct voice transcripts in one shape", () => {
    expect(resolveMessageTranscript("[语音]", "我到家了")).toBe("我到家了");
    expect(resolveMessageTranscript("对方语音转文字：我到家了", "")).toBe("我到家了");
  });

  it("formats a transcript line without leaking internal markers", () => {
    const line = formatTranscriptLine({
      role: "user",
      content: "[语音]",
      transcript: "我到家了",
      created_at: 1_700_000_000,
      time_kind: "first_observed",
    }, 0, 1_700_000_010);
    expect(line).toContain("对方：[语音|转写：我到家了]");
    expect(line).toContain("·读到");
  });

  it("uses the typed voice marker even when the page caption varies", () => {
    const transcribed = formatTranscriptLine({
      role: "user",
      type: "voice",
      content: "[语音消息]",
      transcript: "我先去洗澡了",
    }, 0, 1_700_000_010);
    const missing = formatTranscriptLine({
      role: "user",
      type: "voice",
      content: "[语音]",
      transcript: "",
    }, 0, 1_700_000_010);

    expect(transcribed).toContain("[语音|转写：我先去洗澡了]");
    expect(missing).toContain("[语音|未转写]");
  });
});
