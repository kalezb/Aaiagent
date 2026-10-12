export function isXingmuPersonaScope(personaId, personaPrompt) {
  return String(personaId || "").trim() === "female" ||
    /(?:王雅慧|星暮)/u.test(String(personaPrompt || ""));
}

export function resolveContactConfig(
  env,
  xingmuScope,
  personaFacts = null,
  hasDeviceOverride = false,
  sutangScope = false,
) {
  const channel = xingmuScope ? "wechat" : sutangScope ? "douban" : "qq";
  const overrideQq = String(personaFacts?.contact_qq || "").trim();
  let account = "";
  if (xingmuScope) {
    account = String(env?.CONTACT_WECHAT || env?.CONTACT_ACCOUNT || "").trim();
  } else if (sutangScope) {
    account = overrideQq || String(env?.CONTACT_DOUBAN || env?.CONTACT_ACCOUNT || "sutang2026").trim();
  } else {
    account = hasDeviceOverride
      ? overrideQq
      : String(env?.CONTACT_QQ || env?.CONTACT_ACCOUNT || "").trim();
  }
  return { channel, account };
}
