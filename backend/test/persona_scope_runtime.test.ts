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
      CONTACT_DOUBAN: "douban-main",
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
    expect(resolveContactConfig(env, false, null, false, true)).toEqual({
      channel: "douban",
      account: "douban-main",
    });
  });

  it("uses the Douban account saved in the shared persona facts", () => {
    const env = { CONTACT_DOUBAN: "douban-main" };
    const facts = { contact_qq: "douban-device" };
    expect(resolveContactConfig(env, false, facts, false, true).account).toBe("douban-device");
    expect(resolveContactConfig(env, false, facts, true, true).account).toBe("douban-device");
  });
});
