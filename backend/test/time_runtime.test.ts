import { describe, expect, it } from "vitest";
import {
  formatChinaClock,
  formatChinaMessageTime,
  formatChineseDuration,
  getChinaTimeContext,
  requestMessageEpochSeconds,
} from "../functions/api/_time_runtime";

describe("time runtime", () => {
  it("uses China time consistently", () => {
    const date = new Date("2026-10-09T00:30:00.000Z");
    expect(getChinaTimeContext(date)).toEqual({
      currentDatetime: "2026-10-09 08:30:00",
      weekday: "星期五",
    });
    expect(formatChinaClock(Date.parse("2026-10-09T00:30:00.000Z") / 1000)).toBe("08:30");
    expect(formatChinaMessageTime(Date.parse("2026-10-09T00:30:00.000Z") / 1000)).toContain("10/09");
  });

  it("accepts seconds and milliseconds for message timestamps", () => {
    expect(requestMessageEpochSeconds({ created_at: 100 })).toBe(100);
    expect(requestMessageEpochSeconds({ created_at: 1_700_000_000_000 })).toBe(1_700_000_000);
  });

  it("formats short and long durations for humans", () => {
    expect(formatChineseDuration(30 * 60)).toBe("30 分钟");
    expect(formatChineseDuration(2 * 3600 + 15 * 60)).toBe("2 小时 15 分");
  });
});
