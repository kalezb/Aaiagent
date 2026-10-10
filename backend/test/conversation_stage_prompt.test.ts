import { describe, expect, it } from "vitest";
import { conversationStageInstruction } from "../functions/api/_reply_policy";

describe("conversation stage prompt", () => {
  it("treats a first contact as a real first conversation", () => {
    const instruction = conversationStageInstruction("first_contact", "match");
    expect(instruction).toContain("第一次聊天");
    expect(instruction).toContain("不要装熟");
    expect(instruction).toContain("不要把“匹配、奇遇铃、系统标记”");
  });

  it("keeps familiar and soulmate contacts from reintroducing themselves", () => {
    expect(conversationStageInstruction("familiar")).toContain("不要重新自我介绍");
    expect(conversationStageInstruction("soulmate")).toContain("不要重新确认关系");
  });

  it("does not inject a relationship guess when the stage is unknown", () => {
    expect(conversationStageInstruction("unknown")).toBe("");
  });
});
