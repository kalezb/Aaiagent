const SIMPLE_GREETING = /^(?:(?:哈喽|嗨|你好|您好|hello|hi)(?:呀|啊|哈)?(?:另一面的你)?|(?:早上好|早呀|早安|下午好|晚上好|晚安)(?:呀|啊|哈|呢)?)[\s，,！!。.~～]*$/iu;

export function isSimpleGreetingTurn(value) {
  const compact = String(value || "")
    .replace(/\[\[[\s\S]*?\]\]/gu, "")
    .replace(/\s+/gu, "")
    .trim();
  if (!compact || compact.length > 18) return false;
  return SIMPLE_GREETING.test(compact);
}

/**
 * 只在模型返回空内容或坏格式，且对方这轮只是简单问候时使用。
 * 普通问题、安全拦截和坏掉的复杂回复仍交给上层停止，不生成空话。
 */
export function localGreetingFallback(value) {
  const compact = String(value || "").replace(/\s+/gu, "").trim();
  if (!isSimpleGreetingTurn(compact)) return "";
  const variants = [
    "哈喽呀 这会儿在忙什么呢",
    "嗨 今天过得怎么样",
  ];
  let hash = 0;
  for (const character of compact) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return variants[hash % variants.length];
}
