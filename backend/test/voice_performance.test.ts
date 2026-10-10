import { describe, expect, it, vi } from "vitest";

import { stripAllTags } from "../functions/api/_emotion_tags";
import { decodeState, NEUTRAL_STATE } from "../functions/api/_emotion_state";
import {
  buildPerformanceMessages,
  fallbackPerformance,
  finalizePerformance,
  requestVoicePerformance,
  type VoicePerformanceInput,
} from "../functions/api/_voice_performance";

const REPLY = "我怎么可能不在乎你，只是刚才不知道怎么跟你说。";

/**
 * "说了什么"的比较口径：去掉标签、再去掉空白。
 *
 * 渲染时会在标签后面和分段之间留空格 —— 对中文 TTS 来说那正好是停顿位置，
 * 不会改变念出来的内容。所以这里比的是**非空白字符**。
 */
function squash(value: string): string {
  return stripAllTags(value).replace(/\s+/gu, "");
}

function input(over: Partial<VoicePerformanceInput> = {}): VoicePerformanceInput {
  return { replyText: REPLY, nowMs: 1_800_000_000_000, ...over };
}

function goodPlan() {
  return {
    reply_text: REPLY,
    dominant_emotion: "hurt",
    intensity: 0.72,
    unresolved: false,
    trigger: "对方质疑她不在乎",
    reply_intent: "解释，但留一点委屈",
    segments: [
      { text: "我怎么可能不在乎你，", emotion: "hurt", intensity: 0.68 },
      { text: "只是刚才不知道怎么跟你说。", emotion: "warm", intensity: 0.52 },
    ],
  };
}

describe("给模型的提示词", () => {
  it("原话被完整带上，并要求逐字照抄", () => {
    const messages = buildPerformanceMessages(input(), NEUTRAL_STATE);
    const all = messages.map((m) => m.content).join("\n");
    expect(all).toContain(REPLY);
    expect(all).toContain("一个字都不能改");
  });

  it("明确要求不要自己写方括号标签", () => {
    const messages = buildPerformanceMessages(input(), NEUTRAL_STATE);
    expect(messages[0].content).toContain("不要自己写 [方括号] 标签");
  });

  it("带上上一轮情绪状态，好让情绪连起来", () => {
    const state = { ...NEUTRAL_STATE, primary: "hurt" as const, intensity: 0.7 };
    const messages = buildPerformanceMessages(input(), state);
    expect(messages[1].content).toContain("\"primary\":\"hurt\"");
  });
});

describe("收敛成 TTS 文本", () => {
  it("正常计划渲染成带官方标签的文本", () => {
    const result = finalizePerformance(goodPlan(), input());
    expect(result.planned).toBe(true);
    expect(result.taggedText).toContain("[upset]");
    expect(result.taggedText).toContain("[soft tone]");
    expect(result.dominantEmotion).toBe("hurt");
  });

  it("去掉标签之后必须和原话一模一样", () => {
    // 这是整个表演层最重要的不变式：只能决定怎么说，不能改说什么。
    const result = finalizePerformance(goodPlan(), input());
    expect(squash(result.taggedText)).toBe(squash(REPLY));
  });

  it("模型自己造的标签会被清掉", () => {
    const plan = goodPlan();
    plan.segments[0] = { ...plan.segments[0], text: "我怎么可能不在乎你，", effects: ["超级委屈"] } as never;
    const result = finalizePerformance(
      { ...plan, segments: [{ ...plan.segments[0], effects: ["超级委屈"] }, plan.segments[1]] },
      input()
    );
    expect(result.taggedText).not.toContain("超级委屈");
    expect(squash(result.taggedText)).toBe(squash(REPLY));
  });

  it("坏计划不崩，退回原话", () => {
    const result = finalizePerformance(null, input());
    expect(result.taggedText).toBe(REPLY);
    expect(squash(result.taggedText)).toBe(squash(REPLY));
  });

  it("情绪带着上一轮走：未解决的冲突不许翻到另一头", () => {
    const previous = JSON.stringify({
      ...NEUTRAL_STATE,
      primary: "crying",
      intensity: 0.85,
      unresolved: true,
      updatedAtMs: 1_800_000_000_000,
    });
    const result = finalizePerformance(
      { ...goodPlan(), dominant_emotion: "happy", intensity: 0.9 },
      input({ previousState: previous })
    );
    const state = decodeState(result.stateJson);
    expect(state.primary).toBe("crying");
    expect(state.unresolved).toBe(true);
  });

  it("上一轮冲突已解决时允许回落", () => {
    const previous = JSON.stringify({
      ...NEUTRAL_STATE,
      primary: "crying",
      intensity: 0.85,
      unresolved: false,
      updatedAtMs: 1_800_000_000_000,
    });
    const result = finalizePerformance(
      { ...goodPlan(), dominant_emotion: "happy", intensity: 0.8 },
      input({ previousState: previous })
    );
    expect(decodeState(result.stateJson).primary).toBe("happy");
  });
});

