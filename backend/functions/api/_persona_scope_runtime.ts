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
  lihuiScope = false,
) {
  const channel = (xingmuScope || lihuiScope) ? "wechat" : "qq";
  const overrideQq = String(personaFacts?.contact_qq || "").trim();
  let account = "";
  if (xingmuScope) {
    account = String(env?.CONTACT_WECHAT || env?.CONTACT_ACCOUNT || "").trim();
  } else if (lihuiScope) {
    account = overrideQq || String(env?.CONTACT_LIHUI_WECHAT || env?.CONTACT_WECHAT || "KaLeZiBen").trim();
  } else if (sutangScope) {
    // 苏棠的联系方式只认 App/后台资料里实际填写的 QQ。
    account = overrideQq;
  } else {
    account = hasDeviceOverride
      ? overrideQq
      : String(env?.CONTACT_QQ || env?.CONTACT_ACCOUNT || "").trim();
  }
  return { channel, account };
}
