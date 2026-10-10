import { describe, expect, it } from "vitest";

import {
  extractTags,
  findUnknownTags,
  isOfficialTag,
  normalizeTag,
  stripAllTags,
  stripUnknownTags,
  tagKind,
} from "../functions/api/_emotion_tags";
import {
  MAX_EFFECT_TAGS_PER_REPLY,
  MAX_SEGMENTS,
  MIN_TAG_INTENSITY,
  neutralPlan,
  parseEmotionPlan,
  renderTaggedText,
  validateTaggedText,
} from "../functions/api/_emotion_plan";
import {
  DECAY_PER_HOUR,
  NEUTRAL_AFTER_MS,
  NEUTRAL_STATE,
  decodeState,
  decay,
  encodeState,
  isStrongReversal,
  nextState,
  updateFromPlan,
  type EmotionState,
} from "../functions/api/_emotion_state";

describe("官方标签库", () => {
  it("认得官方标签，大小写和空格都容忍", () => {
    expect(isOfficialTag("happy")).toBe(true);
    expect(isOfficialTag("HAPPY")).toBe(true);
    expect(isOfficialTag("  soft   tone ")).toBe(true);
    expect(normalizeTag("SOFT TONE")).toBe("soft tone");
  });

  it("拒绝大模型自己造的标签", () => {
    expect(isOfficialTag("有点委屈")).toBe(false);
    expect(isOfficialTag("very happy")).toBe(false);
    expect(normalizeTag("有点委屈")).toBeNull();
  });

  it("分得清标签类别", () => {
    expect(tagKind("happy")).toBe("basic");
    expect(tagKind("anxious")).toBe("advanced");
    expect(tagKind("whispering")).toBe("tone");
    expect(tagKind("sobbing")).toBe("effect");
    expect(tagKind("break")).toBe("special");
  });

  it("能抠出文本里的标签并挑出非官方的", () => {
    const text = "[happy] 好呀 [有点委屈] 那算了 [break] 嗯";
    expect(extractTags(text)).toEqual(["happy", "有点委屈", "break"]);
    expect(findUnknownTags(text)).toEqual(["有点委屈"]);
  });

  it("删掉非官方标签时保留正文", () => {
    expect(stripUnknownTags("[happy] 好呀 [乱写] 那算了")).toBe("[happy] 好呀 那算了");
  });

  it("去掉全部标签只留正文", () => {
    expect(stripAllTags("[happy] 好呀 [break] 嗯")).toBe("好呀 嗯");
  });
});

describe("表演计划解析", () => {
  it("正常计划按原样读出来", () => {
    const plan = parseEmotionPlan(
      {
        reply_text: "我怎么可能不在乎你。",
        dominant_emotion: "hurt",
        intensity: 0.72,
        segments: [
          { text: "我怎么可能不在乎你，", emotion: "hurt", intensity: 0.68 },
          { text: "只是刚才不知道怎么跟你说。", emotion: "warm", intensity: 0.52 },
        ],
      },
      ""
    );
    expect(plan.replyText).toBe("我怎么可能不在乎你。");
    expect(plan.dominantEmotion).toBe("hurt");
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[1].emotion).toBe("warm");
  });

  it("读不出来的情绪一律当中性，不崩", () => {
    const plan = parseEmotionPlan(
      { reply_text: "嗯", dominant_emotion: "暴怒", segments: [] },
      ""
    );
    expect(plan.dominantEmotion).toBe("neutral");
  });

  it("坏 JSON 回退成中性而不是让回复失败", () => {
    expect(parseEmotionPlan(null, "兜底文字").replyText).toBe("兜底文字");
    expect(parseEmotionPlan(42, "兜底文字").dominantEmotion).toBe("neutral");
    expect(parseEmotionPlan({}, "兜底文字").segments).toHaveLength(1);
  });

  it("直接给字符串就整条按一个情绪说", () => {
    const plan = parseEmotionPlan("就这一句", "");
    expect(plan.replyText).toBe("就这一句");
    expect(plan.segments).toHaveLength(1);
  });

  it("分段数量被卡住，防止每个逗号都变成新情绪", () => {
    const segments = Array.from({ length: 8 }, (_, i) => ({
      text: `第${i}段`,
      emotion: "warm",
      intensity: 0.6,
    }));
    expect(parseEmotionPlan({ reply_text: "", segments }, "").segments)
      .toHaveLength(MAX_SEGMENTS);
  });

  it("effects 里混进来的情绪标签被挡掉", () => {
    const plan = parseEmotionPlan(
      {
        reply_text: "嗯",
        segments: [{ text: "嗯", emotion: "neutral", intensity: 0.5, effects: ["happy", "sighing", "乱写"] }],
      },
      ""
    );
    // happy 是情绪不是效果，乱写不是官方标签，只有 sighing 留下。
    expect(plan.segments[0].effects).toEqual(["sighing"]);
  });

  it("强度被夹到 0..1", () => {
    expect(parseEmotionPlan({ reply_text: "嗯", intensity: 9 }, "").intensity).toBe(1);
    expect(parseEmotionPlan({ reply_text: "嗯", intensity: -3 }, "").intensity).toBe(0);
  });
});

