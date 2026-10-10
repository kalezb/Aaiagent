import { translateStickerContent } from "./_reply_policy";
import {
  formatChinaMessageTime,
  requestMessageEpochSeconds,
} from "./_time_runtime";

const LEGACY_TRANSCRIPT = /^对方语音转文字[：:]\s*([\s\S]+)$/u;

export function resolveMessageTranscript(content, transcript) {
  const direct = String(transcript || "").trim();
  if (direct) return direct.slice(0, 500);
  const match = String(content || "").trim().match(LEGACY_TRANSCRIPT);
  return match ? match[1].trim().slice(0, 500) : "";
}

export function transcriptSpeaker(role) {
  return role === "assistant" ? "我" : "对方";
}

export function formatTranscriptLine(message, previousEpoch, nowSec, stickerMeanings = undefined) {
  const content = String(message?.content || "").trim();
  if (!content) return "";
  const speaker = transcriptSpeaker(message?.role);
  const transcript = String(message?.transcript || "").trim();
  const stickerAware = translateStickerContent(content, stickerMeanings);
  const shown = transcript && /^\[语音\]$/u.test(content)
    ? "[语音|转写：" + transcript + "]"
    : stickerAware;
  const epoch = requestMessageEpochSeconds(message);
  if (!epoch) return speaker + "：" + shown;
  const gapSeconds = previousEpoch > 0 ? epoch - previousEpoch : Number.POSITIVE_INFINITY;
  const chinaDay = (value: number) => Math.floor((value + 8 * 3600) / 86400);
  const crossedDay = previousEpoch > 0 && chinaDay(epoch) !== chinaDay(previousEpoch);
  const clock = new Date((epoch + 8 * 3600) * 1000).toISOString().slice(11, 16);
  const kind = String(message?.time_kind || "");
  const kindMark = kind === "first_observed" ? "·读到"
    : kind === "derived" ? "·推算"
      : kind === "ai_generated" || kind === "manual" ? "·我方" : "";
  if (gapSeconds < 5 * 60 && !crossedDay) {
    return "【" + clock + kindMark + "】" + speaker + "：" + shown;
  }
  return "【" + formatChinaMessageTime(epoch) + kindMark + "】" + speaker + "：" + shown;
}

export function formatCurrentChatMessage(
  message,
  nowSec = Math.floor(Date.now() / 1000),
  stickerMeanings = undefined,
) {
  return formatTranscriptLine(message, 0, nowSec, stickerMeanings);
}
