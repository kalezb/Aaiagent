import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEVICE_SETTINGS,
  isWithinAiHours,
  parseBoolean,
  saveDeviceSetting,
} from "../functions/api/_device_runtime";

class FakeDb {
  row: any = null;

  prepare(sql: string) {
    return {
      bind: (...params: any[]) => ({
        run: async () => {
          if (sql.includes("INSERT INTO device_settings")) {
            this.row = {
              platform: params[1],
              hosting_enabled: params[2],
              monitor_enabled: params[3],
              weather_enabled: params[4],
              time_enabled: params[5],
              reply_pace_sec: params[6],
              ai_hours_enabled: params[7],
              ai_start_hour: params[8],
              ai_end_hour: params[9],
              model_line: params[10],
            };
          }
          return { success: true };
        },
        first: async () => this.row,
      }),
    };
  }
}

describe("device runtime", () => {
  it("parses boolean values consistently", () => {
    expect(parseBoolean("on")).toBe(true);
    expect(parseBoolean("disabled")).toBe(false);
    expect(parseBoolean(undefined, true)).toBe(true);
  });

  it("applies AI duty hours without scattering time-zone logic", () => {
    expect(DEFAULT_DEVICE_SETTINGS.ai_start_hour).toBe(8);
    expect(isWithinAiHours({ ai_hours_enabled: false })).toBe(true);
  });

  it("keeps device settings behind one writer", async () => {
    const db = new FakeDb();
    const settings = await saveDeviceSetting(db, "device-1", "model_line", "b");
    expect(settings.model_line).toBe("b");
  });
});
