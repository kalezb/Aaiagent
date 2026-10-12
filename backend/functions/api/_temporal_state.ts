import { getChinaTimeContext } from "./_time_runtime";
import { loadDeviceSettings } from "./_device_runtime";
import {
  loadLlmConfig,
  isGeminiModelConfig,
  buildModelHeaders,
  buildModelRequestPayload,
} from "./_model_runtime";
import { enforceTokenBudget } from "./_model_call_runtime";

export interface ContactTemporalState {
  last_activity?: string;
  last_activity_at?: number;
  last_reply_at?: number;
  relationship_stage?: string;
  mood?: string;
  conversation_summary?: string;
  summary_updated_at?: number;
}

export interface ActivityMetadata {
  type: "wash" | "sleep" | "meal" | "busy";
  label: string;
  defaultSilenceSeconds: number;
  maxRelevanceSeconds: number;
}

const ACTIVITIES: Record<string, ActivityMetadata> = {
  wash: {
    type: "wash",
    label: "去洗漱",
    defaultSilenceSeconds: 20 * 60, // 20分钟内静默不回，防已读不回与秒回穿帮
    maxRelevanceSeconds: 3 * 3600,   // 3小时内回来可提“刚洗完吹干头发”
  },
  sleep: {
    type: "sleep",
    label: "去睡觉",
    defaultSilenceSeconds: 6 * 3600, // 深夜说睡后当晚静默
    maxRelevanceSeconds: 16 * 3600,  // 次日可提“刚醒”
  },
  meal: {
    type: "meal",
    label: "去吃饭",
    defaultSilenceSeconds: 35 * 60, // 35分钟内静默
    maxRelevanceSeconds: 3 * 3600,
  },
  busy: {
    type: "busy",
    label: "在忙碌/在路上",
    defaultSilenceSeconds: 25 * 60, // 25分钟内静默
    maxRelevanceSeconds: 3 * 3600,
  },
};

/**
 * 格式化时间流逝（大白话）
 */
export function formatElapsedDuration(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds || 0));
  if (sec < 60) return "刚刚";
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}分钟`;
  if (sec < 86400) {
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`;
  }
  const days = Math.floor(sec / 86400);
  if (days < 7) return `${days}天`;
  const weeks = Math.floor(days / 7);
  return `${weeks}周`;
}

/**
 * 获取自然中文时间描述（例如：2026年10月12日 21:30（星期一晚上））
 */
export function formatChinaNaturalTime(date = new Date()): string {
  const china = getChinaTimeContext(date);
  const match = String(china.currentDatetime || "").match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return String(china.currentDatetime || "");

  const [, year, month, day, hourStr, minStr] = match;
  const hour = Number(hourStr);

  let period = "晚上";
  if (hour >= 0 && hour < 6) period = "凌晨";
  else if (hour >= 6 && hour < 11) period = "早上";
  else if (hour >= 11 && hour < 13) period = "中午";
  else if (hour >= 13 && hour < 18) period = "下午";
  else if (hour >= 18 && hour < 24) period = "晚上";

  return `${year}年${Number(month)}月${Number(day)}日 ${hourStr}:${minStr}（${china.weekday}${period}）`;
}

/**
 * 从 AI 生成的回复文本中识别离场或动作承诺
 */
export function detectActivityFromReply(replyText: string): ActivityMetadata | null {
  const text = String(replyText || "").trim();
  if (!text) return null;

  // 1. 睡觉 / 晚安
  if (/(?:去睡[了吧]?|困了[，\s]*睡了|准备睡了|晚安[啦喽啊~～]*|先睡了|我睡了|倒头就睡)/u.test(text)) {
    return ACTIVITIES.sleep;
  }

  // 2. 洗漱 / 洗澡
  if (/(?:(?:去|先去|准备|打算|正要)?(?:洗[漱澡]|冲凉)|冲个凉|泡个澡|洗把脸|卸个妆)/u.test(text)) {
    return ACTIVITIES.wash;
  }

  // 3. 吃饭 / 做饭
  if (/(?:去吃饭|吃个饭|去做饭|准备做饭|吃点东西|吃晚饭|吃午饭|吃宵夜|外卖到了)/u.test(text)) {
    return ACTIVITIES.meal;
  }

  // 4. 外出 / 忙碌 / 开会
  if (/(?:出门一趟|去开会|先开会|在路上|去办个事|去忙了|先忙[了会儿]|盯数据去)/u.test(text)) {
    return ACTIVITIES.busy;
  }

  return null;
}

