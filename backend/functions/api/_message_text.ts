export function latestIncomingText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return String(messages[index]?.content || "").trim();
  }
  return "";
}

export function compactQuestionText(value) {
  return String(value || "").replace(/\s+/gu, "");
}
