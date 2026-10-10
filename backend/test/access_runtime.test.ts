import { describe, expect, it } from "vitest";
import { isDashboardAuthorized } from "../functions/api/_access_runtime";

describe("access runtime", () => {
  it("requires both a configured password and a matching header", () => {
    const request = new Request("https://example.com", {
      headers: { "X-Dashboard-Password": "secret" },
    });
    expect(isDashboardAuthorized(request, { DASHBOARD_PASSWORD: "secret" })).toBe(true);
    expect(isDashboardAuthorized(request, { DASHBOARD_PASSWORD: "" })).toBe(false);
    expect(isDashboardAuthorized(request, { DASHBOARD_PASSWORD: "other" })).toBe(false);
  });
});
