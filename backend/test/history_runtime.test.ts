import { describe, expect, it } from "vitest";
import {
  dedupeHistoryAgainstCurrent,
  dedupeNearbyHistory,
  loadRecentAssistantReplies,
  makeContactKey,
  makeSingleGroupId,
  parseSingleGroupId,
} from "../functions/api/_history_runtime";

describe("history runtime", () => {
  it("round-trips a single-contact identity without leaking it into chat code", () => {
    const id = makeSingleGroupId("token-a", "soul", "contact-1");
    expect(parseSingleGroupId(id)).toEqual({
      token: "token-a",
      platform: "soul",
      contactId: "contact-1",
    });
    expect(makeContactKey("token-a", "soul", "contact-1")).toContain("contact-1");
  });

  it("removes nearby duplicates", () => {
    const messages = [
      { role: "user", content: "在吗", created_at: 100, platform: "soul", contact_id: "a" },
      { role: "user", content: "在吗", created_at: 104, platform: "soul", contact_id: "a" },
    ];
    expect(dedupeNearbyHistory(messages)).toHaveLength(1);
  });

  it("keeps the current request from appearing twice", () => {
    const history = [{ role: "user", content: "你好", created_at: 100, platform: "soul", contact_id: "a" }];
    const current = [{ role: "user", content: "你好" }];
    expect(dedupeHistoryAgainstCurrent(history, current)).toEqual([]);
  });

  it("loads only recent replies from the same platform and contact", async () => {
    const db = {
      prepare: () => ({
        bind: (...params: any[]) => ({
          all: async () => ({
            results: [
              {
                role: "assistant",
                content: "在呢",
                platform: "soul",
                contact_id: "contact-1",
              },
              {
                role: "assistant",
                content: "串台内容",
                platform: "soul",
                contact_id: "contact-2",
              },
            ],
            params,
          }),
        }),
      }),
    };

    const replies = await loadRecentAssistantReplies(
      db,
      "token-a",
      "soul",
      "contact-1",
      "persona-a",
      30,
    );
    expect(replies).toHaveLength(1);
    expect(replies[0].content).toBe("在呢");
  });
});
