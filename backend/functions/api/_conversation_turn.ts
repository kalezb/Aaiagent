import { formatTranscriptLine } from "./_transcript_runtime";
import { requestMessageEpochSeconds } from "./_time_runtime";

const SAME_ROLE_TURN_WINDOW_SECONDS = 10 * 60;

function normalizedRole(message) {
  return message?.role === "assistant" ? "assistant" : "user";
}

function sameLine(left, right) {
  return left.role === right.role &&
    left.content === right.content &&
    (left.epoch === 0 || right.epoch === 0 || Math.abs(left.epoch - right.epoch) <= 300);
}

function shouldJoinTurn(previous, current) {
  if (!previous || previous.role !== current.role) return false;
  if (current.forceMerge) return true;
  if (!previous.epoch || !current.epoch) return false;
  const gap = current.epoch - previous.epoch;
  return gap >= 0 && gap <= SAME_ROLE_TURN_WINDOW_SECONDS;
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
    const content = String(message?.content || "").trim();
    if (!content) return;
    const line = { role: normalizedRole(message), content, epoch, forceMerge };
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
    } else {
      turns.push({
        role: entry.role,
        content: entry.content,
        epoch: entry.epoch,
      });
    }
  }
  return turns.map(({ role, content }) => ({ role, content }));
}
