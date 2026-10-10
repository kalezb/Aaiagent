import { describe, expect, it } from "vitest";
import { buildMediaGroupQuery } from "../functions/api/_media_policy";

describe("media group scope", () => {
  it("lets a persona see both its own groups and the shared library", () => {
    const { sql, params } = buildMediaGroupQuery("female_sutang", "soul");
    expect(params).toEqual(["female_sutang", "soul"]);
    expect(sql).toContain("(persona_id = ? AND platform = ?)");
    expect(sql).toContain("(persona_id = '' AND platform = '')");
    expect(sql).toContain(" OR ");
  });

  it("keeps the star-soul allow list while still sharing the library", () => {
    const { sql, params } = buildMediaGroupQuery("female", "soul");
    expect(params).toEqual(["female", "soul"]);
    expect(sql).toContain("id IN ('daily', 'body')");
    expect(sql).toContain("(persona_id = '' AND platform = '')");
  });

  it("binds one extra parameter when a single group is requested", () => {
    const { sql, params } = buildMediaGroupQuery("female_sutang", "soul", "daily");
    expect(params).toEqual(["female_sutang", "soul", "daily"]);
    expect(sql).toContain("AND id = ?");
  });
});