/**
 * 动作状态评估结果
 */
export interface ActivityEvaluation {
  isSilenced: boolean;
  silenceReason?: string;
  isCompleted: boolean;
  activityHint?: string;
  shouldClear: boolean;
}

/**
 * 评估当前动作的执行状态（是否在静默中、是否合理做完、带什么接话提示）
 */
export function evaluateActivityState(
  lastActivity: string,
  lastActivityAt: number,
  nowSec: number,
  currentHour = new Date().getHours(),
): ActivityEvaluation {
  const act = String(lastActivity || "").trim();
  const actAt = Number(lastActivityAt || 0);

  if (!act || actAt <= 0) {
    return { isSilenced: false, isCompleted: false, shouldClear: false };
  }

  const elapsed = Math.max(0, nowSec - actAt);

  // 1. 睡觉类动作
  if (act === ACTIVITIES.sleep.label) {
    // 如果间隔小于5小时，或者当前还是深夜/凌晨（0点-6点），保持静默不打扰
    const isNightOrEarly = currentHour >= 23 || currentHour < 6;
    if (elapsed < 5 * 3600 || isNightOrEarly) {
      return {
        isSilenced: true,
        silenceReason: "sleeping",
        isCompleted: false,
        shouldClear: false,
      };
    }
    // 到了次日白天且已过5小时以上：动作完成
    if (elapsed >= 5 * 3600 && elapsed <= ACTIVITIES.sleep.maxRelevanceSeconds) {
      return {
        isSilenced: false,
        isCompleted: true,
        activityHint: "你昨晚说去睡了，现在已是第二天，自然带半句刚醒或昨晚睡得早，再顺畅接对方的话。",
        shouldClear: true,
      };
    }
    // 超过很久（隔了整整大半天）：自然清除，不特意提
    return { isSilenced: false, isCompleted: true, shouldClear: true };
  }

  // 2. 洗漱类动作
  if (act === ACTIVITIES.wash.label) {
    // 20分钟内处于封闭洗漱中：静默不回，防已读不回与秒回穿帮
    if (elapsed < ACTIVITIES.wash.defaultSilenceSeconds) {
      return {
        isSilenced: true,
        silenceReason: "washing_up",
        isCompleted: false,
        shouldClear: false,
      };
    }
    // 20分钟~3小时内：刚洗完吹干头发回来
    if (elapsed >= ACTIVITIES.wash.defaultSilenceSeconds && elapsed <= ACTIVITIES.wash.maxRelevanceSeconds) {
      return {
        isSilenced: false,
        isCompleted: true,
        activityHint: "你之前说去洗漱，现在刚洗完吹干头发回来，自然带半句刚洗完吹好头发，再顺畅接对方的话。",
        shouldClear: true,
      };
    }
    // 超过3小时：早已洗完，无需特意提
    return { isSilenced: false, isCompleted: true, shouldClear: true };
  }

  // 3. 吃饭类动作
  if (act === ACTIVITIES.meal.label) {
    if (elapsed < ACTIVITIES.meal.defaultSilenceSeconds) {
      return {
        isSilenced: true,
        silenceReason: "eating",
        isCompleted: false,
        shouldClear: false,
      };
    }
    if (elapsed >= ACTIVITIES.meal.defaultSilenceSeconds && elapsed <= ACTIVITIES.meal.maxRelevanceSeconds) {
      return {
        isSilenced: false,
        isCompleted: true,
        activityHint: "你之前说去吃饭，现在吃完收拾好了，自然带半句吃完了，再顺畅接对方的话。",
        shouldClear: true,
      };
    }
    return { isSilenced: false, isCompleted: true, shouldClear: true };
  }

  // 4. 忙碌 / 外出类动作
  if (act === ACTIVITIES.busy.label) {
    if (elapsed < ACTIVITIES.busy.defaultSilenceSeconds) {
      return {
        isSilenced: true,
        silenceReason: "busy",
        isCompleted: false,
        shouldClear: false,
      };
    }
    if (elapsed >= ACTIVITIES.busy.defaultSilenceSeconds && elapsed <= ACTIVITIES.busy.maxRelevanceSeconds) {
      return {
        isSilenced: false,
        isCompleted: true,
        activityHint: "你之前说在忙/在路上，现在事情办完闲下来了，自然接着聊。",
        shouldClear: true,
      };
    }
    return { isSilenced: false, isCompleted: true, shouldClear: true };
  }

  // 其他动作，默认超过20分钟视为完成并清理
  if (elapsed >= 20 * 60) {
    return { isSilenced: false, isCompleted: true, shouldClear: true };
  }
  return { isSilenced: false, isCompleted: false, shouldClear: false };
}

