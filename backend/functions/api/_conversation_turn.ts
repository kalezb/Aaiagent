import { formatTranscriptLine } from "./_transcript_runtime";
import { isStickerStateContent } from "./_message_text";
import { requestMessageEpochSeconds } from "./_time_runtime";

const SAME_ROLE_TURN_WINDOW_SECONDS = 10 * 60;
export const MODEL_CONTEXT_EXCHANGES = 10;
export const MODEL_CONTEXT_MAX_MESSAGES = 30;
export const MODEL_CONTEXT_MAX_CHARS = 6000;

function normalizedRole(message) {
  return message?.role === "assistant" ? "assistant" : "user";
}

function sameLine(left, right) {
  if (left.clientMessageId && right.clientMessageId) {
    return left.role === right.role &&
      left.clientMessageId === right.clientMessageId;
  }
  return left.role === right.role &&
    left.original === right.original &&
    (left.epoch === 0 || right.epoch === 0 || Math.abs(left.epoch - right.epoch) <= 300);
}

function clientMessageId(message) {
  return String(message?.client_message_id || message?.message_key || "").trim();
}

/**
 * 后台可以读更多历史做安全检查，但模型写回复只需要最近几个完整来回。
 * 连续同角色短句算同一轮，避免从一组连发消息中间切断。
 */
export function selectRecentConversationTurns(
  messages = [],
  maxExchanges = MODEL_CONTEXT_EXCHANGES,
  maxMessages = MODEL_CONTEXT_MAX_MESSAGES,
  maxChars = MODEL_CONTEXT_MAX_CHARS,
) {
  const source = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && String(message.content || "").trim());
  if (!source.length) return [];

  const blocks = [];
  for (const message of source) {
    const role = normalizedRole(message);
    const previous = blocks.at(-1);
    if (previous?.role === role) {
      previous.messages.push(message);
    } else {
      blocks.push({ role, messages: [message] });
    }
  }

  const userBlockIndexes = blocks
    .map((block, index) => block.role === "user" ? index : -1)
    .filter((index) => index >= 0);
  const exchangeCount = Math.max(1, Number(maxExchanges || MODEL_CONTEXT_EXCHANGES));
  const startIndex = userBlockIndexes.length > exchangeCount
    ? userBlockIndexes[userBlockIndexes.length - exchangeCount]
    : 0;
  const selected = blocks.slice(startIndex);
  const messageLimit = Math.max(1, Number(maxMessages || MODEL_CONTEXT_MAX_MESSAGES));
  const countMessages = () => selected.reduce(
    (total, block) => total + block.messages.length,
    0,
  );
  const countChars = () => selected.reduce(
    (total, block) => total + block.messages.reduce(
      (blockTotal, message) => blockTotal + String(message.content || "").length,
      0,
    ),
    0,
  );
  const dropOldestExchange = () => {
    const dropCount = selected[0]?.role === "user" && selected[1]?.role === "assistant"
      ? 2
      : 1;
    selected.splice(0, Math.min(dropCount, selected.length - 1));
  };
  while (selected.length > 1 && countMessages() > messageLimit) {
    dropOldestExchange();
  }
  const charLimit = Math.max(500, Number(maxChars || MODEL_CONTEXT_MAX_CHARS));
  while (selected.length > 1 && countChars() > charLimit) {
    dropOldestExchange();
  }
  return selected.flatMap((block) => block.messages);
}

function shouldJoinTurn(previous, current) {
  if (!previous || previous.role !== current.role) return false;
  if (previous.isCurrent !== current.isCurrent) return false;
  if (current.forceMerge) return true;
  if (!previous.epoch || !current.epoch) return false;
  const gap = current.epoch - previous.epoch;
  return gap >= 0 && gap <= SAME_ROLE_TURN_WINDOW_SECONDS;
}

function previewTurnText(value) {
  return String(value || "")
    .split("|||")
    .at(-1)
    .trim()
    .slice(0, 50);
}

