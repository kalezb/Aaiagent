import { isExplicitBusinessIntent } from "./_business_scope";
import { EMPTY_AGENT_RULE_STATE, type AgentRuleState } from "./_agent_rule_contract";

// 2026-10-06 真机（善良的小香香）："这上面你有固定的好友吗" 被判成"要联系方式"，
// 于是本地短路直接回"微信不行呀…"，答非所问。原因是这里的 "有" + 8 字内 "好友" 就命中。
// 现在分三档：明确渠道词（动词+渠道）／渠道词在后（微信多少）／"加好友"这类必须带加友动词。
const CONTACT_REQUEST_PATTERN = /(?:加|要|给|发|留|换|互换|交换|有|方便|可以).{0,6}(?:qq|q号|扣扣|企鹅号|联系方式|微信|vx|v信|电话|手机号)|(?:qq|q号|扣扣|企鹅号|联系方式|微信|vx|v信|电话|手机号).{0,6}(?:多少|给我|发我|发一下|加一下|留一下|换一下|方便给|可以给|能给我|是多少)|(?:加|添加|互加|加个|留个|要个|互换|交换).{0,4}(?:好友|朋友)|(?:qq|q号|扣扣|企鹅号|联系方式|微信|vx|v信|电话|手机号).{0,8}(?:多少|几号|发我|给我|留|加|互换|交换)|(?:加|发|给|留).{0,3}(?:个)?q(?:号)?(?:给|我)?|(?:你|你的).{0,4}(?:qq|q号|联系方式|微信|电话|手机号).{0,6}(?:是|多少|发|给|留|加)|(?:联系方式|微信|电话|手机号).{0,6}(?:给我|发我|留一个|加一下)/iu;

// 联系方式只认微信、QQ、电话；不认其他平台账号。
const CONTACT_NEGATION_PATTERN = /(?:(?:^|[^要好行])不|别|不想|不方便|不要|反感|讨厌).{0,5}(?:给|发|留|加|交换|互换|换|要)?.{0,3}(?:qq|q号|联系方式|微信|电话|手机号|好友)/iu;

export function isContactRequest(value) {
  const text = String(value || "").replace(/\s+/gu, "");
  if (!text) return false;
  // "要不/要不要/好不好/行不行" 是委婉提议索要，不是否定拒绝
  const isSuggestion = /(?:要不(?:要|你)?|好不好|行不行|能不能|可不可)/u.test(text);
  if (!isSuggestion && CONTACT_NEGATION_PATTERN.test(text)) return false;
  return CONTACT_REQUEST_PATTERN.test(text);
}

export function countContactRequests(...messageGroups) {
  const seen = new Set();
  let count = 0;
  for (const group of messageGroups) {
    for (const message of Array.isArray(group) ? group : []) {
      if (message?.role !== "user" || !isContactRequest(message?.content)) continue;
      const key = [message.id, message.platform, message.contact_id, message.created_at, message.content].join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      count += 1;
    }
  }
  return count;
}

function normalizeContactChannel(value, fallback = "wechat") {
  const channel = String(value || "").trim().toLowerCase();
  return ["wechat", "qq"].includes(channel) ? channel : fallback;
}

function normalizeContactAccount(value, channel = "wechat") {
  const text = String(value || "").trim();
  if (channel === "qq") {
    const qq = text.replace(/[^0-9]/gu, "");
    return /^\d{5,12}$/u.test(qq) ? qq : "";
  }
  const compact = text.replace(/\s+/gu, "");
  if (/^1[3-9]\d{9}$/u.test(compact)) return compact;
  return /^[A-Za-z][A-Za-z0-9_.-]{4,29}$/u.test(text) ? text : "";
}

function contactQqExpression(value) {
  const normalized = normalizeContactAccount(value, "qq");
  if (!normalized) return "";
  const headLength = Math.min(3, Math.max(1, normalized.length - 1));
  const head = normalized.slice(0, headLength);
  const tail = normalized.slice(headLength).replace(/^0+(?=\d)/u, "") || "0";
  const factor = 10 ** (normalized.length - headLength);
  return head + " × " + factor + " + " + tail;
}

function contactAccountDisplay(value, channel = "wechat") {
  const normalized = normalizeContactAccount(value, channel);
  if (!normalized) return "";
  return channel === "qq" ? contactQqExpression(normalized) : normalized;
}

/** 他这回问的是哪个渠道（微信/QQ/电话）。2026-10-06：原来不分渠道，他问 QQ 她回“微信不行”。 */
function requestedContactChannel(incomingText) {
  const text = String(incomingText || "");
  if (/(?:qq|q号|q 号|扣扣|企鹅)/iu.test(text)) return "qq";
  if (/(?:微信|vx|v信|徽信)/iu.test(text)) return "wechat";
  if (/(?:电话|手机号|手机号码|号码)/u.test(text)) return "phone";
  return "";
}

