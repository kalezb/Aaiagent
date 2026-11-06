import { describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/[[route]]";
import { MockD1, MockKV } from "./chat-test-helpers";
import {
  capReplyLength,
  replyLengthBudget,
} from "../functions/api/_reply_length";

describe("short bubble length policy", () => {
  it("uses the unified one-to-three short bubble budget", () => {
    expect(replyLengthBudget("在吗")).toMatchObject({
      maxSegments: 3,
      targetCharsPerSegment: 8,
      maxCharsPerSegment: 10,
      maxClarifyingCharsPerSegment: 15,
      maxTotalChars: 25,
    });
  });

  it("keeps a natural short acknowledgement and normal short bubbles", () => {
    expect(capReplyLength("嗯", "在吗")).toBe("嗯");
    expect(capReplyLength("在的", "在吗")).toBe("在的");
    expect(capReplyLength("对呀", "是吗")).toBe("对呀");
    expect(capReplyLength("在家带娃呢|||刚哄睡着", "在吗")).toBe(
      "在家带娃呢|||刚哄睡着",
    );
  });

  it("allows a single bubble up to fifteen characters for clarity", () => {
    const clarifying = "一二三四五六七八九十一二";
    expect(capReplyLength(clarifying, "在吗")).toBe(clarifying);
  });

  it("rejects unsplittable, too many, or over-total replies for regeneration", () => {
    expect(capReplyLength("一二三四五六七八九十一二三四五六", "在吗")).toBe("");
    expect(capReplyLength("第一条|||第二条|||第三条|||第四条", "在吗")).toBe("");
    expect(capReplyLength(
      "一二三四五六七八九十|||一二三四五六七八九十|||一二三四五六七八九十",
      "在吗",
    )).toBe("");
  });

  it("asks the model to say an unsplittable long reply again instead of cutting it", async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).includes("/chat/completions")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "今天晚上我真的很想和你好好聊一会儿天" } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const body = JSON.parse(String(init?.body || "{}"));
      expect(body.messages[0].content).toContain("只改长度｜最后一次重说");
      return new Response(JSON.stringify({
        choices: [{ message: { content: "今晚想你了|||聊会儿吗" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "length-rewrite-1",
          platform: "soul",
          contact_id: "length-rewrite-contact",
          contact_name: "字数重说测试",
          messages: [{ role: "user", content: "在吗" }],
        }),
      }),
      env: { DB: new MockD1(), KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "今晚想你了|||聊会儿吗",
      timing: { repair_attempted: true },
    });
    expect(calls).toBe(2);
  });
});
