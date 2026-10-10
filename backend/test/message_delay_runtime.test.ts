import { describe, expect, it } from "vitest";
import {
  classifyIncomingMessage,
  getMessageDelayPolicy,
} from "../functions/api/_message_delay";

describe("message delay runtime", () => {
  it("classifies the latest message before setting a reply pace", () => {
    expect(classifyIncomingMessage("晚安")).toBe("night");
    expect(classifyIncomingMessage("哈喽")).toBe("greeting");
    expect(classifyIncomingMessage("今天好累")).toBe("emotion");
  });

  it("turns elapsed time into a clear reply policy", () => {
    expect(getMessageDelayPolicy({ content: "在吗", created_at: 1_000 }, 1_000 + 10 * 60).level)
      .toBe("short_wait");
    expect(getMessageDelayPolicy({ content: "在吗", created_at: 1_000 }, 1_000 + 2 * 24 * 3600).level)
      .toBe("past_1_3d");
  });
});
