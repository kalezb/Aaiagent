import { describe, expect, it } from "vitest";
import {
  summarizeIncidents,
  summarizeReplayCases,
  summarizeTokenBudget,
} from "../replay/runtime-report.mjs";

describe("runtime report", () => {
  it("summarizes replay pass and fail counts", () => {
    const summary = summarizeReplayCases([
      {
        incident_id: "ok-1",
        title: "正常案例",
        source: "android",
        fixture_json: JSON.stringify({ events: [{ event: "delivery_finished" }] }),
        expectation_json: JSON.stringify({
          expected: "delivery_finished",
          forbidden: "unexpected_profile_page",
        }),
      },
      {
        incident_id: "bad-1",
        title: "失败案例",
        source: "dashboard",
        fixture_json: JSON.stringify({ events: [{ event: "page_observed" }] }),
        expectation_json: "{}",
      },
    ]);

    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.failed_cases[0].incident_id).toBe("bad-1");
  });

  it("adds token usage without treating unlimited quota as a limit", () => {
    const summary = summarizeTokenBudget([
      { monthly_limit: 20, spent: 5 },
      { monthly_limit: -1, spent: 3 },
    ]);

    expect(summary.devices).toBe(2);
    expect(summary.spent).toBe(8);
    expect(summary.limit).toBe(20);
    expect(summary.remaining).toBe(12);
    expect(summary.unlimited_devices).toBe(1);
  });

  it("groups incidents by status and kind", () => {
    const summary = summarizeIncidents([
      { status: "open", kind: "android_event_sequence" },
      { status: "fixed", kind: "android_event_sequence" },
      { status: "fixed", kind: "browser_event_sequence" },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.by_status).toMatchObject({ open: 1, fixed: 2 });
    expect(summary.by_kind).toMatchObject({
      android_event_sequence: 2,
      browser_event_sequence: 1,
    });
  });
});
