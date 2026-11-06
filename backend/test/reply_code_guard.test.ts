import { describe, expect, it } from "vitest";
import {
  capReplyLength,
  EMPTY_STRUCTURED_REPLY_FALLBACK,
  isMachineCodeOrJson,
  needsReplyLengthRewrite,
  parseStructuredReply,
} from "../functions/api/_reply_length";
import {
  sanitizeAssistantReply,
  sanitizeMachineCodeLeak,
} from "../functions/api/_assistant_output";

describe("reply machine code & JSON guard", () => {
  const INCIDENT_RAW_OUTPUT =
    '{"type": "json_object", "content": "{\\"reply\\": \\"被你揣测到了 这话说得倒老实\\n\\n凌晨两点不睡 就为了跟我贫嘴？"';

  describe("isMachineCodeOrJson", () => {
    it("identifies truncated and raw JSON as machine code", () => {
      expect(isMachineCodeOrJson(INCIDENT_RAW_OUTPUT)).toBe(true);
      expect(isMachineCodeOrJson('{"messages": ["你好"')).toBe(true);
      expect(isMachineCodeOrJson('{"reply": "test"}')).toBe(true);
      expect(isMachineCodeOrJson('{"type": "json_object"}')).toBe(true);
      expect(isMachineCodeOrJson('["message1", "message2"]')).toBe(true);
    });

    it("identifies code blocks and programming language keywords", () => {
      expect(isMachineCodeOrJson("```json\n{\"reply\": \"hi\"}\n```")).toBe(true);
      expect(isMachineCodeOrJson("```python\ndef run():\n  pass\n```")).toBe(true);
      expect(isMachineCodeOrJson("function test() { return 1; }")).toBe(true);
      expect(isMachineCodeOrJson("console.log('error')")).toBe(true);
      expect(isMachineCodeOrJson("const x = 123;")).toBe(true);
      expect(isMachineCodeOrJson("def get_data():")).toBe(true);
      expect(isMachineCodeOrJson('return {"code": 0};')).toBe(true);
    });

    it("does not falsely trigger on normal human chat and directives", () => {
      expect(isMachineCodeOrJson("晚上好 在忙什么呢")).toBe(false);
      expect(isMachineCodeOrJson("在呢 你说")).toBe(false);
      expect(isMachineCodeOrJson("29了 你呢？")).toBe(false);
      expect(isMachineCodeOrJson("我用 iPhone 15 Pro 拍")).toBe(false);
      expect(isMachineCodeOrJson("喜欢 1+1=2 这样的默契")).toBe(false);
      expect(isMachineCodeOrJson("[[SEND_MEDIA:daily]]")).toBe(false);
      expect(isMachineCodeOrJson("[[SEND_MEDIA:daily]] 刚拍的给你看")).toBe(false);
      expect(isMachineCodeOrJson("前阵子在豆瓣看影评，发现里面挺清静还能聊天|||看你表现真诚上道，今天破例只给你一个人|||sutang2026")).toBe(false);
    });
  });

  describe("parseStructuredReply", () => {
    it("rejects truncated JSON and never falls through to legacy plain text", () => {
      const parsed = parseStructuredReply(INCIDENT_RAW_OUTPUT);
      expect(parsed.ok).toBe(false);
      expect(parsed.source).toBe("json");
      expect(parsed.messages).toHaveLength(0);
      expect(parsed.error).toBe("code_or_truncated_json");
    });

    it("safely unwraps nested stringified JSON without leaking code tags", () => {
      const nested = JSON.stringify({
        type: "json_object",
        content: JSON.stringify({ reply: "被你揣测到了 这话说得倒老实" }),
      });
      const parsed = parseStructuredReply(nested);
      expect(parsed.ok).toBe(true);
      expect(parsed.source).toBe("json");
      expect(parsed.messages).toEqual(["被你揣测到了 这话说得倒老实"]);
    });

    it("parses valid JSON with messages array normally", () => {
      const valid = JSON.stringify({
        messages: ["晚上好", "在忙什么呢"],
      });
      const parsed = parseStructuredReply(valid);
      expect(parsed.ok).toBe(true);
      expect(parsed.source).toBe("json");
      expect(parsed.messages).toEqual(["晚上好", "在忙什么呢"]);
    });

    it("rejects code blocks that cannot be parsed as valid JSON messages", () => {
      const codeBlock = "```javascript\nconsole.log('hello');\n```";
      const parsed = parseStructuredReply(codeBlock);
      expect(parsed.ok).toBe(false);
      expect(parsed.messages).toHaveLength(0);
    });

    it("filters out any rogue code segment inside legacy text format", () => {
      const mixed = "在呢 你说|||{\"type\": \"json_object\"}|||刚在洗漱";
      const parsed = parseStructuredReply(mixed);
      expect(parsed.ok).toBe(true);
      expect(parsed.messages).toEqual(["在呢 你说", "刚在洗漱"]);
    });
  });

  describe("capReplyLength", () => {
    it("returns empty string when input is truncated JSON code from incident", () => {
      const capped = capReplyLength(INCIDENT_RAW_OUTPUT, "你是程序员吗");
      expect(capped).toBe("");
    });

    it("handles valid structured reply correctly", () => {
      const valid = JSON.stringify({ messages: ["晚上好 在忙什么呢"] });
      expect(capReplyLength(valid, "你好")).toBe("晚上好 在忙什么呢");
    });

    it("preserves a short QQ line without corruption", () => {
      const qqLine = "想聊就加我QQ|||12345678";
      expect(capReplyLength(qqLine, "好的")).toBe(qqLine);
    });

    it("asks the model to rewrite an unsplittable overlong reply instead of cutting it", () => {
      expect(needsReplyLengthRewrite("今天晚上我真的很想和你好好聊一会儿天")).toBe(true);
      expect(needsReplyLengthRewrite("我今晚真的很想你，你现在睡了没有")).toBe(false);
      expect(needsReplyLengthRewrite("在的")).toBe(false);
    });
  });

  describe("sanitizeAssistantReply & sanitizeMachineCodeLeak", () => {
    it("strips machine code and truncated JSON completely", () => {
      const result = sanitizeMachineCodeLeak(INCIDENT_RAW_OUTPUT, "在呢 你说");
      expect(result).toBe("在呢 你说");

      const sanitized = sanitizeAssistantReply(INCIDENT_RAW_OUTPUT);
      expect(sanitized).toBe("");
    });

    it("preserves normal human conversations", () => {
      const normal = "刚好收拾完坐下|||今天一天忙晕了";
      expect(sanitizeMachineCodeLeak(normal)).toBe(normal);
      expect(sanitizeAssistantReply(normal)).toBe(normal);
    });
  });
});
