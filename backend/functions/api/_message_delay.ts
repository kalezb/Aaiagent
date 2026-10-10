import { isExplicitBusinessIntent } from "./_reply_policy";
import {
  formatChinaClock,
  formatChinaMessageTime,
  formatChineseDuration,
  requestMessageEpochSeconds,
} from "./_time_runtime";

export function classifyIncomingMessage(value) {
  const text = String(value || "");
  if (isExplicitBusinessIntent(text)) return "business";
  if (/(?:(?:明天|今天|今晚|下午|晚上|周末|晚点).*(?:有空|见|约|来|吃饭)|有空吗|见个面)/u.test(text)) {
    return "expired_invite";
  }
  if (/(?:晚安|睡了|睡不着)/u.test(text)) return "night";
  if (/(?:在吗|在不在|你好|嗨|哈喽|早上好|中午好|下午好|晚上好|干嘛呢|干什么)|\b(?:hello|hi)\b/iu.test(text)) {
    return "greeting";
  }
  if (/(?:心情|难受|不开心|烦|好累|孤独|想你)/u.test(text)) return "emotion";
  return "normal";
}

export function getMessageDelayPolicy(
  message,
  nowSec = Math.floor(Date.now() / 1000),
  senderWaitSeconds = 0,
) {
  const epoch = requestMessageEpochSeconds(message);
  const messageType = classifyIncomingMessage(message?.content);
  if (!epoch) return {
    hasTimestamp: false,
    ageSeconds: null,
    level: "unknown",
    messageType,
    pastMode: false,
    prompt: "对方消息没有可靠时间，按内容自然回复。",
  };

  const ageSeconds = Math.max(0, nowSec - epoch);
  const waitSeconds = Math.max(0, Number(senderWaitSeconds) || 0);
  const basisSeconds = Math.max(ageSeconds, waitSeconds);
  let level = "immediate";
  if (basisSeconds > 3 * 60 && basisSeconds <= 30 * 60) level = "short_wait";
  else if (basisSeconds > 30 * 60 && basisSeconds <= 2 * 3600) level = "acknowledge";
  else if (basisSeconds > 2 * 3600 && basisSeconds <= 6 * 3600) level = "explicit_delay";
  else if (basisSeconds > 6 * 3600 && basisSeconds <= 24 * 3600) level = "dayparted";
  else if (basisSeconds > 24 * 3600 && basisSeconds <= 3 * 86400) level = "past_1_3d";
  else if (basisSeconds > 3 * 86400 && basisSeconds <= 7 * 86400) level = "past_4_7d";
  else if (basisSeconds > 7 * 86400 && basisSeconds <= 30 * 86400) level = "past_7_30d";
  else if (basisSeconds > 30 * 86400) level = "past_over_30d";

  const pastMode = basisSeconds > 24 * 3600;
  if (level === "immediate") {
    return { hasTimestamp: true, ageSeconds, level, messageType, pastMode, prompt: "" };
  }
  if (!pastMode) {
    return {
      hasTimestamp: true,
      ageSeconds,
      level,
      messageType,
      pastMode,
      prompt: "",
    };
  }

  let typeRule = "这是较早前的消息，先回应原话，不要当成当前邀约。";
  if (messageType === "business") {
    typeRule = "这是较早前问的工作或物品问题；不要主动重提，只有对方当前明确继续这个话题才回应。" // persona-guard: ok — 已中性化;
  } else if (messageType === "expired_invite") {
    typeRule = "这是较早前的邀约，不能回答明天可以或我有空，改成问对方现在是否还需要。";
  } else if (messageType === "night" || messageType === "emotion") {
    typeRule = "只回应原话，不要假装当时就在陪聊。";
  }

  return {
    hasTimestamp: true,
    ageSeconds,
    level,
    messageType,
    pastMode,
    prompt: typeRule,
  };
}

function senderWaitSecondsFor(messages, historyMessages, incomingIndex, epoch) {
  if (!epoch) return 0;
  let lastSelfEpoch = 0;
  for (let index = incomingIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "assistant") continue;
    lastSelfEpoch = requestMessageEpochSeconds(messages[index]);
    if (lastSelfEpoch) break;
  }
  if (!lastSelfEpoch) {
    for (let index = historyMessages.length - 1; index >= 0; index -= 1) {
      if (historyMessages[index]?.role !== "assistant") continue;
      lastSelfEpoch = requestMessageEpochSeconds(historyMessages[index]);
      if (lastSelfEpoch) break;
    }
  }
  if (!lastSelfEpoch || epoch <= lastSelfEpoch) return 0;
  return Math.max(0, epoch - lastSelfEpoch);
}

export function resolveIncomingDelayPolicy(messages, historyMessages, nowSec) {
  let incomingIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      incomingIndex = index;
      break;
    }
  }
  if (incomingIndex < 0) return null;
  const incoming = messages[incomingIndex];
  const waitSeconds = senderWaitSecondsFor(
    messages,
    historyMessages,
    incomingIndex,
    requestMessageEpochSeconds(incoming),
  );
  const direct = getMessageDelayPolicy(incoming, nowSec, waitSeconds);
  if (direct.hasTimestamp) return { ...direct, inferredTimestamp: false };

  let visibleTime = 0;
  for (let index = incomingIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "user") continue;
    visibleTime = requestMessageEpochSeconds(messages[index]);
    if (visibleTime) break;
  }
  if (!visibleTime) {
    for (let index = historyMessages.length - 1; index >= 0; index -= 1) {
      if (historyMessages[index]?.role !== "user") continue;
      visibleTime = requestMessageEpochSeconds(historyMessages[index]);
      if (visibleTime) break;
    }
  }
  if (!visibleTime) return { ...direct, inferredTimestamp: false };
  const inferred = getMessageDelayPolicy(
    { ...incoming, created_at: visibleTime },
    nowSec,
    waitSeconds,
  );
  return {
    ...inferred,
    inferredTimestamp: true,
    prompt: "当前消息没有显示时间，按最近可见的对方发送时间判断。" + inferred.prompt,
  };
}

export function delayClock(epochSeconds) {
  return formatChinaClock(epochSeconds);
}

export function delayTime(epochSeconds) {
  return formatChinaMessageTime(epochSeconds);
}

export function delayDuration(seconds) {
  return formatChineseDuration(seconds);
}
