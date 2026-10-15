import { formatTranscriptLine } from "./_transcript_runtime";
import { isStickerStateContent } from "./_message_text";
import { requestMessageEpochSeconds } from "./_time_runtime";

const SAME_ROLE_TURN_WINDOW_SECONDS = 10 * 60;

function normalizedRole(message) {
  return message?.role === "assistant" ? "assistant" : "user";
}

function sameLine(left, right) {
  return left.role === right.role &&
    left.original === right.original &&
    (left.epoch === 0 || right.epoch === 0 || Math.abs(left.epoch - right.epoch) <= 300);
}

function shouldJoinTurn(previous, current) {
  if (!previous || previous.role !== current.role) return false;
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

function stickerSummary(turn) {
  const stickers = turn.parts.filter((part) => isStickerStateContent(part));
  return stickers.map((part) => previewTurnText(part)).filter(Boolean).join(" / ");
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
    const line = { role: normalizedRole(message), original, epoch, forceMerge };
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
      });
    }
  }
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    const previous = turns[index - 1];
    if (turn.role !== "user" || previous?.role !== "assistant" || !turnLooksLikeShortAnswer(turn)) {
      continue;
    }
    const previousText = previewTurnText(previous.parts.at(-1));
    const answerText = turn.parts.filter((part) => !isStickerStateContent(part)).join(" / ");
    const stickerText = stickerSummary(turn);
    if (previousText && answerText) {
      turn.content += "\n\n【把这一问一答连起来理解】\n我问：" + previousText +
        "\n对方回：" + answerText +
        (stickerText ? "\n对方还发了个表情：" + stickerText : "");
    }
  }
  return turns.map(({ role, content }) => ({ role, content }));
}