/**
 * 2026-10-13 用户业务核心：1~2 小时连贯会话内的关系进阶流转计算
 * 0~5 轮（前10-15分钟）：刚认识 (new)
 * 6~15 轮（半小时~1小时）：熟悉 (familiar)
 * 16+ 轮（1~2小时深入互动）：亲密/推进 (close)
 */
export function computeRelationshipStage(currentStage?: string, totalExchanges = 0): string {
  const current = String(currentStage || "new").trim();
  if (current === "cold") return "cold";
  if (totalExchanges >= 16) return "close";
  if (totalExchanges >= 6) return current === "close" || current === "flirty" ? current : "familiar";
  return current || "new";
}

/**
 * 构建高密度、极简、无废话的时空上下文提示词
 * 每轮严格控制在 30~55 个汉字，确保大模型一眼看懂、绝不犯迷糊
 */
export function buildTemporalContextPrompt(options: {
  contact: ContactTemporalState | null;
  nowSec?: number;
  date?: Date;
  activityEvaluation?: ActivityEvaluation;
  totalExchanges?: number;
}): string {
  const nowSec = options.nowSec || Math.floor(Date.now() / 1000);
  const date = options.date || new Date(nowSec * 1000);
  const contact = options.contact;
  const timeStr = formatChinaNaturalTime(date);

  const lines: string[] = [
    "【现场时空感知｜硬事实】",
    `现在时间：${timeStr}`,
  ];

  const lastReplyAt = Number(contact?.last_reply_at || 0);

  if (lastReplyAt > 0) {
    const elapsed = Math.max(0, nowSec - lastReplyAt);
    const elapsedStr = formatElapsedDuration(elapsed);

    if (elapsed < 10 * 60) {
      lines.push(`距上次聊天：刚刚（连贯聊天中，不客套、不无故说“好久不见”或“怎么不理我”）`);
    } else if (elapsed > 4 * 3600) {
      lines.push(`距上次聊天：已过 ${elapsedStr}（隔了一段时间，按当前时间自然接话）`);
    } else {
      lines.push(`距上次聊天：过了 ${elapsedStr}`);
    }
  } else {
    lines.push("这是你们第一次聊天。");
  }

  // 动作闭环提示（如有）
  if (options.activityEvaluation?.activityHint) {
    lines.push(`生活状态：${options.activityEvaluation.activityHint}`);
  }

  // 关系阶段与心情（支持 1~2 小时连贯会话内基于互动轮数快节奏推进）
  const rawStage = String(contact?.relationship_stage || "new").trim();
  const stage = computeRelationshipStage(rawStage, options.totalExchanges || 0);
  const stageLabel = stage === "familiar" ? "熟悉"
    : stage === "flirty" ? "暧昧"
    : stage === "close" ? "亲密"
    : stage === "cold" ? "冷战"
    : "刚认识";

  const mood = String(contact?.mood || "normal").trim();
  const moodLabel = mood === "happy" ? "开心"
    : mood === "annoyed" ? "微烦"
    : mood === "shy" ? "害羞"
    : mood === "sad" ? "低落"
    : "正常";

  lines.push(`关系与心情：${stageLabel}｜${moodLabel}`);

  return lines.join("\n");
}