function turnLooksLikeShortAnswer(turn) {
  const substantive = turn.parts.filter((part) => !isStickerStateContent(part));
  const text = (substantive.length ? substantive : turn.parts)
    .join(" ")
    .replace(/\s+/gu, "");
  return text.length > 0 && text.length <= 12;
}

function looksLikeQuestion(value) {
  return /(?:\?|？|什么|怎么|为什么|哪|谁|吗|呢|多少|几|是不是|要不要|行不行|好不好|在干嘛|在吗)/u
    .test(String(value || ""));
}

function stickerSummary(turn) {
  const stickers = turn.parts.filter((part) => isStickerStateContent(part));
  return stickers.map((part) => previewTurnText(part)).filter(Boolean).join(" / ");
}

export function normalizeConversationTurnContext({
  historyMessages = [],
  currentMessages = [],
}) {
  return {
    historyMessages: Array.isArray(historyMessages) ? historyMessages : [],
    currentMessages: Array.isArray(currentMessages) ? currentMessages : [],
  };
}

/**
 * 把连续消息合成真正的“聊天回合”。
 *
 * 手机端这次带来的未回复消息固定算同一轮，哪怕中间隔了几秒或几分钟；
 * 历史里的同角色消息只有挨得近才合并，避免把几小时前的旧话接成一轮。
 */
export function buildConversationTurnMessages({
  historyMessages = [],
  currentMessages = [],
  nowSec = Math.floor(Date.now() / 1000),
  stickerMeanings = undefined,
}) {
  const seenLines = [];
  const entries = [];
  let previousEpoch = 0;

  const pushLine = (message, requestMessage, forceMerge) => {
    const epoch = requestMessageEpochSeconds(message) || 0;
    const original = String(message?.content || "").trim();
    if (!original) return;
    const line = {
      role: normalizedRole(message),
      original,
      epoch,
      forceMerge,
      isCurrent: forceMerge,
      clientMessageId: clientMessageId(message),
    };
    if (seenLines.some((seen) => sameLine(seen, line))) {
      previousEpoch = epoch || previousEpoch;
      return;
    }
    seenLines.push(line);
    entries.push({
      ...line,
      content: formatTranscriptLine(
        requestMessage,
        previousEpoch,
        nowSec,
        stickerMeanings,
      ),
    });
    previousEpoch = epoch || previousEpoch;
  };

  for (const message of historyMessages) {
    pushLine(message, message, false);
  }
  for (const message of currentMessages) {
    const requestMessage = message?.time_kind
      ? message
      : { ...message, time_kind: "first_observed" };
    pushLine(message, requestMessage, true);
  }

  const turns = [];
  for (const entry of entries) {
    const previous = turns.at(-1);
    if (shouldJoinTurn(previous, entry)) {
      previous.content += "\n" + entry.content;
      previous.epoch = entry.epoch || previous.epoch;
      previous.parts.push(entry.original);
    } else {
      turns.push({
        role: entry.role,
        content: entry.content,
        epoch: entry.epoch,
        parts: [entry.original],
        isCurrent: entry.isCurrent,
      });
    }
  }
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    const previous = turns[index - 1];
    if (!turn.isCurrent || turn.role !== "user" || previous?.role !== "assistant" || !turnLooksLikeShortAnswer(turn)) {
      continue;
    }
    const previousText = previewTurnText(previous.parts.at(-1));
    const answerText = turn.parts.filter((part) => !isStickerStateContent(part)).join(" / ");
    const stickerText = stickerSummary(turn);
    if (previousText && answerText && looksLikeQuestion(previousText)) {
      turn.content = "【把这一问一答连起来理解】\n我问：" + previousText +
        "\n对方回：" + answerText +
        (stickerText ? "\n对方还发了个表情：" + stickerText : "");
      previous.omit = true;
    }
  }
  return turns
    .filter((turn) => !turn.omit)
    .map(({ role, content }) => ({ role, content }));
}