describe("渲染带标签的 TTS 文本", () => {
  it("中性且强度低时不加标签", () => {
    const text = renderTaggedText(neutralPlan("嗯，知道了"));
    expect(text).toBe("嗯，知道了");
    expect(extractTags(text)).toHaveLength(0);
  });

  it("强度够就加上对应的官方情绪标签", () => {
    const text = renderTaggedText({
      replyText: "我怎么可能不在乎你",
      dominantEmotion: "hurt",
      intensity: 0.8,
      segments: [{ text: "我怎么可能不在乎你", emotion: "hurt", intensity: 0.8, effects: [] }],
    });
    expect(text).toBe("[upset] 我怎么可能不在乎你");
  });

  it("强度低于门槛就不加情绪标签", () => {
    const text = renderTaggedText({
      replyText: "嗯",
      dominantEmotion: "hurt",
      intensity: MIN_TAG_INTENSITY - 0.01,
      segments: [{ text: "嗯", emotion: "hurt", intensity: MIN_TAG_INTENSITY - 0.01, effects: [] }],
    });
    expect(text).toBe("嗯");
  });

  it("辅助效果标签总数被卡住", () => {
    const text = renderTaggedText({
      replyText: "",
      dominantEmotion: "happy",
      intensity: 0.9,
      segments: [
        { text: "一", emotion: "happy", intensity: 0.9, effects: ["laughing", "sighing"] },
        { text: "二", emotion: "happy", intensity: 0.9, effects: ["chuckling"] },
      ],
    });
    expect(extractTags(text).filter((t) => tagKind(t) === "effect"))
      .toHaveLength(MAX_EFFECT_TAGS_PER_REPLY);
  });

  it("非官方标签不会出现在结果里", () => {
    const text = renderTaggedText({
      replyText: "",
      dominantEmotion: "neutral",
      intensity: 0.5,
      segments: [{ text: "嗯", emotion: "neutral", intensity: 0.5, effects: ["乱写的标签"] }],
    });
    expect(text).toBe("嗯");
  });

  it("分段之间用空格接起来", () => {
    const text = renderTaggedText({
      replyText: "",
      dominantEmotion: "hurt",
      intensity: 0.8,
      segments: [
        { text: "前半句，", emotion: "hurt", intensity: 0.8, effects: [] },
        { text: "后半句。", emotion: "warm", intensity: 0.6, effects: [] },
      ],
    });
    expect(text).toBe("[upset] 前半句， [soft tone] 后半句。");
  });
});

