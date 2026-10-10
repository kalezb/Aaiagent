/**
 * 情绪表演层：决定"怎么说"。
 *
 * 分工（按方案文档 §2.1 / §6.1）：
 * - 大模型只决定**内部情绪**（委屈、嘴硬、温柔……）和分段
 * - **由这里**把内部情绪翻成 Fish Audio 认得的官方标签
 * - 大模型不直接写 `[标签]`：它造出来的标签 Fish 认不出来，轻则无效、
 *   重则把方括号当正文念出来
 *
 * 标签密度也是有讲究的：标签越多不等于越真实。每段一个主情绪、
 * 整条回复最多加一两个辅助效果、中性内容不加标签、高峰情绪只出现在真正要强调的句子。
 */

import {
  findUnknownTags,
  normalizeTag,
  tagKind,
  extractTags,
} from "./_emotion_tags";

export const INTERNAL_EMOTIONS = [
  "neutral",
  "warm",
  "happy",
  "playful",
  "sad",
  "hurt",
  "crying",
  "angry",
  "irritated",
  "cold",
  "anxious",
  "apologetic",
  "comforting",
  // 实测补的两个：这个人物经常"忙了一天有点累"和"算了，无所谓"，
  // 原来清单里没有对应项，模型只能退到 neutral、一个标签都打不上。
  "tired",
  "resigned",
] as const;

export type InternalEmotion = (typeof INTERNAL_EMOTIONS)[number];

/**
 * 内部情绪 → Fish 官方标签。
 * `null` 表示"不加标签"（中性内容强行加标签反而假）。
 */
const EMOTION_TO_TAG: Record<InternalEmotion, string | null> = {
  neutral: null,
  warm: "soft tone",
  happy: "happy",
  playful: "chuckling",
  sad: "sad",
  hurt: "upset",
  crying: "sobbing",
  angry: "angry",
  irritated: "unhappy",
  cold: "indifferent",
  anxious: "anxious",
  apologetic: "guilty",
  comforting: "empathetic",
  // 累了说话会放轻放慢 —— 用"轻柔"而不是硬套一个情绪标签。
  tired: "soft tone",
  // "算了，无所谓"正好对应官方的"认命"。
  resigned: "resigned",
};

/** 短回复只 1 段；稍长 2-3 段。再多就把一个逗号都变成新情绪了。 */
export const MAX_SEGMENTS = 3;

/** 整条回复最多加几个辅助效果标签。 */
export const MAX_EFFECT_TAGS_PER_REPLY = 2;

/** 强度低于这个值就不加情绪标签 —— 轻轻的情绪靠文字表达就够了。 */
export const MIN_TAG_INTENSITY = 0.35;

export interface EmotionSegment {
  text: string;
  emotion: InternalEmotion;
  intensity: number;
  effects: string[];
}

export interface EmotionPlan {
  replyText: string;
  dominantEmotion: InternalEmotion;
  intensity: number;
  segments: EmotionSegment[];
}

export function isInternalEmotion(value: unknown): value is InternalEmotion {
  return typeof value === "string" &&
    (INTERNAL_EMOTIONS as readonly string[]).includes(value);
}

/** 强度统一夹到 0..1；读不出来就用 fallback。 */
export function clampIntensity(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
}

/** 不加任何标签的中性计划 —— 解析失败时的兜底。 */
export function neutralPlan(replyText: string): EmotionPlan {
  const text = String(replyText ?? "").trim();
  return {
    replyText: text,
    dominantEmotion: "neutral",
    intensity: 0,
    segments: text ? [{ text, emotion: "neutral", intensity: 0, effects: [] }] : [],
  };
}

function parseSegment(raw: unknown): EmotionSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const text = String(item.text ?? "").trim();
  if (!text) return null;
  const emotion = isInternalEmotion(item.emotion) ? item.emotion : "neutral";
  const effects: string[] = [];
  if (Array.isArray(item.effects)) {
    for (const value of item.effects) {
      const normalized = normalizeTag(String(value ?? ""));
      // 只收"效果类"的标签；情绪标签由 emotion 字段负责，不许从这里混进来。
      if (!normalized) continue;
      const kind = tagKind(normalized);
      if (kind === "effect" || kind === "special" || kind === "tone") {
        effects.push(normalized);
      }
    }
  }
  return { text, emotion, intensity: clampIntensity(item.intensity, 0.5), effects };
}

