export function isXingmuPersonaScope(personaId, personaPrompt) {
  return String(personaId || "").trim() === "female" ||
    /(?:王雅慧|星暮)/u.test(String(personaPrompt || ""));
}

export function resolveContactConfig(
  env,
  xingmuScope,
  personaFacts = null,
  hasDeviceOverride = false,
) {
  const channel = xingmuScope ? "wechat" : "douban";
  const overrideQq = String(personaFacts?.contact_qq || "").trim();
  const account = xingmuScope
    ? String(env?.CONTACT_WECHAT || env?.CONTACT_ACCOUNT || "").trim()
    : (overrideQq || String(env?.CONTACT_DOUBAN || env?.CONTACT_ACCOUNT || "").trim());
  return { channel, account };
}