describe("发出去之前的标签校验", () => {
  it("全是官方标签就通过", () => {
    expect(validateTaggedText("[upset] 我怎么可能不在乎你").ok).toBe(true);
  });

  it("有非官方标签就不通过", () => {
    const check = validateTaggedText("[happy] 好 [有点委屈] 算了");
    expect(check.ok).toBe(false);
    expect(check.unknownTags).toEqual(["有点委屈"]);
  });

  it("标签数量失控也不通过", () => {
    const check = validateTaggedText("[happy][sad][angry][cold][warm][break] 嗯");
    expect(check.ok).toBe(false);
    expect(check.tagCount).toBeGreaterThan(MAX_SEGMENTS + MAX_EFFECT_TAGS_PER_REPLY);
  });
});

describe("跨轮情绪状态", () => {
  const baseTime = 1_800_000_000_000;

  function stateOf(over: Partial<EmotionState>): EmotionState {
    return { ...NEUTRAL_STATE, ...over, updatedAtMs: baseTime };
  }

  it("长时间没消息会衰减回中性", () => {
    const hurt = stateOf({ primary: "hurt", intensity: 0.8, unresolved: true });
    const afterOneHour = decay(hurt, baseTime + 60 * 60 * 1000);
    expect(afterOneHour.intensity).toBeCloseTo(0.8 - DECAY_PER_HOUR, 5);
    const muchLater = decay(hurt, baseTime + NEUTRAL_AFTER_MS + 1);
    expect(muchLater.primary).toBe("neutral");
    expect(muchLater.intensity).toBe(0);
  });

  it("没解决的冲突不让一句话翻到情绪另一头", () => {
    const hurt = stateOf({ primary: "crying", intensity: 0.8, unresolved: true });
    const next = nextState(
      hurt,
      { primary: "happy", intensity: 0.9, unresolved: false },
      baseTime + 1000
    );
    expect(next.primary).toBe("crying");
    expect(next.unresolved).toBe(true);
    expect(next.intensity).toBeLessThan(0.8);
  });

  it("冲突解决之后允许回落", () => {
    const hurt = stateOf({ primary: "crying", intensity: 0.8, unresolved: false });
    const next = nextState(
      hurt,
      { primary: "happy", intensity: 0.7, unresolved: false },
      baseTime + 1000
    );
    expect(next.primary).toBe("happy");
    expect(next.intensity).toBe(0.7);
  });

  it("不是强反向跳变时照常更新", () => {
    const hurt = stateOf({ primary: "hurt", intensity: 0.6, unresolved: true });
    const next = nextState(hurt, { primary: "sad", intensity: 0.7 }, baseTime + 1000);
    expect(next.primary).toBe("sad");
    expect(next.momentum).toBe("rising");
  });

  it("强度在降的时候 momentum 是 falling", () => {
    const angry = stateOf({ primary: "angry", intensity: 0.9 });
    const next = nextState(angry, { primary: "irritated", intensity: 0.4 }, baseTime + 1000);
    expect(next.momentum).toBe("falling");
  });

  it("幅度不到阈值就不算强反向跳变", () => {
    expect(isStrongReversal("hurt", "sad")).toBe(false);
    expect(isStrongReversal("crying", "happy")).toBe(true);
  });

  it("状态能存能读，坏数据当没事发生", () => {
    const state = stateOf({ primary: "hurt", intensity: 0.66, unresolved: true });
    expect(decodeState(encodeState(state))).toEqual(state);
    expect(decodeState("这不是 JSON")).toEqual(NEUTRAL_STATE);
    expect(decodeState(undefined)).toEqual(NEUTRAL_STATE);
    expect(decodeState('{"primary":"暴怒"}').primary).toBe("neutral");
  });

  it("能从表演计划推出状态更新", () => {
    const update = updateFromPlan({
      plan: parseEmotionPlan(
        {
          reply_text: "嗯",
          dominant_emotion: "hurt",
          intensity: 0.7,
          segments: [
            { text: "前半", emotion: "hurt", intensity: 0.7 },
            { text: "后半", emotion: "warm", intensity: 0.5 },
          ],
        },
        ""
      ),
      trigger: "对方质疑",
      unresolved: true,
    });
    expect(update.primary).toBe("hurt");
    expect(update.secondary).toBe("warm");
    expect(update.unresolved).toBe(true);
  });
});