describe("兜底", () => {
  it("兜底时原样用回复文字，并标记没走成模型", () => {
    const result = fallbackPerformance(input(), "deepseek_not_configured");
    expect(result.taggedText).toBe(REPLY);
    expect(result.planned).toBe(false);
    expect(result.reason).toBe("deepseek_not_configured");
  });
});

describe("调模型这条链路", () => {
  function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return {
      ok,
      status,
      json: async () => body,
    } as unknown as Response;
  }

  it("没配 key 就不发请求，直接兜底", async () => {
    const fetchMock = vi.fn();
    const result = await requestVoicePerformance({}, input(), fetchMock as never);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.planned).toBe(false);
    expect(result.taggedText).toBe(REPLY);
  });

  it("上游非 200 也兜底，不往外抛", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, false, 503));
    const result = await requestVoicePerformance(
      { DEEPSEEK_API_KEY: "k" }, input(), fetchMock as never
    );
    expect(result.planned).toBe(false);
    expect(result.reason).toBe("performance_upstream_error");
  });

  it("返回不是 JSON 也兜底", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: "我不知道该说什么" } }] })
    );
    const result = await requestVoicePerformance(
      { DEEPSEEK_API_KEY: "k" }, input(), fetchMock as never
    );
    expect(result.planned).toBe(false);
    expect(result.taggedText).toBe(REPLY);
  });

  it("网络异常也兜底", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("boom");
    });
    const result = await requestVoicePerformance(
      { DEEPSEEK_API_KEY: "k" }, input(), fetchMock as never
    );
    expect(result.planned).toBe(false);
    expect(result.reason).toBe("performance_request_failed");
  });

  it("正常返回就渲染出带标签的文本", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: JSON.stringify(goodPlan()) } }] })
    );
    const result = await requestVoicePerformance(
      { DEEPSEEK_API_KEY: "k" }, input(), fetchMock as never
    );
    expect(result.planned).toBe(true);
    expect(squash(result.taggedText)).toBe(squash(REPLY));
    // 请求确实打到了 chat/completions，而且是 JSON 模式
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/chat/completions");
    expect(String(init.body)).toContain("json_object");
  });

  it("模型把 JSON 裹在代码块里也能读出来", async () => {
    const wrapped = "```json\n" + JSON.stringify(goodPlan()) + "\n```";
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: wrapped } }] })
    );
    const result = await requestVoicePerformance(
      { DEEPSEEK_API_KEY: "k" }, input(), fetchMock as never
    );
    expect(result.planned).toBe(true);
    expect(squash(result.taggedText)).toBe(squash(REPLY));
  });
});

