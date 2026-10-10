import { describe, expect, it } from "vitest";
import {
  compactProfileForPrompt,
  customerProfilePrompt,
  emptyCustomerProfile,
  explicitFactsPatch,
  extractExplicitCustomerFacts,
  mergeCustomerProfile,
  profileCandidateText,
} from "../functions/api/_profile_runtime";

describe("profile runtime", () => {
  it("merges long-term customer facts without dropping existing data", () => {
    const merged = mergeCustomerProfile(
      { basic: { name: "阿明", age: "31" }, preferences: { likes: ["跑步"] } },
      { basic: { city: "重庆" }, preferences: { likes: ["咖啡", "跑步"] } },
    );
    expect(merged.basic.name).toBe("阿明");
    expect(merged.preferences.likes).toEqual(["跑步", "咖啡"]);
  });

  it("removes empty profile fields before prompt assembly", () => {
    const profile = emptyCustomerProfile();
    profile.basic.name = "阿明";
    const compact = compactProfileForPrompt(profile);
    expect(compact).toMatchObject({ basic: { name: "阿明" } });
    expect(customerProfilePrompt(profile)).toContain("阿明");
  });

  it("extracts explicit district and negative family facts immediately", () => {
    expect(profileCandidateText("我在渝北区")).toBe(true);
    expect(extractExplicitCustomerFacts("我在渝北区")).toMatchObject({
      location: { residence: "渝北区" },
    });
    expect(extractExplicitCustomerFacts("我没孩子")).toMatchObject({
      family: { children: "没有孩子" },
    });
    expect(extractExplicitCustomerFacts("我今年31岁")).toMatchObject({
      basic: { age: "31" },
    });
  });

  it("uses a later explicit single statement to overwrite an old wrong marriage value", () => {
    const old = mergeCustomerProfile(emptyCustomerProfile(), {
      family: { marital_status: "已婚" },
    });
    const facts = extractExplicitCustomerFacts("单身汉");
    const merged = mergeCustomerProfile(
      old,
      explicitFactsPatch(facts, { id: 10, content: "单身汉", created_at: 100 }),
    );
    expect(merged.family.marital_status).toBe("单身");
    expect(merged._runtime.factSources["family.marital_status"].messageId).toBe(10);
  });

  it("does not turn questions aimed at the agent into customer facts", () => {
    expect(extractExplicitCustomerFacts("你结婚了迈")).toEqual({});
    expect(extractExplicitCustomerFacts("你孩子几岁了？")).toEqual({});
  });

  it("keeps runtime bookkeeping out of the model prompt", () => {
    const profile = mergeCustomerProfile(emptyCustomerProfile(), {
      family: { marital_status: "单身" },
      _runtime: { lastDeterministicMessageId: 10, factSources: { x: { messageId: 10 } } },
    });
    const compact = compactProfileForPrompt(profile);
    expect(compact).toMatchObject({ family: { marital_status: "单身" } });
    expect(compact._runtime).toBeUndefined();
  });
});
