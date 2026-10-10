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
  const channel = xingmuScope ? "wechat" : "qq";
  const overrideQq = String(personaFacts?.contact_qq || "").trim();
  const account = channel === "qq"
    ? (hasDeviceOverride
        ? overrideQq
        : String(env?.CONTACT_QQ || env?.CONTACT_ACCOUNT || "").trim())
    : String(env?.CONTACT_WECHAT || env?.CONTACT_ACCOUNT || "").trim();
  return { channel, account };
}
