import { describe, expect, it } from "vitest";
import {
  dropExplicitSegments,
  INTERNAL_INSTRUCTION_LEAK_FALLBACK,
  sanitizeAssistantReply,
  sanitizeInternalInstructionLeak,
  sanitizeStaleAssistantReply,
} from "../functions/api/_assistant_output";

describe("assistant output runtime", () => {
  it("removes leaked timestamps and internal markers", () => {
    expect(sanitizeAssistantReply("【10/06，21:07】睡了")).toBe("睡了");
    expect(sanitizeAssistantReply("对方：在呢|||【内部】")).toBe("在呢|||");
  });

  it("blocks instruction-like internal text from reaching the customer", () => {
    expect(sanitizeInternalInstructionLeak("先答他怎么表现：听话 不催 不越界"))
      .toBe(INTERNAL_INSTRUCTION_LEAK_FALLBACK);
    expect(sanitizeInternalInstructionLeak("按规则回答他 先问他结没结婚"))
      .toBe(INTERNAL_INSTRUCTION_LEAK_FALLBACK);
  });

  it("keeps the natural part and removes only the leaked instruction segment", () => {
    expect(
      sanitizeInternalInstructionLeak(
        "先看表现啊 听话点|||先答他怎么表现：听话 不催 不越界"
      )
    ).toBe("先看表现啊 听话点");
  });

  it("does not send explicit segments", () => {
    expect(dropExplicitSegments("好呀|||裸照不行")).toBe("好呀");
  });

  it("keeps the final meeting-reward wording only when the caller allows it", () => {
    expect(dropExplicitSegments("别说见面 房间都随你挑")).toBe("别说见面 房间都随你挑");
    expect(dropExplicitSegments("表现够了再说开房")).toBe("");
    expect(dropExplicitSegments("表现够了再说开房", { allowMeetingReward: true }))
      .toBe("表现够了再说开房");
    expect(dropExplicitSegments("裸照不行|||表现够了再说开房", { allowMeetingReward: true }))
      .toBe("表现够了再说开房");
  });

  it("does not invent a new late explanation for stale replies", () => {
    expect(sanitizeStaleAssistantReply("刚忙完", {
      hasTimestamp: true,
      level: "past",
      ageSeconds: 2 * 24 * 3600,
      pastMode: true,
      messageType: "normal",
    })).toBe("刚忙完");
  });
});
