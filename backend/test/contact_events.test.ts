import { describe, expect, it } from "vitest";
import {
  buildContactEventsPrompt,
  detectImportantEvents,
  loadRecentContactEvents,
  recordContactEvents,
} from "../functions/api/_contact_events";

describe("contact event memory", () => {
  it("detects only important facts instead of every chat line", () => {
    const events = detectImportantEvents("我下周三要去医院复查，顺便搬家", 1000);
    const types = events.map((event) => event.event_type);

    expect(types).toContain("health");
    expect(types).toContain("move");
    expect(detectImportantEvents("今天天气不错", 1000)).toEqual([]);
  });

  it("builds a bounded background prompt without forcing repetition", () => {
    const prompt = buildContactEventsPrompt([
      { event_type: "health", content: "下周三去医院复查", happened_at: 1000 },
      { event_type: "work", content: "最近加班很多", happened_at: 900 },
    ]);

    expect(prompt).toContain("不要生硬复述");
    expect(prompt).toContain("下周三去医院复查");
    expect(prompt).toContain("最近加班很多");
  });

  it("records and loads recent events for the same contact only", async () => {
    const rows: any[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...params: any[]) {
            return {
              async run() {
                if (sql.includes("INSERT INTO contact_events")) {
                  rows.push({
                    id: rows.length + 1,
                    token: params[0],
                    platform: params[1],
                    contact_id: params[2],
                    event_type: params[3],
                    content: params[4],
                    happened_at: params[5],
                  });
                }
                return { success: true };
              },
              async all() {
                if (!sql.includes("FROM contact_events")) return { results: [] };
                return {
                  results: rows.filter((row) =>
                    row.token === params[0] &&
                    row.platform === params[1] &&
                    row.contact_id === params[2]
                  ),
                };
              },
            };
          },
        };
      },
    };

    await recordContactEvents(
      db,
      "device-1",
      "soul",
      "contact-1",
      [{ role: "user", content: "我下周生日，记得提醒我", created_at: 1000 }],
      1001,
    );
    const loaded = await loadRecentContactEvents(db, "device-1", "soul", "contact-1");

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      event_type: "birthday",
      content: "我下周生日，记得提醒我",
    });
  });
});
