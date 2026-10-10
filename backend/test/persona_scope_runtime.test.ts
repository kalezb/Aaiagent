import { describe, expect, it } from "vitest";
import {
  isXingmuPersonaScope,
  resolveContactConfig,
} from "../functions/api/_persona_scope_runtime";

describe("persona scope runtime", () => {
  it("recognizes the Xingmu persona by id or identity", () => {
    expect(isXingmuPersonaScope("female", "")).toBe(true);
    expect(isXingmuPersonaScope("custom", "我叫王雅慧")).toBe(true);
    expect(isXingmuPersonaScope("sutang", "我叫苏棠")).toBe(false);
  });

  it("uses the matching contact channel for each persona scope", () => {
    const env = {
      CONTACT_WECHAT: "wechat-main",
      CONTACT_QQ: "qq-main",
      CONTACT_ACCOUNT: "fallback",
    };
    expect(resolveContactConfig(env, true)).toEqual({
      channel: "wechat",
      account: "wechat-main",
    });
    expect(resolveContactConfig(env, false)).toEqual({
      channel: "qq",
      account: "qq-main",
    });
  });

  it("only lets a device override the QQ account when explicitly flagged", () => {
    const env = { CONTACT_QQ: "qq-main" };
    const facts = { contact_qq: "qq-device" };
    expect(resolveContactConfig(env, false, facts, false).account).toBe("qq-main");
    expect(resolveContactConfig(env, false, facts, true).account).toBe("qq-device");
  });
});
