import { describe, expect, it } from "vitest";
import { evaluateReplayCase } from "../replay/incident-replay.mjs";

describe("incident replay evaluator", () => {
  it("passes a profile-page incident when the fixture still reproduces it", () => {
    const fixture = [
      {
        timestampMs: 1_000,
        event: "delivery_finished",
        result: "complete",
      },
      {
        timestampMs: 1_500,
        event: "page_observed",
        pageKind: "PROFILE_PAGE",
      },
    ].map((item) => JSON.stringify(item)).join("\n");
    const result = evaluateReplayCase({
      id: "replay-1",
      incident_id: "incident-1",
      source: "android",
      title: "资料页误入",
      fixture_json: fixture,
      expectation_json: JSON.stringify({
        expected: "自动回列表",
        forbidden: "再次误入",
        anomaly_actions: ["UnexpectedProfilePageAfterReply"],
      }),
    });

    expect(result.passed).toBe(true);
  });

  it("passes a browser incident with a real error event", () => {
    const fixture = JSON.stringify({
      events: [
        { time: "2026-10-09T10:00:00Z", type: "request", detail: { path: "/media" } },
        { time: "2026-10-09T10:00:01Z", type: "api_error", detail: { status: 500 } },
      ],
    });
    const result = evaluateReplayCase({
      id: "replay-2",
      incident_id: "incident-2",
      source: "dashboard",
      title: "网站接口失败",
      fixture_json: fixture,
      expectation_json: JSON.stringify({
        expected: "不能再次报错",
        forbidden: "误判正常",
        anomaly_actions: [],
      }),
    });

    expect(result.passed).toBe(true);
  });

  it("fails when the fixture no longer reproduces the expected anomaly", () => {
    const result = evaluateReplayCase({
      id: "replay-3",
      incident_id: "incident-3",
      source: "android",
      title: "刷新风暴",
      fixture_json: JSON.stringify([
        { timestampMs: 1_000, event: "content_changed", action: "idle_wake" },
      ]),
      expectation_json: JSON.stringify({
        expected: "暂停重复扫描",
        forbidden: "连续刷新",
        anomaly_actions: ["ConversationListRefreshStorm"],
      }),
    });

    expect(result.passed).toBe(false);
  });
});