describe("提示词不能再让模型一律选 neutral", () => {
  it("每个情绪都带中文含义，否则模型分不清差别", () => {
    const system = buildPerformanceMessages(input(), NEUTRAL_STATE)[0].content;
    for (const gloss of ["温柔", "委屈", "不耐烦", "冷淡", "心疼对方"]) {
      expect(system).toContain(gloss);
    }
  });

  it("neutral 排在最后，并且写明是兜底项", () => {
    // 之前 neutral 排在清单第一个，模型被锚死在它上面：三轮回测全是 neutral、一个标签都没打。
    const system = buildPerformanceMessages(input(), NEUTRAL_STATE)[0].content;
    expect(system.indexOf("neutral =")).toBeGreaterThan(system.indexOf("warm ="));
    expect(system).toContain("只有在真的没有一点情绪时才用");
    expect(system).toContain("只要有一点点情绪就别写 neutral");
  });

  it("原样带出模型选的词，方便看出它是不是选了清单外的", () => {
    const result = finalizePerformance(
      { reply_text: REPLY, dominant_emotion: "exhausted", segments: [] },
      input()
    );
    // exhausted 不在清单里 → 解析成 neutral、不打标签，但 rawEmotion 要看得到它，
    // 这样下次再出现"模型想表达某个清单没有的情绪"时一眼就能发现。
    expect(result.rawEmotion).toBe("exhausted");
    expect(result.taggedText).toBe(REPLY);
  });

  it("清单内的词照常打标签，效果标签也带上", () => {    const result = finalizePerformance(
      {
        reply_text: REPLY,
        dominant_emotion: "hurt",
        intensity: 0.8,
        segments: [{ text: REPLY, emotion: "hurt", intensity: 0.8, effects: ["sighing"] }],
      },
      input()
    );
    expect(result.rawEmotion).toBe("hurt");
    expect(result.taggedText).toContain("[upset]");
    expect(result.taggedText).toContain("[sighing]");
  });

  it("两段情绪相同时只写一个标签", () => {
    // Fish 的标签是粘性的，不换就一直生效；重复写等于同一个语气被打两次标记，
    // 实测出现过 [chuckling] A [chuckling] B。
    const result = finalizePerformance(
      {
        reply_text: "",
        dominant_emotion: "playful",
        intensity: 0.6,
        segments: [
          { text: "前半句。", emotion: "playful", intensity: 0.6 },
          { text: "后半句。", emotion: "playful", intensity: 0.6 },
        ],
      },
      input()
    );
    expect(result.taggedText).toBe("[chuckling] 前半句。 后半句。");
  });

  it("两段情绪不同时两个标签都要写", () => {
    const result = finalizePerformance(
      {
        reply_text: "",
        dominant_emotion: "hurt",
        intensity: 0.8,
        segments: [
          { text: "前半句。", emotion: "hurt", intensity: 0.8 },
          { text: "后半句。", emotion: "warm", intensity: 0.6 },
        ],
      },
      input()
    );
    expect(result.taggedText).toBe("[upset] 前半句。 [soft tone] 后半句。");
  });

  it("累和无奈也有标签，不会因为清单没这一项就退成 neutral", () => {
    // 实测踩过的坑：这个人物常说"忙了一天有点累"，原来清单里没有对应项，
    // 模型只能选 neutral，于是这条语音一个标签都没有。
    const tired = finalizePerformance(
      {
        reply_text: REPLY,
        dominant_emotion: "tired",
        intensity: 0.6,
        segments: [{ text: REPLY, emotion: "tired", intensity: 0.6 }],
      },
      input()
    );
    expect(tired.rawEmotion).toBe("tired");
    expect(tired.taggedText).toContain("[soft tone]");

    const resigned = finalizePerformance(
      {
        reply_text: REPLY,
        dominant_emotion: "resigned",
        intensity: 0.6,
        segments: [{ text: REPLY, emotion: "resigned", intensity: 0.6 }],
      },
      input()
    );
    expect(resigned.rawEmotion).toBe("resigned");
    expect(resigned.taggedText).toContain("[resigned]");
  });
});
