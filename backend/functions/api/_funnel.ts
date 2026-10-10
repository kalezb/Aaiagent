// persona-guard: ok (file) —— 本模块只服务星暮（回收业务），只会在 starSoulScope 分支里被调用
import {
  BUSINESS_ACTION_SOURCE,
  BUSINESS_DEVICE_SOURCE,
  OLD_BUSINESS_DEVICE_SOURCE,
} from "./_business_scope";

const STAGE_MIN_USER_TURNS = [0, 1, 6, 12, 20, 26, 30];

const STAGE_EVIDENCE_REQUIREMENTS = {
  1: {
    nextStage: 2,
    minUserTurns: 6,
    count: 2,
    keys: ["conversationBackAndForth", "lifeSignal", "photoSignal", "soulUnseenUnderstood"],
  },
  2: {
    nextStage: 3,
    minUserTurns: 12,
    count: 2,
    keys: ["acceptsLifeTopic", "mutualLifeScenes", "noRejection"],
  },
  3: {
    nextStage: 4,
    minUserTurns: 20,
    count: 2,
    keys: ["flirtationEstablished", "acceptedAffection", "likedSignal"],
  },
  4: {
    nextStage: 5,
    minUserTurns: 26,
    count: 2,
    keys: ["recyclerIdentityShared", "acceptedBusinessTopic", "conversationActive"],
  },
  5: {
    nextStage: 6,
    minUserTurns: 30,
    count: 1,
    keys: ["willingToRecycle"],
  },
};

const NEGATIVE_SIGNAL = /(?:别再发|不要发|别烦|不感兴趣|不想聊|拉黑|举报|骗子|假的吧|滚|烦死|恶心)/u;
const LIFE_SIGNAL = /(?:吃饭|下班|上班|加班|工作|咖啡|奶茶|天气|下雨|下雪|回家|睡觉|周末|逛街|朋友|家里|今天|昨天|最近|累|烦|开心|心情|刚忙|刚到家|吃了|喝了|散步|电影|剧)/u;
const PHOTO_SIGNAL = /(?:(?:想看|想看看|看看|看下|看一下|发|发张|发一张|给|来张|要|要张)[^，,。！？!?]{0,8}(?:照片|日常照|身材照|本人照|你本人|本人)|(?:看脸|看你长|长什么样|长啥样)|以图换图)/u;
const AFFECTION_SIGNAL = /(?:喜欢你|想你|心动|心动|吃醋|在乎你|舍不得|想抱|亲亲|陪我|想更近)/u;
const ACCEPTED_AFFECTION = /(?:我也喜欢你|对你好|心疼你|在乎你|想照顾你|舍不得你|对你有感觉|认真对你)/u;
const ASSISTANT_AFFECTION = /(?:有点心动|喜欢你|想你|吃醋|在乎你|舍不得|别闹|嘴硬|先聊着|我又不会跑)/u;
const RECYCLER_IDENTITY = /(?:我平时就是收这些的|我做(?:二手手机|手机|数码|废旧数码).{0,6}回收|我收这些|平时收(?:旧手机|旧数码)|我这边.{0,4}回收)/u;
const RECYCLE_TOPIC = new RegExp(
  `(?:${OLD_BUSINESS_DEVICE_SOURCE}|${BUSINESS_DEVICE_SOURCE}.{0,12}${BUSINESS_ACTION_SOURCE}|${BUSINESS_ACTION_SOURCE}.{0,12}${BUSINESS_DEVICE_SOURCE})`,
  "iu",
);
const COLLECTION_ACTION_SOURCE = "(?:可以给你|给你收|让你收|怎么收|怎么寄|寄哪里|寄给你|上门吗|上门收|愿意给你|拿去收|收不收|能收吗)";
const WILLING_TO_RECYCLE = new RegExp(
  `(?:${OLD_BUSINESS_DEVICE_SOURCE}.{0,18}${COLLECTION_ACTION_SOURCE}|${COLLECTION_ACTION_SOURCE}.{0,18}${OLD_BUSINESS_DEVICE_SOURCE})`,
  "iu",
);
const DEAL_COMPLETED = new RegExp(
  `(?:${OLD_BUSINESS_DEVICE_SOURCE}.{0,18}(?:收成了|成交了|已经寄了|已经收了|打款了|钱到了|处理完了)|(?:收成了|成交了|已经寄了|已经收了|打款了|钱到了|处理完了).{0,18}${OLD_BUSINESS_DEVICE_SOURCE})`,
  "iu",
);
const EVALUATION_QUOTE = /(?:评估报价|shanhs668)/iu;

function normalizedText(message) {
  return String(message?.content || "").replace(/\s+/gu, "");
}