/**
 * 长期记忆压缩：当客户消息累计达到 50 条时，自动在后台悄悄把前 30 条提炼成不超过 200 字的小备忘
 * （0毫秒阻塞，完全不耽误正常秒回聊天）
 */
export async function maybeSummarizeConversation(
  env: any,
  tokenRow: any,
  platform: string,
  contactId: string,
): Promise<void> {
  if (!env?.DB || !tokenRow?.token) return;
  const token = tokenRow.token;
  const now = Math.floor(Date.now() / 1000);

  // 1. 检查总消息数，必须达到 50 条才启动压缩
  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM chat_history WHERE token = ? AND platform = ? AND contact_id = ?"
  ).bind(token, platform, contactId).first();
  const total = Number(countRow?.total || 0);
  if (total < 50) return;

  // 2. 防频繁触发：如果 12 小时内刚更新过摘要，跳过
  const contact = await env.DB.prepare(
    "SELECT conversation_summary, summary_updated_at FROM contacts WHERE token = ? AND platform = ? AND contact_id = ?"
  ).bind(token, platform, contactId).first();
  const lastUpdated = Number(contact?.summary_updated_at || 0);
  if (lastUpdated > 0 && now - lastUpdated < 12 * 3600) return;

  // 3. 拉取最早的 30 条消息进行提炼压缩
  const queryResult = await env.DB.prepare(
    "SELECT role, content FROM chat_history WHERE token = ? AND platform = ? AND contact_id = ? ORDER BY created_at ASC, id ASC LIMIT 30"
  ).bind(token, platform, contactId).all();
  const results = queryResult?.results || [];
  if (results.length < 10) return;

  const dialogueLines = results
    .map((r: any) => `${r.role === "assistant" ? "我" : "对方"}：${String(r.content || "").slice(0, 100)}`)
    .join("\n");

  const deviceSettings = await loadDeviceSettings(env.DB, token);
  const modelConfig = await loadLlmConfig(env.KV, env, deviceSettings?.model_line);
  const usingGemini = isGeminiModelConfig(modelConfig);
  const apiKey = usingGemini
    ? (modelConfig.apiKeyOverride || env.GEMINI_API_KEY || "")
    : (env.DEEPSEEK_API_KEY || "");
  if (!apiKey) return;

  const budget = await enforceTokenBudget(env.DB, tokenRow);
  if (!budget.allowed) return;

  const summaryBaseUrl = usingGemini
    ? modelConfig.baseUrl
    : (env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const summaryModel = usingGemini
    ? modelConfig.modelName
    : (env.SUMMARY_MODEL || "deepseek-flash");

  const payload = buildModelRequestPayload(
    usingGemini ? modelConfig : { provider: "deepseek" },
    summaryModel,
    [
      {
        role: "system",
        content:
          "你是一个对话记忆整理助手。请把以下对话压缩成一段备忘摘要（严格不超过200字）。" +
          "保留：1. 对方个人信息（职业、城市、感情状况、爱好）；" +
          "2. 你们聊过的重要话题；" +
          "3. 关系进展到哪了；" +
          "4. 有什么未完成的约定或情绪。" +
          "不要保留寒暄和废话。直接输出提炼后的摘要内容，不要任何问候或包裹说明。",
      },
      {
        role: "user",
        content: `已有旧备忘：${contact?.conversation_summary || "无"}\n\n需压缩的对话：\n${dialogueLines}`,
      },
    ],
    0,
    300,
  );

  const response = await fetch(summaryBaseUrl + "/chat/completions", {
    method: "POST",
    headers: buildModelHeaders(apiKey, usingGemini ? modelConfig : { provider: "deepseek" }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) return;
  const data: any = await response.json();
  const summaryText = String(data?.choices?.[0]?.message?.content || "").trim().slice(0, 220);
  if (!summaryText) return;

  await env.DB.prepare(
    "UPDATE contacts SET conversation_summary = ?, summary_updated_at = ? WHERE token = ? AND platform = ? AND contact_id = ?"
  ).bind(summaryText, now, token, platform, contactId).run();
}

