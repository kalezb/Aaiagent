/**
 * 语音表演层：把"一条已经定稿的回复"变成"带情绪标签的 TTS 文本"。
 *
 * **为什么不直接改 chat 的返回内容**：现在那条聊天管线是几百个测试和几十次真机
 * 调出来的，回复文字、清洗规则、媒体指令全缠在一起。为了加情绪去动它，
 * 风险和收益完全不对等。
 *
 * 所以做成**独立接口**：文字回复照旧走原路；只有真的要发语音时，才额外调一次
 * `/api/voice/performance` 拿"带标签的 TTS 文本"。好处是
 * 1) 现有回复流程一个字都不用改；
 * 2) 不打算发语音时（绝大多数回复）根本不产生这次调用；
 * 3) 这一层可以单独测、单独失败、单独回退 —— 调用失败就原样用回复文字，
 *    大不了没有情绪，绝不会影响文字回复本身。
 */

import {
  INTERNAL_EMOTIONS,
  parseEmotionPlan,
  renderTaggedText,
  validateTaggedText,
  type EmotionPlan,
  type InternalEmotion,
} from "./_emotion_plan";
import { stripUnknownTags } from "./_emotion_tags";
import {
  NEUTRAL_STATE,
  decay,
  decodeState,
  encodeState,
  nextState,
  updateFromPlan,
  type EmotionState,
} from "./_emotion_state";

export interface VoicePerformanceInput {
  /** 已经定稿的回复原文。表演层**只能决定怎么说，不能改说什么**。 */
  replyText: string;
  /** 最近几轮聊天的简短摘要，用来判断情绪走向。 */
  contextLines?: string[];
  /** 上一轮的情绪状态（JSON 字符串）；读不出来当中性。 */
  previousState?: string | null;
  /** 当前毫秒时间戳；测试时可注入。 */
  nowMs?: number;
}

export interface VoicePerformanceResult {
  /** 可以直接发给 Fish Audio 的文本（可能带官方标签）。 */
  taggedText: string;
  /** 更新后的情绪状态，调用方存起来，下一轮传回来。 */
  stateJson: string;
  dominantEmotion: InternalEmotion;
  /** false 表示这次没走成模型、用的是兜底。 */
  planned: boolean;
  reason?: string;
  /** 上游用量，交给调用方记账 —— 这是一次真实计费调用，不能不记。 */
  usage?: unknown;
  promptChars?: number;
  outputChars?: number;
  /**
   * 模型这次**原样**返回的 dominant_emotion。
   * 诊断用：如果它是 `tired` 这种清单外的词，就会被解析成 neutral、不打标签 ——
   * 有它才看得出到底是"模型选了 neutral"还是"模型选了别的被丢掉了"。
   */
  rawEmotion?: string;
  /**
   * 解析出来的分段（每段的情绪、强度、效果标签）。
   * 诊断用：光看渲染结果分不清"第二个 [chuckling] 是情绪标签重复了，
   * 还是模型在 effects 里又写了一次轻笑"。有它就能一眼分辨。
   */
  segments?: Array<{ text: string; emotion: string; intensity: number; effects: string[] }>;
}

export const PERFORMANCE_TIMEOUT_MS = 4_000;

/**
 * 内部情绪的中文含义。
 *
 * **必须写进提示词**：只给英文词（hurt / irritated / cold）模型分不清差别，
 * 会一律选最安全的 neutral。实测就是这么翻车的 —— trigger 字段写得非常准
 * （"对方说算了、质疑自己不在乎，心里着急又心疼"），dominant_emotion 却给了 neutral。
 */
const EMOTION_GLOSSARY: Array<[InternalEmotion, string]> = [
  ["warm", "温柔、软下来的"],
  ["happy", "开心、雀跃"],
  ["playful", "打趣、逗对方、带点坏"],
  ["sad", "难过、低落"],
  ["hurt", "委屈、被伤到但还撑着"],
  ["crying", "哭腔、快绷不住了"],
  ["angry", "真生气"],
  ["irritated", "不耐烦、有点烦"],
  ["cold", "冷淡、拉开距离"],
  ["anxious", "不安、心里没底"],
  ["apologetic", "愧疚、认错"],
  ["comforting", "心疼对方、在安慰"],
  ["tired", "累了、没力气、想歇会儿"],
  ["resigned", "无奈、算了、无所谓、认命"],
  // neutral 放最后，并且明确写成兜底项 —— 放开头会把模型锚死在它上面。
  ["neutral", "平淡、纯信息性；**只有在真的没有一点情绪时才用**"],
];

const EMOTION_LINES = EMOTION_GLOSSARY
  .map(([emotion, gloss]) => "  " + emotion + " = " + gloss)
  .join("\n");

/** 给模型看的输出结构。字段名用蛇形，和方案文档 §5.1 对齐。 */
export const PERFORMANCE_SCHEMA = JSON.stringify({
  reply_text: "原话，一个字都不许改",
  dominant_emotion: "从上面清单里挑一个，比如 hurt",
  intensity: 0.6,
  unresolved: false,
  trigger: "是什么让她变成这个情绪",
  reply_intent: "这次想达到什么效果",
  segments: [
    {
      text: "原话的一段，拼起来必须等于 reply_text",
      emotion: "同样从清单里挑一个",
      intensity: 0.6,
      effects: ["可选的官方音效标签（laughing / sighing / chuckling 等），不要自己造"],
    },
  ],
});