function contactRefusalReply(
  requestCount,
  businessIntent,
  xingmuScope = true,
  incomingText = "",
  sutangScope = false,
  platform = "",
  agentRuleState: AgentRuleState = EMPTY_AGENT_RULE_STATE,
) {
  if (xingmuScope) {
    if (requestCount <= 1) {
      return businessIntent
        ? "先把型号和情况说清 合适了再把微信给你"
        : "先在这儿聊 私人号不急着加";
    }
    if (requestCount === 2) return "别急 旧机的事对接顺了我发你微信";
    return "微信先留着 等旧机的事说清再给";
  }
  const askedChannel = requestedContactChannel(incomingText);
  if (sutangScope) {
    if (askedChannel === "qq") return "QQ真不行|||婆婆常拿我手机";
    if (askedChannel === "phone") return "电话不行|||家里查得紧";
    const wechatRefusal = "微信顾虑太多|||不想现实生活被打扰";
    const ruleKey = "sutang_contact_refusal_wechat";
    return agentRuleState.textFor(ruleKey, wechatRefusal) || wechatRefusal;
  }
  if (requestCount <= 1) {
    // 他问什么渠道就回什么渠道，别答非所问。
    if (askedChannel === "qq") return "QQ先不加哈 就在这儿聊着挺好";
    if (askedChannel === "phone") return "电话就算啦 我平时不接陌生电话";
    return "微信不行呀 微信上都是工作和熟人 家里人偶尔会看我手机";
  }
  if (requestCount === 2) return "真的不方便 被看到了我担不起这个风险";
  return "我只有个QQ号上面没什么熟人 那个地方安全";
}

export function resolveContactRequestPolicy({
  requestCount,
  stage,
  activity,
  incomingText,
  historyMessages = [],
  messages = [],
  contactChannel = "",
  contactAccount = "",
  contactQq = "",
  xingmuScope = true,
  sutangScope = false,
  lihuiScope = false,
  dealCompleted: providedDealCompleted,
  acceptedBusinessTopic: providedAcceptedBusinessTopic,
  willingToRecycle: providedWillingToRecycle,
  platform = "",
  agentRuleState = EMPTY_AGENT_RULE_STATE,
}: {
  requestCount: number;
  stage?: number;
  activity?: any;
  incomingText?: string;
  historyMessages?: any[];
  messages?: any[];
  contactChannel?: string;
  contactAccount?: string;
  contactQq?: string;
  xingmuScope?: boolean;
  sutangScope?: boolean;
  lihuiScope?: boolean;
  dealCompleted?: boolean;
  acceptedBusinessTopic?: boolean;
  willingToRecycle?: boolean;
  platform?: string;
  agentRuleState?: AgentRuleState;
}) {
  const count = Math.max(0, Number(requestCount || 0));
  const inMemoryExchanges = [...historyMessages, ...messages]
    .filter((message) => message?.role === "user").length;
  const totalExchanges = Math.max(Number(activity?.totalExchanges || 0), inMemoryExchanges);
  const normalizedChannel = (xingmuScope || lihuiScope)
    ? "wechat"
    : sutangScope
      ? "qq"
      : normalizeContactChannel(contactChannel, "qq");
  const rawAccount = xingmuScope
    ? contactAccount
    : lihuiScope
      ? (contactAccount || "KaLeZiBen")
      : sutangScope
        ? (contactAccount || contactQq || "")
        : (contactAccount || (normalizedChannel === "qq" ? contactQq : ""));
  const normalizedAccount = normalizeContactAccount(rawAccount, normalizedChannel);

  // 苏棠什么时候给联系方式由模型结合聊天自然判断；这里不再做固定轮数和固定话术拦截。
  if (sutangScope) {
    return {
      isRequest: count > 0,
      allowed: false,
      reply: "",
      requestCount: count,
      contactChannel: normalizedChannel,
      contactAccount: normalizedAccount,
      contactDisplay: contactAccountDisplay(normalizedAccount, normalizedChannel),
    };
  }

  if (count <= 0) {
    const isProactiveAllowed = Boolean(
      (sutangScope || lihuiScope) &&
      normalizedAccount &&
      totalExchanges >= (lihuiScope ? 6 : 10)
    );
    return {
      isRequest: false,
      allowed: isProactiveAllowed,
      reply: "",
      requestCount: 0,
      contactChannel: "",
      contactAccount: "",
      contactDisplay: "",
    };
  }

  const allMessages = [...historyMessages, ...messages];
  const combinedMessages = allMessages.filter((message) => message?.role === "user");
  const businessIntent = isExplicitBusinessIntent(incomingText) || combinedMessages.some((message) => isExplicitBusinessIntent(message.content));
  const activeDays = Number(activity?.activeDays || 0);
  let allowed = false;
  if (xingmuScope) {
    const dealCompleted = providedDealCompleted === true || combinedMessages.some((message) =>
      /(?:收成了|成交了|已经寄了|已经收了|打款了|钱到了|处理完了)/u.test(String(message.content || ""))
    );
    const acceptedBusinessTopic = providedAcceptedBusinessTopic === true ||
      combinedMessages.some((message) => isExplicitBusinessIntent(message.content));
    const willingToRecycle = providedWillingToRecycle === true;
    allowed = Boolean(
      normalizedAccount &&
      Number(stage || 0) >= 5 &&
      (dealCompleted || acceptedBusinessTopic || willingToRecycle)
    );
  } else if (lihuiScope) {
    allowed = Boolean(normalizedAccount && count >= 1);
  } else {
    const requiredMessages = businessIntent ? 10 : 30;
    allowed = Boolean(
      normalizedAccount &&
      count >= 3 &&
      totalExchanges >= requiredMessages &&
      activeDays >= 2
    );
  }
  const reply = allowed
    ? (xingmuScope
        ? "行 那我把私人微信号给你：" + contactAccountDisplay(normalizedAccount, normalizedChannel) + " 加的时候说下你是谁"
        : lihuiScope
          ? "行啊 我微信 " + contactAccountDisplay(normalizedAccount, normalizedChannel) + " 加上聊"
          : "可以 我QQ是" + contactAccountDisplay(normalizedAccount, normalizedChannel) + " 加的时候说下你是谁")
    : (xingmuScope || lihuiScope ? "" : contactRefusalReply(count, businessIntent, xingmuScope, incomingText, sutangScope, platform, agentRuleState));

  return {
    isRequest: true,
    allowed,
    reply,
    requestCount: count,
    businessIntent,
    contactChannel: normalizedChannel,
    contactAccount: normalizedAccount,
    contactDisplay: contactAccountDisplay(normalizedAccount, normalizedChannel),
  };
}

