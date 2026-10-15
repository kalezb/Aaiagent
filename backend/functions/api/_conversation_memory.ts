const QUESTION_MARKERS =
  /(?:\?|？|什么|怎么|为什么|哪|哪里|谁|吗|呢|多少|几|是不是|要不要|行不行|好不好)/u;
const PROMISE_MARKERS =
  /(?:我会|我回头|下次|到时候|等你|我给你|我发你|改天|晚点|记得)/u;

function cleanLine(value, limit = 80) {
  return String(value || "")
    .replace(/[\r\n]+/gu, " ")
    .trim()
    .slice(0, limit);
}

function lastMatching(messages, role, pattern) {
  return [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) =>
      String(message?.role || "") === role &&
      pattern.test(cleanLine(message?.content, 160))
    ) || null;
}

/**
 * 长期记忆只放对下一轮有用的东西，不把旧聊天原样塞回去。
 */
export function buildConversationMemoryPrompt({
  summary = "",
  olderMessages = [],
} = {}) {
  const older = (Array.isArray(olderMessages) ? olderMessages : [])
    .filter((message) => message && cleanLine(message.content));
  if (!older.length && !String(summary || "").trim()) return "";

  const unfinished = lastMatching(older, "user", QUESTION_MARKERS);
  const promise = lastMatching(older, "assistant", PROMISE_MARKERS);
  const recent = older
    .slice(-4)
    .map((message) => {
      const speaker = String(message?.role || "") === "assistant" ? "我" : "对方";
      return speaker + "：" + cleanLine(message?.content);
    })
    .filter(Boolean);

  const lines = [];
  if (unfinished) lines.push("- 没聊完的：" + cleanLine(unfinished.content));
  if (promise) lines.push("- 我上次答应过：" + cleanLine(promise.content));
  if (recent.length) lines.push("- 较早聊过：" + recent.join(" / "));
  const compactSummary = cleanLine(summary, 300);
  if (compactSummary) lines.push("- 更早的摘要：" + compactSummary);
  if (!lines.length) return "";
  return "【长期记忆｜只作背景，不要硬复述】\n" + lines.join("\n");
}
