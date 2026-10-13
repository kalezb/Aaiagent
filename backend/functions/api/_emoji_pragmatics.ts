import {
  DOUBAN_EMOJI_REGISTRY,
  UNICODE_EMOJI_PRAGMATIC_MAP,
  type EmojiPragmaticInfo,
} from "./_emoji_pragmatics_data";

export {
  DOUBAN_EMOJI_REGISTRY,
  type EmojiPragmaticInfo,
} from "./_emoji_pragmatics_data";

/**
 * 从文本中快速检测出所有出现的表情及其语用信息
 * （经验教训：能用代码直接算出来的，绝不让模型去猜；只提取当前这一轮用到的）
 */
export function detectEmojisInText(text: string): EmojiPragmaticInfo[] {
  if (!text || typeof text !== "string") return [];
  const found: EmojiPragmaticInfo[] = [];
  const seenTags = new Set<string>();

  // 1. 匹配自然语言叙述格式的互动表情与时段问候（Soul 等平台适配器输出）
  // 例：对方发来 Soul 互动表情「皮一下」：对方和你开玩笑...
  //     对方发来 Soul 官方表情「早上好」
  //     对方发来时段问候表情「早安」
  //     对方发来一个友好互动表情
  const naturalPatterns = [
    /对方发来\s*(?:Soul\s*)?互动表情[「“]([^」”]{1,12})[」”]/u,
    /对方发来\s*(?:Soul\s*)?官方表情[「“]([^」”]{1,12})[」”]/u,
    /对方发来\s*时段问候表情[「“]([^」”]{1,12})[」”]/u,
  ];
  for (const regex of naturalPatterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      const stickerName = match[1].trim();
      const lookupTag = `[${stickerName}]`;
      const info = DOUBAN_EMOJI_REGISTRY[lookupTag] || {
        tag: lookupTag,
        category: /早|午|晚|安|好|打招呼/u.test(stickerName) ? "positive_icebreaking" : "daily_fun",
        name: stickerName,
        pragmaticRole: `对方发送的「${stickerName}」表情，属于轻松破冰或趣味互动，顺应语境自然接话。`,
      };
      if (!seenTags.has(info.tag)) {
        found.push(info);
        seenTags.add(info.tag);
      }
    }
  }

  if (/对方发来一个友好互动表情|\[友好互动表情\]|\[Soul互动表情\]|\[语音互动表情\]/u.test(text)) {
    const info = DOUBAN_EMOJI_REGISTRY["[友好互动表情]"];
    if (info && !seenTags.has(info.tag)) {
      found.push(info);
      seenTags.add(info.tag);
    }
  }

  // 2. 匹配中括号表情 [xxx]，包括带冒号前缀的 [互动表情：皮一下]、[时段表情：早安] 等
  const bracketMatches = text.match(/\[[^\]\n]{1,24}\]/gu) || [];
  for (const tag of bracketMatches) {
    if (seenTags.has(tag)) continue;
    let info = DOUBAN_EMOJI_REGISTRY[tag];
    if (!info) {
      // 剥离可能存在的前缀如 "互动表情："、"时段表情："、"官方表情："、"表情包："
      const inner = tag.slice(1, -1).trim();
      const stripped = inner.replace(/^(?:互动表情|时段表情|官方表情|表情包|表情)[：:]\s*/u, "").trim();
      const strippedTag = `[${stripped}]`;
      info = DOUBAN_EMOJI_REGISTRY[strippedTag];
      if (info) {
        info = { ...info, tag };
      } else {
        const isTeasing = /白眼|气|怒|哼|傲|吐|不屑|鬼|烦|挑衅/u.test(stripped);
        const isLaugh = /笑|哈|嘻|乐|逗/u.test(stripped);
        const isGreeting = /早|午|晚|好|嗨|招呼|问候/u.test(stripped);
        info = {
          tag,
          category: isTeasing ? "teasing_or_pouting" : isGreeting ? "positive_icebreaking" : isLaugh ? "positive_icebreaking" : "daily_fun",
          name: stripped,
          pragmaticRole: isTeasing
            ? "带有调侃、傲娇或开玩笑性质，不代表真实恶意反感，应轻松接话。"
            : isGreeting
              ? "主动打招呼问候，属于破冰找话题，自然顺接回复。"
              : "作为语气润滑剂活跃气氛，表达随和友好。",
        };
      }
    }
    if (info && !seenTags.has(info.tag)) {
      found.push(info);
      seenTags.add(info.tag);
    }
  }

  // 3. 匹配 Unicode 表情
  for (const [char, info] of Object.entries(UNICODE_EMOJI_PRAGMATIC_MAP)) {
    if (text.includes(char) && !seenTags.has(char)) {
      found.push(info);
      seenTags.add(char);
    }
  }

  return found;
}

/**
 * 组装针对当前这一轮的表情语用提示词
 * （原则：提示词只放这一轮要用的，有表情才精准注入，无表情时不机械堆砌）
 */
export function buildEmojiPragmaticPrompt({
  incomingText,
  ruleEnabled = true,
  customInstruction = "",
}: {
  incomingText?: string;
  ruleEnabled?: boolean;
  customInstruction?: string;
}): string {
  if (!ruleEnabled) return "";

  const text = String(incomingText || "").trim();
  const detected = detectEmojisInText(text);

  const customHeader = customInstruction.trim() ? `【表情规则】${customInstruction.trim()}\n` : "";

  // 如果这一轮检测到了具体的表情，精准注入这几个表情的语用角色
  if (detected.length > 0) {
    const lines = detected.map(
      (e) => `• ${e.tag}（${e.name}）：${e.pragmaticRole}`
    );
    return [
      customHeader + "【本轮表情语用解析】检测到对方发送了表情符号：",
      ...lines,
      "核心原则：社交交流中表情常为语气助推剂（软化语气、调侃傲娇或活跃气氛），绝不代表对方字面的极端情绪。特别注意若包含假装生气/白眼/傲娇等表情，对方是在开玩笑逗乐，严禁机械道歉或严肃对立，应顺应语境自然接话。",
    ].filter(Boolean).join("\n");
  }

  if (customInstruction.trim()) {
    return `【表情理解原则】${customInstruction.trim()}`;
  }

  // 如果本轮没有具体表情，注入通用语用边界（大白话），防止模型误解后续表情
  return "【表情理解原则】社交私聊中表情常作为语气助推剂（调侃、撒娇、傲娇或缓和气氛），不代表对方真实极端情绪。遇到[白眼]、[发怒]等通常是假装生气或逗乐开玩笑，切勿误判为敌意或严肃道歉。";
}
