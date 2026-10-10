/**
 * Fish Audio 官方「情绪 / 效果」标签库。
 *
 * 标签以 `[tag]` 的形式写进 TTS 文本里。这份清单对应 S2 系列的官方 Emotion Control，
 * 与 FishVoice 里那份整理保持一致（基础情绪 24 / 进阶情绪 25 / 语气 6 / 音效 11 / 特效 5）。
 *
 * **为什么要有这份清单**：不能放任大模型自己造标签。它造出来的 `[有点委屈]`
 * 这种 Fish 认不出来，轻则无效、重则把方括号当正文念出来。
 * 所以链路固定为：大模型决定**内部情绪** → 这里的映射器翻成官方标签。
 * 官方标签表变了，只改这一层，不用动提示词和回复逻辑。
 */

export type FishTagKind = "basic" | "advanced" | "tone" | "effect" | "special";

export interface FishTag {
  /** 中文名，只用于日志和人工看。 */
  label: string;
  /** 写进 TTS 文本的实际标签，不含方括号。 */
  tag: string;
  kind: FishTagKind;
}

export const FISH_TAGS: readonly FishTag[] = [
  // 基础情绪
  ...[
    ["开心", "happy"],
    ["难过", "sad"],
    ["生气", "angry"],
    ["激动", "excited"],
    ["平静", "calm"],
    ["紧张", "nervous"],
    ["自信", "confident"],
    ["惊讶", "surprised"],
    ["满足", "satisfied"],
    ["愉悦", "delighted"],
    ["害怕", "scared"],
    ["担忧", "worried"],
    ["委屈", "upset"],
    ["沮丧", "frustrated"],
    ["低落", "depressed"],
    ["共情", "empathetic"],
    ["尴尬", "embarrassed"],
    ["厌恶", "disgusted"],
    ["感动", "moved"],
    ["自豪", "proud"],
    ["放松", "relaxed"],
    ["感激", "grateful"],
    ["好奇", "curious"],
    ["嘲讽", "sarcastic"],
  ].map(([label, tag]) => ({ label, tag, kind: "basic" as const })),
  // 进阶情绪
  ...[
    ["轻蔑", "disdainful"],
    ["不满", "unhappy"],
    ["焦虑", "anxious"],
    ["歇斯底里", "hysterical"],
    ["无所谓", "indifferent"],
    ["犹豫", "uncertain"],
    ["怀疑", "doubtful"],
    ["困惑", "confused"],
    ["失望", "disappointed"],
    ["后悔", "regretful"],
    ["愧疚", "guilty"],
    ["羞愧", "ashamed"],
    ["嫉妒", "jealous"],
    ["羡慕", "envious"],
    ["期待", "hopeful"],
    ["乐观", "optimistic"],
    ["悲观", "pessimistic"],
    ["怀念", "nostalgic"],
    ["孤单", "lonely"],
    ["无聊", "bored"],
    ["鄙视", "contemptuous"],
    ["同情", "sympathetic"],
    ["心疼", "compassionate"],
    ["坚定", "determined"],
    ["认命", "resigned"],
  ].map(([label, tag]) => ({ label, tag, kind: "advanced" as const })),
  // 语气
  ...[
    ["急促", "in a hurry tone"],
    ["喊叫", "shouting"],
    ["尖叫", "screaming"],
    ["耳语", "whispering"],
    ["轻柔", "soft tone"],
    ["强调", "emphasis"],
  ].map(([label, tag]) => ({ label, tag, kind: "tone" as const })),
  // 音效
  ...[
    ["大笑", "laughing"],
    ["轻笑", "chuckling"],
    ["抽泣", "sobbing"],
    ["大哭", "crying loudly"],
    ["叹气", "sighing"],
    ["低沉哼声", "groaning"],
    ["喘气", "panting"],
    ["倒吸一口气", "gasping"],
    ["打哈欠", "yawning"],
    ["打呼噜", "snoring"],
    ["清嗓子", "clear throat"],
  ].map(([label, tag]) => ({ label, tag, kind: "effect" as const })),
  // 特效
  ...[
    ["观众笑声", "audience laughing"],
    ["背景笑声", "background laughter"],
    ["人群笑声", "crowd laughing"],
    ["短停顿", "break"],
    ["长停顿", "long-break"],
  ].map(([label, tag]) => ({ label, tag, kind: "special" as const })),
] as readonly FishTag[];

/** 小写去空归一后的索引。标签本身不区分大小写。 */
const TAGS_BY_NORMALIZED = new Map<string, FishTag>(
  FISH_TAGS.map((item) => [normalizeTagText(item.tag), item])
);

function normalizeTagText(value: string): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/gu, " ");
}

/** 这个标签是不是官方支持的。 */
export function isOfficialTag(tag: string): boolean {
  return TAGS_BY_NORMALIZED.has(normalizeTagText(tag));
}

/** 归一成官方写法；不是官方标签返回 null。 */
export function normalizeTag(tag: string): string | null {
  return TAGS_BY_NORMALIZED.get(normalizeTagText(tag))?.tag ?? null;
}

export function tagKind(tag: string): FishTagKind | null {
  return TAGS_BY_NORMALIZED.get(normalizeTagText(tag))?.kind ?? null;
}

export function tagLabel(tag: string): string {
  return TAGS_BY_NORMALIZED.get(normalizeTagText(tag))?.label ?? tag;
}

/** 从一段文本里抠出所有 `[xxx]`。 */
export function extractTags(text: string): string[] {
  const result: string[] = [];
  const pattern = /\[([^\[\]\n]+)\]/gu;
  let match = pattern.exec(text);
  while (match) {
    const inner = match[1].trim();
    if (inner) result.push(inner);
    match = pattern.exec(text);
  }
  return result;
}

/**
 * 渲染前最后一道校验：把不是官方的标签挑出来。
 * 调用方拿到 unknown 之后应当把这些标签删掉，而不是原样发给 Fish。
 */
export function findUnknownTags(text: string): string[] {
  const unknown: string[] = [];
  for (const tag of extractTags(text)) {
    if (!isOfficialTag(tag)) unknown.push(tag);
  }
  return unknown;
}

/** 把非官方标签从文本里删掉，只留正文。 */
export function stripUnknownTags(text: string): string {
  return String(text ?? "")
    .replace(/\[([^\[\]\n]+)\]/gu, (whole, inner: string) =>
      isOfficialTag(inner) ? whole : " "
    )
    .replace(/\s+/gu, " ")
    .trim();
}

/** 去掉所有标签，只留正文。用来给"要不要发语音"做长度判断。 */
export function stripAllTags(text: string): string {
  return String(text ?? "")
    .replace(/\[([^\[\]\n]+)\]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
