import { describe, expect, it } from "vitest";
import {
  evaluateReplayCaseRecord,
  parseReplayFixtureEvents,
} from "../functions/api/_incident_runtime";

describe("incident runtime", () => {
  it("accepts wrapped, array, and JSON-lines fixtures", () => {
    expect(parseReplayFixtureEvents('{"events":[{"event":"a"}]}')).toHaveLength(1);
    expect(parseReplayFixtureEvents('[{"event":"a"}]')).toHaveLength(1);
    expect(parseReplayFixtureEvents('{"event":"a"}\n{"event":"b"}')).toHaveLength(2);
  });

  it("evaluates a replay case without living inside the route", () => {
    const result = evaluateReplayCaseRecord({
      id: "case-1",
      incident_id: "incident-1",
      title: "回放",
      source: "dashboard",
      fixture_json: JSON.stringify({
        events: [{
          event: "api_error",
          timestampMs: 1,
        }],
      }),
      expectation_json: JSON.stringify({
        expected: "",
        forbidden: "不能报错",
      }),
    });
    expect(result.passed).toBe(false);
    expect(result.checks.some((check) => check.name === "has_expectation")).toBe(true);
  });
});
