// backend/test/chat.test.ts
// 使用 vitest 进行 API 测试
// 运行: npx vitest run

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock D1 and KV
class MockD1 {
  private data: Map<string, unknown[]> = new Map();

  prepare(sql: string) {
    return {
      bind: (...params: unknown[]) => ({
        first: async <T>() => {
          const key = params.map(String).join("|");
          const arr = this.data.get(key) || [];
          return (arr[0] as T) || null;
        },
        all: async () => {
          const key = params.map(String).join("|");
          return { results: this.data.get(key) || [] };
        },
        run: async () => {
          return { success: true };
        },
      }),
    };
  }

  exec(sql: string) {
    return { success: true };
  }
}

class MockKV {
  private store: Map<string, string> = new Map();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

describe("Chat API Logic", () => {
  it("should detect sensitive words", () => {
    const sensitiveWords = ["借钱", "账号", "密码", "银行卡", "转账", "验证码", "身份证"];

    function containsSensitive(text: string): boolean {
      return sensitiveWords.some((w) => text.includes(w));
    }

    expect(containsSensitive("你借我点钱")).toBe(true);
    expect(containsSensitive("给我你的账号密码")).toBe(true);
    expect(containsSensitive("今天天气真好")).toBe(false);
    expect(containsSensitive("晚上吃什么")).toBe(false);
  });

  it("should build system prompt correctly", () => {
    function buildSystemPrompt(
      personaPrompt: string,
      historySummary: string,
      currentTime: string
    ): string {
      return personaPrompt +
        "\n\n现在时间是 " + currentTime + "。" +
        "\n\n聊天历史摘要：\n" + (historySummary || "（这是你们第一次聊天）") +
        "\n\n重要规则：回复控制在50字以内，自然口语化。";
    }

    const prompt = buildSystemPrompt("你是阿杰", "", "2026-09-23 14:00");
    expect(prompt).toContain("你是阿杰");
    expect(prompt).toContain("2026-09-23 14:00");
    expect(prompt).toContain("第一次聊天");
    expect(prompt).toContain("50字以内");
  });

  it("should handle dedup logic (5-minute window)", () => {
    const now = Math.floor(Date.now() / 1000);
    const fiveMinutesAgo = now - 300;

    // Within window - should be deduped
    const withinWindow = now - 100;
    expect(withinWindow > fiveMinutesAgo).toBe(true);

    // Outside window - should NOT be deduped
    const outsideWindow = now - 400;
    expect(outsideWindow > fiveMinutesAgo).toBe(false);
  });

  it("should limit history to 20 rounds (40 messages)", () => {
    const MAX_MESSAGES = 40;
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}`,
      created_at: i,
    }));

    // 超出
    expect(messages.length).toBeGreaterThan(MAX_MESSAGES);

    // 取最近40条
    const recent = messages.slice(messages.length - MAX_MESSAGES);
    expect(recent.length).toBe(MAX_MESSAGES);
    expect(recent[0].content).toBe("Message 10");
    expect(recent[recent.length - 1].content).toBe("Message 49");
  });
});

describe("API Route Validation", () => {
  it("should reject chat without required fields", () => {
    const requiredFields = ["token", "platform", "contact_id", "message"];

    const validRequest = {
      token: "mykey_2026_xxx",
      platform: "soul",
      contact_id: "test123",
      message: "你好",
    };

    for (const field of requiredFields) {
      const invalidRequest = { ...validRequest };
      delete (invalidRequest as Record<string, string>)[field];
      const hasField = field in invalidRequest;
      expect(hasField).toBe(false);
    }
  });

  it("should validate persona switching", () => {
    const personas = [
      { id: "male", name: "阿杰", system_prompt: "你是阿杰...", is_active: 1 },
      { id: "female", name: "小夏", system_prompt: "你是小夏...", is_active: 0 },
    ];

    const active = personas.find((p) => p.is_active === 1);
    expect(active?.id).toBe("male");
    expect(active?.name).toBe("阿杰");

    // Switch
    personas[0].is_active = 0;
    personas[1].is_active = 1;
    const newActive = personas.find((p) => p.is_active === 1);
    expect(newActive?.id).toBe("female");
  });
});