function messagesOf(messages, role) {
  return (Array.isArray(messages) ? messages : []).filter((message) => message?.role === role);
}

function hasText(messages, pattern) {
  return messages.some((message) => pattern.test(normalizedText(message)));
}

function countMatchingMessages(messages, pattern) {
  return messages.filter((message) => pattern.test(normalizedText(message))).length;
}

export function emptyFunnelEvidence() {
  return {
    conversationBackAndForth: false,
    lifeSignal: false,
    photoSignal: false,
    soulUnseenUnderstood: false,
    acceptsLifeTopic: false,
    mutualLifeScenes: false,
    noRejection: true,
    flirtationEstablished: false,
    acceptedAffection: false,
    likedSignal: false,
    recyclerIdentityShared: false,
    acceptedBusinessTopic: false,
    conversationActive: false,
    willingToRecycle: false,
    dealCompleted: false,
  };
}

export function normalizeFunnelEvidence(value) {
  const base = emptyFunnelEvidence();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  for (const key of Object.keys(base)) {
    if (typeof value[key] === "boolean") base[key] = value[key];
  }
  return base;
}

export function mergeFunnelEvidence(current, incoming) {
  const merged = { ...normalizeFunnelEvidence(current) };
  const next = normalizeFunnelEvidence(incoming);
  for (const key of Object.keys(merged)) {
    if (key === "noRejection") {
      merged[key] = merged[key] && next[key];
    } else if (next[key] === true) {
      merged[key] = true;
    }
  }
  return merged;
}

export function emptyFunnelState() {
  return {
    stage: 1,
    userTurnCount: 0,
    evidence: emptyFunnelEvidence(),
    evaluationQuoteSent: false,
    completed: false,
    lastRequestId: "",
    stageEnteredAt: 0,
    lastAdvancedAt: 0,
    lastUserMessageAt: 0,
    lastNegativeAt: 0,
    updatedAt: 0,
  };
}

export function normalizeFunnelState(value) {
  const base = emptyFunnelState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const stage = Number(value.stage);
  const userTurnCount = Number(value.userTurnCount);
  return {
    ...base,
    ...value,
    stage: Number.isFinite(stage) ? Math.max(1, Math.min(6, Math.trunc(stage))) : 1,
    userTurnCount: Number.isFinite(userTurnCount) ? Math.max(0, Math.trunc(userTurnCount)) : 0,
    evidence: normalizeFunnelEvidence(value.evidence),
    evaluationQuoteSent: value.evaluationQuoteSent === true,
    completed: value.completed === true,
  };
}

export function collectFunnelEvidence({ historyMessages = [], messages = [], platform = "", evaluationQuoteSent = false } = {}) {
  const history = Array.isArray(historyMessages) ? historyMessages : [];
  const current = Array.isArray(messages) ? messages : [];
  const all = [...history, ...current];
  const userMessages = messagesOf(all, "user");
  const assistantMessages = messagesOf(all, "assistant");
  const currentUserText = messagesOf(current, "user").map(normalizedText).join(" ");
  const recentUserText = userMessages
    .slice(-8)
    .map(normalizedText)
    .join("|");
  const hasNegative = NEGATIVE_SIGNAL.test(currentUserText);
  const hasLife = hasText(userMessages, LIFE_SIGNAL);
  const assistantLife = hasText(assistantMessages, LIFE_SIGNAL);
  const hasAffection = hasText(userMessages, AFFECTION_SIGNAL);
  const acceptedAffection = hasText(userMessages, ACCEPTED_AFFECTION);
  const likedSignal = hasText(assistantMessages, ASSISTANT_AFFECTION);
  const recyclerIdentityShared = hasText(assistantMessages, RECYCLER_IDENTITY);
  const acceptedBusinessTopic = RECYCLE_TOPIC.test(recentUserText);
  const willingToRecycle = WILLING_TO_RECYCLE.test(recentUserText);
  const dealCompleted = DEAL_COMPLETED.test(recentUserText);

  return {
    conversationBackAndForth: userMessages.length >= 3 && assistantMessages.length >= 2,
    lifeSignal: hasLife,
    photoSignal: countMatchingMessages(userMessages, PHOTO_SIGNAL) >= 1,
    soulUnseenUnderstood: String(platform || "").toLowerCase() === "soul" && userMessages.length >= 2 && assistantMessages.length >= 1,
    acceptsLifeTopic: countMatchingMessages(userMessages, LIFE_SIGNAL) >= 2,
    mutualLifeScenes: hasLife && assistantLife,
    noRejection: !hasNegative,
    flirtationEstablished: hasAffection,
    acceptedAffection,
    likedSignal,
    recyclerIdentityShared,
    acceptedBusinessTopic,
    conversationActive: userMessages.length >= 2 && !hasNegative,
    willingToRecycle,
    dealCompleted,
    evaluationQuoteSent: Boolean(evaluationQuoteSent) || all.some((message) => EVALUATION_QUOTE.test(normalizedText(message))),
  };
}