const CONTACT_DISCLOSURE_PATTERN = /(?:qq|q号|扣扣|企鹅号|私人号|微信号?|vx|v信|手机号|电话|联系方式).{0,24}\d{5,12}|\d{5,12}.{0,24}(?:qq|q号|扣扣|企鹅号|私人号|微信号?|vx|v信|手机号|电话|联系方式)|(?:加|联系).{0,12}\d{5,12}/iu;
const CONTACT_CHANNEL_PATTERN = /(?:qq|q号|扣扣|企鹅号|私人号|微信号?|vx|v信|手机号|电话)/iu;

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function sanitizeContactDisclosure(value, {
  allowed = false,
  contactChannel = "",
  contactAccount = "",
  contactQq = "",
  xingmuScope = false,
  sutangScope = false,
  lihuiScope = false,
} = {}) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";
  const normalizedChannel = (xingmuScope || lihuiScope)
    ? "wechat"
    : sutangScope
      ? "qq"
      : normalizeContactChannel(contactChannel, "qq");
  const rawAccount = xingmuScope
    ? contactAccount
    : lihuiScope
      ? (contactAccount || "KaLeZiBen")
      : sutangScope
        ? (contactAccount || contactQq || "")
        : (contactAccount || (normalizedChannel === "qq" ? contactQq : ""));
  const normalizedAccount = normalizeContactAccount(rawAccount, normalizedChannel);
  const fallback = xingmuScope
    ? "微信先不急 在这聊挺好"
    : "联系方式先不发了 在这儿聊就行";
  const accountPattern = normalizedAccount ? new RegExp(escapeRegExp(normalizedAccount), "iu") : null;
  const containsDisclosure = (text) =>
    CONTACT_DISCLOSURE_PATTERN.test(text) ||
    Boolean(accountPattern?.test(text) && (CONTACT_CHANNEL_PATTERN.test(text) || !allowed || sutangScope));
  const segments = rawValue
    .split(/(\|\|\||\r?\n)/u)
    .map((segment) => {
      if (segment === "|||" || segment === "\n" || segment === "\r\n" || !segment.trim()) return segment;
      const wrongChannelPattern = normalizedChannel === "wechat"
        ? /(?:qq|q号|扣扣|企鹅号|手机号|电话)/iu
        : /(?:微信号?|vx|v信|手机号|电话)/iu;
      const isChannelRefusalOrComparison = /(?:不行|不加|不给|不上|没有|不方便|比|很少用|熟人|老公|担不起|安全|干净|不便)/u.test(segment);
      if (wrongChannelPattern.test(segment) && !isChannelRefusalOrComparison) return fallback;
      if (!containsDisclosure(segment)) return segment;
      if (allowed && normalizedAccount && segment.includes(normalizedAccount)) return segment;
      return fallback;
    })
    .filter((segment) => segment.length > 0);

  const cleaned = segments.join("").trim();
  if (!cleaned) return fallback;
  if (!containsDisclosure(cleaned) && CONTACT_CHANNEL_PATTERN.test(cleaned) && /(?:加|给|发|留|联系).{0,8}(?:我|你)/iu.test(cleaned)) {
    const isConditionalOrRefusal = /(?:才考虑|聊得久|久一点|看能不能|以后再|先不|不给|不发|不留|不加|不方便|等等看|熟了再|合适再)/u.test(cleaned);
    if (!isConditionalOrRefusal) {
      return fallback;
    }
  }
  return cleaned;
}


