import { describe, expect, it } from "vitest";
import {
  isSimpleGreetingTurn,
  localGreetingFallback,
} from "../functions/api/_greeting_runtime";

describe("greeting fallback", () => {
  it("recognizes plain greetings without treating normal questions as greetings", () => {
    expect(isSimpleGreetingTurn("哈喽")).toBe(true);
    expect(isSimpleGreetingTurn("哈喽另一面的你")).toBe(true);
    expect(isSimpleGreetingTurn("早上好呀")).toBe(true);
    expect(isSimpleGreetingTurn("你好坏啊这人")).toBe(false);
    expect(isSimpleGreetingTurn("你在干嘛")).toBe(false);
    expect(isSimpleGreetingTurn("为什么今天这么忙")).toBe(false);
  });

  it("only supplies a reply for a simple greeting", () => {
    expect(localGreetingFallback("哈喽")).not.toBe("");
    expect(localGreetingFallback("哈喽另一面的你")).not.toBe("");
    expect(localGreetingFallback("你在干嘛")).toBe("");
  });
});