export function hasNegativeFunnelSignal(value) {
  return NEGATIVE_SIGNAL.test(String(value || "").replace(/\s+/gu, ""));
}

export function countFunnelEvidence(evidence, keys) {
  return (Array.isArray(keys) ? keys : []).reduce(
    (count, key) => count + (evidence?.[key] === true ? 1 : 0),
    0,
  );
}

export function nextFunnelStage(state, evidence) {
  const normalized = normalizeFunnelState(state);
  const mergedEvidence = mergeFunnelEvidence(normalized.evidence, evidence);

  let stage = normalized.stage;
  const requirement = STAGE_EVIDENCE_REQUIREMENTS[stage];
  if (!requirement) return 6;
  if (normalized.userTurnCount < requirement.minUserTurns) return stage;
  if (countFunnelEvidence(mergedEvidence, requirement.keys) < requirement.count) return stage;
  stage = requirement.nextStage;
  return Math.max(1, Math.min(6, stage));
}

export function applyFunnelTurn({
  state,
  historyMessages = [],
  messages = [],
  platform = "",
  requestId = "",
  countTurn = true,
  allowAdvance = true,
  nowSec = Math.floor(Date.now() / 1000),
} = {}) {
  const current = normalizeFunnelState(state);
  const userMessages = messagesOf(messages, "user");
  const currentUserText = userMessages.map(normalizedText).join(" ");
  const negative = hasNegativeFunnelSignal(currentUserText);
  const collected = collectFunnelEvidence({
    historyMessages,
    messages,
    platform,
    evaluationQuoteSent: current.evaluationQuoteSent,
  });
  const evidence = mergeFunnelEvidence(current.evidence, collected);
  const next = {
    ...current,
    evidence,
    userTurnCount: current.userTurnCount + (countTurn ? userMessages.length : 0),
    lastRequestId: countTurn ? String(requestId || current.lastRequestId) : current.lastRequestId,
    lastUserMessageAt: countTurn && userMessages.length ? nowSec : current.lastUserMessageAt,
    evaluationQuoteSent: current.evaluationQuoteSent || collected.evaluationQuoteSent === true,
    updatedAt: nowSec,
  };

  if (negative) {
    const canDemote = nowSec - Number(current.lastNegativeAt || 0) >= 86400;
    if (canDemote && next.stage > 1 && !next.completed) {
      next.stage -= 1;
      next.stageEnteredAt = nowSec;
    }
    next.lastNegativeAt = canDemote ? nowSec : current.lastNegativeAt;
    return { state: next, advanced: false, negative: true };
  }

  const proposed = allowAdvance && userMessages.length > 0
    ? nextFunnelStage(next, evidence)
    : next.stage;
  const advanced = proposed > next.stage;
  if (advanced) {
    next.stage = proposed;
    next.stageEnteredAt = nowSec;
    next.lastAdvancedAt = nowSec;
  }
  next.completed = next.stage === 6 && next.evaluationQuoteSent;
  return { state: next, advanced, negative: false };
}

export function funnelStageText(stage, completed = false) {
  switch (Number(stage || 1)) {
    case 1:
      return "你们刚在 Soul 匹配上，还没见过。当前只做认识，不要提前推进业务。";
    case 2:
      return "当前是信任阶段。用生活细节让对方觉得你是真人，不急着聊旧数码。";
    case 3:
      return "当前是拉扯阶段。接住喜欢再收一点，不确认关系，不开口索要旧物。";
    case 4:
      return "当前是聊到旧物阶段。可以自然带到家里的旧数码，按角落讲，不报菜单。";
    case 5:
      return "当前是愿意回收阶段。先确认对方愿意交或问过怎么收，再为下一阶段留口。";
    case 6:
      return completed
        ? "评估入口已经发过，本段业务结束。现在回到日常聊天，不重复发入口，也不自动开启第二套任务。"
        : "当前是评估入口阶段。只在对方谈怎么收、收什么、寄送或上门时发送评估入口，且必须单独成泡。";
    default:
      return "";
  }
}

export function stageMinUserTurns(stage) {
  const index = Math.max(1, Math.min(6, Number(stage || 1)));
  return STAGE_MIN_USER_TURNS[index];
}

export const XINGMU_STAGE_REQUIREMENTS = Object.freeze(STAGE_EVIDENCE_REQUIREMENTS);
