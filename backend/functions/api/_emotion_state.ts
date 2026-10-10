/**
 * 跨轮情绪状态：让情绪是一条**连续的轨迹**，不是每句话随机抽一个。
 *
 * 要解决的问题（方案文档 §4.3）：没有这层记忆，会出现
 * "上一句还在哭、下一句突然很开心、再下一句又生气"这种一眼假的东西。
 *
 * 三条规则：
 * 1. **衰减** —— 长时间没有新消息，情绪慢慢回到中性，而不是永久停在最高强度。
 * 2. **惯性** —— 已经欠着没解决的冲突（`unresolved` 且强度还高）时，
 *    不允许一句话就翻到情绪的另一头；对方真道歉/示好了就把 `unresolved` 放掉，
 *    这时才允许回落。
 * 3. **不做强反向跳变** —— 从"哭"直接跳到"开心"这种，要么被判为不合理、
 *    要么必须有明确证据（也就是 `unresolved=false`）。
 */

import {
  clampIntensity,
  isInternalEmotion,
  type EmotionPlan,
  type InternalEmotion,
} from "./_emotion_plan";

export type EmotionMomentum = "rising" | "holding" | "falling";

export interface EmotionState {
  primary: InternalEmotion;
  secondary: InternalEmotion | null;
  intensity: number;
  momentum: EmotionMomentum;
  trigger: string;
  unresolved: boolean;
  replyIntent: string;
  updatedAtMs: number;
}

export const NEUTRAL_STATE: EmotionState = {
  primary: "neutral",
  secondary: null,
  intensity: 0,
  momentum: "holding",
  trigger: "",
  unresolved: false,
  replyIntent: "",
  updatedAtMs: 0,
};

/** 每小时自然衰减掉多少强度。 */
export const DECAY_PER_HOUR = 0.35;

/** 超过这么久没消息，直接当回到中性。 */
export const NEUTRAL_AFTER_MS = 2 * 60 * 60 * 1000;

/** 单轮允许的最大反向跳变幅度（没有证据时）。 */
export const MAX_REVERSAL_STEP = 0.3;

/** 情绪的正负倾向。用来判断"是不是跳到了另一头"。 */
const VALENCE: Record<InternalEmotion, number> = {
  neutral: 0,
  warm: 0.6,
  happy: 0.8,
  playful: 0.6,
  comforting: 0.3,
  sad: -0.6,
  hurt: -0.7,
  crying: -0.9,
  angry: -0.7,
  irritated: -0.4,
  cold: -0.4,
  anxious: -0.5,
  apologetic: -0.2,
};

/** 正负跨过这个幅度就算"跳到了另一头"。 */
const REVERSAL_THRESHOLD = 1.2;

export function valenceOf(emotion: InternalEmotion): number {
  return VALENCE[emotion] ?? 0;
}

/** 从"哭泣"跳到"开心"这种，就是强反向跳变。 */
export function isStrongReversal(
  from: InternalEmotion,
  to: InternalEmotion
): boolean {
  return Math.abs(valenceOf(to) - valenceOf(from)) >= REVERSAL_THRESHOLD;
}

/** 长时间没消息时按时间把强度降下来。 */
export function decay(state: EmotionState, nowMs: number): EmotionState {
  if (!state || state.updatedAtMs <= 0) return NEUTRAL_STATE;
  const elapsed = nowMs - state.updatedAtMs;
  if (elapsed <= 0) return state;
  if (elapsed >= NEUTRAL_AFTER_MS) return { ...NEUTRAL_STATE, updatedAtMs: nowMs };

  const hours = elapsed / (60 * 60 * 1000);
  const intensity = Math.max(0, state.intensity - DECAY_PER_HOUR * hours);
  if (intensity === state.intensity) return state;
  return {
    ...state,
    intensity,
    momentum: "falling",
    // 情绪已经淡了就不要再挂着"没解决"，否则她会一直冷着。
    unresolved: intensity >= 0.2 ? state.unresolved : false,
    updatedAtMs: nowMs,
  };
}

export interface EmotionUpdate {
  primary: InternalEmotion;
  secondary?: InternalEmotion | null;
  intensity: number;
  trigger?: string;
  unresolved?: boolean;
  replyIntent?: string;
}

/** 把一轮的表演计划收敛成一次状态更新。 */
export function updateFromPlan(update: {
  plan: EmotionPlan;
  trigger?: string;
  unresolved?: boolean;
  replyIntent?: string;
}): EmotionUpdate {
  const plan = update.plan;
  return {
    primary: plan.dominantEmotion,
    secondary: plan.segments.length > 1
      ? plan.segments[plan.segments.length - 1].emotion
      : null,
    intensity: clampIntensity(plan.intensity, 0.5),
    trigger: update.trigger ?? "",
    unresolved: update.unresolved ?? false,
    replyIntent: update.replyIntent ?? "",
  };
}

/**
 * 算出下一轮的情绪状态。
 *
 * 关键在 `blocked` 那一步：**欠着没解决的冲突 + 强度还高 + 想跳到情绪另一头**
 * 三条同时成立时，不允许翻脸，只允许强度往下走一点点。
 */
export function nextState(
  previous: EmotionState,
  update: EmotionUpdate,
  nowMs: number
): EmotionState {
  const base = decay(previous, nowMs);
  const target = isInternalEmotion(update.primary) ? update.primary : "neutral";
  const targetIntensity = clampIntensity(update.intensity, base.intensity);

  const blocked =
    isStrongReversal(base.primary, target) &&
    base.unresolved &&
    base.intensity >= 0.5;

  const primary = blocked ? base.primary : target;
  const intensity = blocked
    ? Math.max(0, Math.min(base.intensity, targetIntensity + MAX_REVERSAL_STEP))
    : targetIntensity;

  const momentum: EmotionMomentum = intensity > base.intensity + 0.05
    ? "rising"
    : intensity < base.intensity - 0.05
      ? "falling"
      : "holding";

  return {
    primary,
    secondary: isInternalEmotion(update.secondary) ? update.secondary : null,
    intensity,
    momentum,
    trigger: String(update.trigger ?? "").slice(0, 200),
    unresolved: blocked ? true : Boolean(update.unresolved),
    replyIntent: String(update.replyIntent ?? "").slice(0, 200),
    updatedAtMs: nowMs,
  };
}

/** 存进数据库用。 */
export function encodeState(state: EmotionState): string {
  return JSON.stringify(state);
}

/** 从数据库读回来；坏数据一律当中性处理，绝不让它把回复流程搞崩。 */
export function decodeState(raw: unknown): EmotionState {
  if (typeof raw !== "string" || !raw.trim()) return NEUTRAL_STATE;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object") return NEUTRAL_STATE;
    return {
      primary: isInternalEmotion(value.primary) ? value.primary : "neutral",
      secondary: isInternalEmotion(value.secondary) ? value.secondary : null,
      intensity: clampIntensity(value.intensity, 0),
      momentum: value.momentum === "rising" || value.momentum === "falling"
        ? value.momentum
        : "holding",
      trigger: String(value.trigger ?? "").slice(0, 200),
      unresolved: Boolean(value.unresolved),
      replyIntent: String(value.replyIntent ?? "").slice(0, 200),
      updatedAtMs: Number(value.updatedAtMs) || 0,
    };
  } catch {
    return NEUTRAL_STATE;
  }
}