const SYSTEM_PROMPT = [
  "你只负责决定「这句话该怎么说」，不负责决定「说什么」。",
  "铁律：reply_text 和每段 text 必须逐字照抄用户给的原话，一个字都不能改、不能增删、不能润色。",
  "",
  "情绪必须从下面这些里挑一个（中文是它的意思）：",
  EMOTION_LINES,
  "",
  "怎么判断：先想「这句话是什么心情说出来的」，再挑最接近的那一个。",
  "只要有一点点情绪就别写 neutral —— 真实的人说话几乎不会完全没有语气。",
  "neutral 是留给「好的」「嗯，知道了」这种纯信息性回复的兜底项。",
  "",
  "不要自己写 [方括号] 标签 —— 标签由系统根据你选的情绪翻译，你写了会被丢掉。",
  "情绪要连着上一轮走：没有明显转折证据时别突然翻到另一头；",
  "对方在道歉、示好、服软时可以逐步回落。",
  "分段宁少勿多：短回复一段就够，只有语气真的转折了才分第二段。",
  "只输出 JSON，不要解释。结构：",
].join("\n");

export function buildPerformanceMessages(
  input: VoicePerformanceInput,
  previous: EmotionState
): Array<{ role: string; content: string }> {
  const context = (input.contextLines ?? [])
    .map((line) => String(line ?? "").trim())
    .filter(Boolean)
    .slice(-10)
    .join("\n");
  const user = [
    "上一轮情绪状态：" + encodeState(previous),
    context ? "最近聊天：\n" + context : "",
    "这轮要说的原话（必须逐字照抄）：\n" + input.replyText,
    "按这个结构输出 JSON：" + PERFORMANCE_SCHEMA,
  ].filter(Boolean).join("\n\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

/**
 * 把模型给的计划收敛成"带标签的 TTS 文本 + 新情绪状态"。
 *
 * 纯函数 —— 校验和兜底逻辑都在这里，是最该被测的部分。
 */
export function finalizePerformance(
  rawModelOutput: unknown,
  input: VoicePerformanceInput
): VoicePerformanceResult {
  const nowMs = input.nowMs ?? Date.now();
  const previous = decay(decodeState(input.previousState ?? null), nowMs);
  const plan: EmotionPlan = parseEmotionPlan(rawModelOutput, input.replyText);
  const rendered = renderTaggedText(plan);

  // 最后一道闸：非官方标签或标签数量失控就清一遍再发。
  const check = validateTaggedText(rendered);
  const safeText = check.ok ? rendered : stripUnknownTags(rendered);

  const raw = (rawModelOutput && typeof rawModelOutput === "object")
    ? rawModelOutput as Record<string, unknown>
    : {};
  const state = nextState(
    previous,
    updateFromPlan({
      plan,
      trigger: String(raw.trigger ?? ""),
      unresolved: Boolean(raw.unresolved),
      replyIntent: String(raw.reply_intent ?? raw.replyIntent ?? ""),
    }),
    nowMs
  );

  return {
    taggedText: safeText || input.replyText,
    stateJson: encodeState(state),
    dominantEmotion: state.primary,
    planned: true,
    rawEmotion: String(raw.dominant_emotion ?? raw.dominantEmotion ?? ""),
    segments: plan.segments.map((segment) => ({
      text: segment.text,
      emotion: segment.emotion,
      intensity: segment.intensity,
      effects: segment.effects,
    })),
  };
}

/**
 * 模型没走通时的兜底：**原样用回复文字**，只把情绪状态按时间衰减一下。
 * 宁可没有情绪，也不能因为表演层出问题就把这条语音发不出去。
 */
export function fallbackPerformance(
  input: VoicePerformanceInput,
  reason: string
): VoicePerformanceResult {
  const nowMs = input.nowMs ?? Date.now();
  const previous = decay(decodeState(input.previousState ?? null), nowMs);
  return {
    taggedText: input.replyText,
    stateJson: encodeState(previous.primary === NEUTRAL_STATE.primary
      ? previous
      : { ...previous, updatedAtMs: nowMs }),
    dominantEmotion: previous.primary,
    planned: false,
    reason,
  };
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface PerformanceEnv {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_API_BASE?: string;
  PERFORMANCE_MODEL?: string;
}

function parseModelJson(content: unknown): unknown {
  if (typeof content !== "string") return null;
  const text = content.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // 模型偶尔会裹一层 ```json，兜一下。
    const match = text.match(/\{[\s\S]*\}/u);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/**
 * 真正去调模型。任何失败（没配 key、超时、非 200、返回不是 JSON）
 * 都走 [fallbackPerformance]，绝不往外抛。
 */
export async function requestVoicePerformance(
  env: PerformanceEnv,
  input: VoicePerformanceInput,
  fetchImpl: FetchLike = fetch
): Promise<VoicePerformanceResult> {
  const key = String(env.DEEPSEEK_API_KEY ?? "").trim();
  if (!key) return fallbackPerformance(input, "deepseek_not_configured");

  const nowMs = input.nowMs ?? Date.now();
  const previous = decay(decodeState(input.previousState ?? null), nowMs);
  const base = String(env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1").replace(/\/+$/u, "");
  const messages = buildPerformanceMessages(input, previous);
  const promptChars = messages.reduce((sum, item) => sum + item.content.length, 0);

  let response: Response;
  try {
    response = await fetchImpl(base + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        model: env.PERFORMANCE_MODEL || "deepseek-flash",
        temperature: 0.3,
        max_tokens: 700,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        messages,
      }),
    });
  } catch (error) {
    return fallbackPerformance(input, "performance_request_failed");
  }
  if (!response.ok) return fallbackPerformance(input, "performance_upstream_error");

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return fallbackPerformance(input, "performance_bad_response");
  }
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content;
  const parsed = parseModelJson(content);
  if (!parsed) return fallbackPerformance(input, "performance_unparsable");

  const result = finalizePerformance(parsed, input);
  result.usage = (data as { usage?: unknown })?.usage;
  result.promptChars = promptChars;
  result.outputChars = typeof content === "string" ? content.length : 0;
  return result;
}