/**
 * 容错解析大模型给的表演计划。
 *
 * **任何一步读不出来都回退成中性**，绝不因为一段坏 JSON 就整条回复不发。
 * 也接受直接给字符串（那就是"整条按一个情绪说"）。
 */
export function parseEmotionPlan(raw: unknown, fallbackText: string): EmotionPlan {
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return neutralPlan(fallbackText);
    return neutralPlan(text);
  }
  if (!raw || typeof raw !== "object") return neutralPlan(fallbackText);
  const item = raw as Record<string, unknown>;

  const replyText = String(
    item.reply_text ?? item.replyText ?? fallbackText ?? ""
  ).trim();

  const segments: EmotionSegment[] = [];
  if (Array.isArray(item.segments)) {
    for (const value of item.segments) {
      const segment = parseSegment(value);
      if (segment) segments.push(segment);
      if (segments.length >= MAX_SEGMENTS) break;
    }
  }

  const dominantEmotion = isInternalEmotion(item.dominant_emotion)
    ? item.dominant_emotion
    : (isInternalEmotion(item.dominantEmotion) ? item.dominantEmotion : "neutral");
  const intensity = clampIntensity(
    item.intensity,
    segments.length ? segments[0].intensity : 0.5
  );

  if (!segments.length) {
    if (!replyText) return neutralPlan(fallbackText);
    return {
      replyText,
      dominantEmotion,
      intensity,
      segments: [{ text: replyText, emotion: dominantEmotion, intensity, effects: [] }],
    };
  }

  return {
    replyText: replyText || segments.map((s) => s.text).join(" "),
    dominantEmotion,
    intensity,
    segments,
  };
}

/**
 * 把表演计划渲染成"带官方标签的 TTS 文本"。
 *
 * 密度规则都在这里落地：
 * - 一段只有一个主情绪标签
 * - 中性或强度太低 → 不加情绪标签
 * - 整条回复的辅助效果标签总共不超过 [MAX_EFFECT_TAGS_PER_REPLY] 个
 * - 非官方标签一律丢掉
 */
export function renderTaggedText(plan: EmotionPlan): string {
  const segments = plan.segments.length
    ? plan.segments.slice(0, MAX_SEGMENTS)
    : [{ text: plan.replyText, emotion: "neutral" as InternalEmotion, intensity: 0, effects: [] }];

  let effectBudget = MAX_EFFECT_TAGS_PER_REPLY;
  const rendered: string[] = [];
  // Fish 的情绪标签是**粘性**的：不换就一直生效。
  // 所以第二段跟第一段情绪相同时不用再写一遍 —— 写了就是同一个语气被打两次标记。
  let lastEmotionTag: string | null = null;

  for (const segment of segments) {
    const body = String(segment.text ?? "").trim();
    if (!body) continue;

    const tags: string[] = [];
    const emotionTag = EMOTION_TO_TAG[segment.emotion] ?? null;
    if (emotionTag && segment.intensity >= MIN_TAG_INTENSITY && emotionTag !== lastEmotionTag) {
      tags.push(emotionTag);
      lastEmotionTag = emotionTag;
    }
    for (const raw of segment.effects) {
      if (effectBudget <= 0) break;
      const normalized = normalizeTag(raw);
      if (!normalized) continue;
      if (tags.includes(normalized)) continue;
      tags.push(normalized);
      effectBudget -= 1;
    }

    const prefix = tags.map((tag) => `[${tag}]`).join("");
    rendered.push(prefix ? `${prefix} ${body}` : body);
  }

  return rendered.join(" ").trim();
}

export interface TaggedTextCheck {
  ok: boolean;
  unknownTags: string[];
  tagCount: number;
}

/**
 * 发给 Fish 之前的最后一道闸：有没有非官方标签、标签数量是否失控。
 * `ok=false` 时调用方应当用 stripUnknownTags 清一遍再发。
 */
export function validateTaggedText(text: string): TaggedTextCheck {
  const value = String(text ?? "");
  const unknownTags = findUnknownTags(value);
  const tagCount = extractTags(value).length;
  const limit = MAX_SEGMENTS + MAX_EFFECT_TAGS_PER_REPLY;
  return {
    ok: unknownTags.length === 0 && tagCount <= limit,
    unknownTags,
    tagCount,
  };
}
