export interface MediaGroupLike {
  persona_id?: string;
  platform?: string;
  id: string;
  topic_key?: string;
  name?: string;
  trigger_keywords?: string | string[];
}

export interface MediaMatchOptions {
  requireExplicitRequest?: boolean;
}

export interface MediaAssetLike {
  id: string;
  group_id?: string;
  file_name?: string;
  content_type?: string;
}

export function parseMediaKeywords(value: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(value)
    ? value
    : (() => {
        const text = String(value || "").trim();
        if (!text) return [];
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // Plain text lists are supported as a dashboard-friendly fallback.
        }
        return text.split(/[\n,，、;；]+/u);
      })();

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const keyword = String(item || "").trim().toLocaleLowerCase();
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    result.push(keyword);
  }
  return result;
}

function compact(value: string): string {
  return String(value || "").replace(/\s+/gu, "").toLocaleLowerCase();
}

function recentCompactTexts(value: string | string[]): string[] {
  return (Array.isArray(value) ? value : [value])
    .map((item) => compact(item))
    .filter(Boolean)
    .slice(-3);
}

const MEDIA_NEGATION = /(?:不想看|不要发|别发|不用发|不发|别给我发|不要给我发)/u;
const NON_PERSONAL_MEDIA_OBJECT = /(?:机器|设备|手机|电脑|平板|屏幕|截图|界面|房间|宿舍|家里|办公室|车子|汽车|车|物品|东西|物件|藏品|手办|宠物|猫|狗)/u;
const EXPLICIT_MEDIA_REQUEST = /(?:想看|想看看|想看一下|看看|看一下|看下|发张|发一张|发个|发一下|发我|给我发|给我看|让我看|能发|可以发|能不能发|给张|给一张|给个|给一下|给我|来张|来一张|来一下).{0,12}(?:照片|照|图片|本人|长相|长什么样|长啥样|日常照|身材照|身材|腿|腰)/u;
const EXPLICIT_MEDIA_QUESTION = /(?:照片|照|本人|长相|长什么样|长啥样|日常照|身材照|身材|腿|腰).{0,6}(?:有吗|能看吗|可以看吗|看看|看一下|发一下|给一下|吗)/u;
const EXPLICIT_PERSONAL_APPEARANCE_REQUEST = /(?:(?:可以|能不能|能|想)?(?:看看|看一下|看下|瞧瞧)(?:你|你本人|你的)(?:样子|长相|模样|照片)|(?:看看|看一下|看下|瞧瞧)你(?:可以|行|方便)(?:吗|嘛|不|么)?)/u;
const EXCHANGE_MEDIA_REQUEST = /(?:以图换图|交换图片)/u;
const BODY_MEDIA_TERM = /(?:身材照|腿照|腰照|身材|腿|腰)/u;
const BODY_MEDIA_REQUEST = /(?:想看|想看看|看看|看下|看一下|发张|发一张|发个|发我|发一下|给张|给一张|给个|给一下|能发|可以发|能不能发|给我看|让我看|拍张|拍一张|拍个|拍一下|有吗|能看吗|可以看吗|怎么样|怎么样了)/u;
const CONTEXTUAL_MEDIA_FOLLOW_UP = /^(?:(?:那|那就|再|继续)?(?:发|看|拍|来|要|给)(?:我)?(?:一下|个|一张|张|吧|呗|吗|嘛|呀|啊){0,3}|(?:可以|行|好|嗯)(?:呀|啊|吧|呗|吗)?|(?:照片|照|图片))[？?]?$/u;
/**
 * 2026-10-06 用户要求：正常的“想看你长什么样、看看身材照”要放开给看；
 * 只有私密、裸照、露骨视频这类才算越界请求。
 */
export function isExplicitPrivateMediaRequest(value: string) {
  const text = String(value || "").replace(/\s+/gu, "");
  if (!text) return false;
  return /(?:私密|隐私|裸|不穿|脱(?:了|掉|光)|光着|身体细节|开视频|视频看|视频里|直播)/u.test(text);
}

const MEDIA_DIRECTIVE = /^\s*\[\[SEND_MEDIA:([a-z0-9_-]{1,64})\]\]\s*$/iu;
const MEDIA_DIRECTIVE_ANYWHERE = /\[\[SEND_MEDIA:[^\]]*\]\]/giu;
const PHOTO_INTENT_CUE = /(?:照片|图片|本人|样子|长相|模样|日常照|身材照|腿照|腰照|身材|腿|腰|看(?:看|一下|下)|发(?:一下|张|个)|给(?:一下|张|个)|拍(?:一下|张|个))/u;

export type PersonalPhotoIntent = "daily" | "body" | "none";

export function parseMediaDirective(value: string): string {
  const match = String(value || "").match(MEDIA_DIRECTIVE);
  return String(match?.[1] || "").trim().toLocaleLowerCase();
}

export function stripMediaDirective(value: string): string {
  return String(value || "").replace(MEDIA_DIRECTIVE_ANYWHERE, "").trim();
}

export function buildMediaDirectiveInstruction(groups: MediaGroupLike[] = []): string {
  const options = (Array.isArray(groups) ? groups : [])
    .map((group) => ({
      id: String(group?.id || "").trim().toLocaleLowerCase(),
      label: String(group?.name || group?.topic_key || group?.id || "").replace(/[\r\n|]/gu, " ").trim().slice(0, 24),
    }))
    .filter((group) => MEDIA_DIRECTIVE.test("[[SEND_MEDIA:" + group.id + "]]") && group.label);
  if (!options.length) return "";

  const daily = options.find((group) => group.id === "daily");
  const body = options.find((group) => group.id === "body");
  const selectionRule = body
    ? (daily
        ? "没有明确提出身材照、腿照或腰照时，只能选 " + daily.id + "=" + daily.label + "，不能自行升级到 " + body.id + "=" + body.label +
          "；只有对方这轮或紧邻上文明确指定身材、腿或腰时才可选 " + body.id + "=" + body.label + "。"
        : "没有明确提出身材照、腿照或腰照时，不要选择 " + body.id + "=" + body.label + "，应正常文字回复；只有对方这轮或紧邻上文明确指定身材、腿或腰时才可选该组。")
    : "只能选择与对方当前明确请求相符的图片组；含义不确定时正常文字回复。";

  return "【图片动作｜系统指令】当前可用图片组：" +
    options.map((group) => group.id + "=" + group.label).join("；") +
    "。当且仅当结合最近完整对话，能明确判断对方现在是在向你本人索要照片，并且仍期待你回复时，" +
    // 2026-10-06 用户要求：正常的照片请求要“欲拒还迎地给”——先说一句再给图，不要闷声直接发。
    "先写一句欲拒还迎的话（一句就够，带点玩味，别直接答应也别拒绝，例如你这人倒是挺直接、行吧 就给你看一眼），" +
    "然后另起一行单独输出 [[SEND_MEDIA:组ID]]。只有他走系统以图换图（直接发来换图请求）时不要配文字，直接给。连续几轮索要但对方省略了“照片”等词时，" +
    "也要结合上文判断，不要因为缺少固定词语就机械拒绝。只判断需要发哪类照片：" + selectionRule +
    "对方只是夸你、讨论照片、聊过去看过什么、" +
    "要求实时现场、天气、位置或穿着，或者已经明确不想看时，不得输出该标记。" +
    "如果最近在聊机器、设备、手机、电脑、房间、物品或截图，随后对方只说发一下、给一下、看一下，也仍然是在说那个对象，不得当成本人照片请求。" +
    "若含义不确定、只是在试探、涉及私密内容或不能确定图片组，就正常文字回复。该标记用户不可见，后端会再次校验。";
}

export function isExplicitMediaRequest(value: string): boolean {
  const incoming = compact(value);
  if (!incoming || MEDIA_NEGATION.test(incoming)) return false;
  if (NON_PERSONAL_MEDIA_OBJECT.test(incoming)) return false;
  return EXCHANGE_MEDIA_REQUEST.test(incoming) ||
    EXPLICIT_MEDIA_REQUEST.test(incoming) ||
    EXPLICIT_PERSONAL_APPEARANCE_REQUEST.test(incoming) ||
    EXPLICIT_MEDIA_QUESTION.test(incoming);
}

export function isExplicitBodyMediaRequest(value: string): boolean {
  const incoming = compact(value);
  if (!incoming || MEDIA_NEGATION.test(incoming) || !BODY_MEDIA_TERM.test(incoming)) return false;
  return BODY_MEDIA_REQUEST.test(incoming);
}

export function shouldClassifyPersonalPhotoIntent(value: string | string[]): boolean {
  return recentCompactTexts(value)
    .some((text) => PHOTO_INTENT_CUE.test(text));
}

export function normalizePersonalPhotoIntent(value: string): PersonalPhotoIntent {
  const normalized = String(value || "")
    .trim()
    .replace(/^[`"'“”\s]+|[`"'“”\s。.!！]+$/gu, "")
    .toLocaleUpperCase();
  if (normalized === "DAILY") return "daily";
  if (normalized === "BODY") return "body";
  return "none";
}

export function hasNonPersonalMediaContext(value: string | string[]): boolean {
  const texts = recentCompactTexts(value);
  if (!texts.length) return false;

  const current = texts[texts.length - 1];
  if (NON_PERSONAL_MEDIA_OBJECT.test(current)) return true;
  if (!CONTEXTUAL_MEDIA_FOLLOW_UP.test(current)) return false;
  return texts.slice(0, -1).some((text) => NON_PERSONAL_MEDIA_OBJECT.test(text));
}

export function hasContextualMediaRequest(value: string | string[]): boolean {
  const texts = recentCompactTexts(value);
  if (!texts.length) return false;

  const current = texts[texts.length - 1];
  if (isExplicitMediaRequest(current) || isExplicitBodyMediaRequest(current)) return true;
  if (!CONTEXTUAL_MEDIA_FOLLOW_UP.test(current)) return false;
  return texts.slice(0, -1).some((text) => isExplicitMediaRequest(text));
}

export function hasExplicitBodyMediaContext(value: string | string[]): boolean {
  const texts = recentCompactTexts(value);
  if (!texts.length) return false;

  const current = texts[texts.length - 1];
  if (isExplicitBodyMediaRequest(current)) return true;
  const previous = texts[texts.length - 2] || "";
  return Boolean(previous && isExplicitBodyMediaRequest(previous) && CONTEXTUAL_MEDIA_FOLLOW_UP.test(current));
}

export function resolveMediaGroupForDirective<T extends MediaGroupLike>(
  groups: T[],
  requestedId: string,
  recentUserContext: string | string[] = [],
): T | null {
  const normalizedId = String(requestedId || "").trim().toLocaleLowerCase();
  if (!normalizedId) return null;

  const scopedGroups = Array.isArray(groups) ? groups : [];
  const requested = scopedGroups.find((group) =>
    String(group?.id || "").trim().toLocaleLowerCase() === normalizedId
  );
  if (!requested) return null;
  if (normalizedId !== "body" || hasExplicitBodyMediaContext(recentUserContext)) return requested;

  return scopedGroups.find((group) =>
    String(group?.id || "").trim().toLocaleLowerCase() === "daily"
  ) || null;
}

/**
 * 只有一句“看一下 / 看看”，没带任何照片线索。
 * 2026-10-05：这种情况先问“看什么？”，不要直接当成要本人照片。
 */
export function isBareLookRequest(value: string): boolean {
  const incoming = compact(value);
  if (!incoming) return false;
  return /^(?:那|那就|再|继续)?(?:\u770b\u4e00\u4e0b|\u770b\u770b|\u770b\u4e0b|\u770b\u5565|\u770b\u4ec0\u4e48)(?:\u5457|\u5427|\u5440|\u554a)?[\uff1f?]?$/u.test(incoming);
}

export function isRealtimeImageRequest(value: string): boolean {
  const incoming = compact(value);
  if (!incoming) return false;

  const currentCue = /(?:\u73b0\u5728|\u6b64\u523b|\u8fd9\u4f1a\u513f|\u9a6c\u4e0a|\u5b9e\u65f6|\u521a\u521a|\u521a\u624d|\u6b64\u65f6\u6b64\u523b)/u;
  const visualCue = /(?:\u62cd|\u7167\u7247|\u7167\u76f8|\u81ea\u62cd|\u56fe\u7247|\u65e5\u5e38\u7167|\u8eab\u6750\u7167|\u817f\u7167|\u770b\u770b|\u770b\u4e00\u4e0b|\u6837\u5b50|\u957f\u76f8|\u8eab\u6750|\u7a7f\u4ec0\u4e48|\u7a7f\u7684\u4ec0\u4e48|\u7a7f\u5565|\u7a7f\u7684\u5565|\u5728\u5e72\u561b|\u5728\u5e72\u4ec0\u4e48|\u505a\u4ec0\u4e48|\u5728\u54ea\u91cc|\u5728\u54ea)/u;
  const locationWeatherCue = /(?:\u4f60\u90a3\u8fb9|\u4f60\u90a3\u91cc|\u91cd\u5e86|\u5916\u9762).*(?:\u5929\u6c14|\u4e0b\u96e8|\u4e0b\u96ea|\u51b7\u4e0d\u51b7|\u70ed\u4e0d\u70ed|\u600e\u4e48\u6837)/u;
  return (currentCue.test(incoming) && visualCue.test(incoming)) || locationWeatherCue.test(incoming);
}

export function findMatchingMediaGroup<T extends MediaGroupLike>(
  groups: T[],
  incomingText: string,
  options: MediaMatchOptions = {},
): { group: T; keyword: string } | null {
  const incoming = compact(incomingText);
  if (!incoming) return null;
  if (isRealtimeImageRequest(incomingText)) return null;
  if (options.requireExplicitRequest && !isExplicitMediaRequest(incomingText)) return null;

  // 2026-10-06 真机：触发词写的是“看看身材/看看腿”，对方说的是“看看你的身材照”，
  // 子串匹配被“你的”卡住，于是身材照发不出去。这里把代词和语气词抹掉再比。
  const loose = (value: string) => compact(value).replace(/[你您的了我他她它]/gu, "");
  const looseIncoming = loose(incomingText);
  let best: { group: T; keyword: string } | null = null;
  for (const group of groups || []) {
    for (const keyword of parseMediaKeywords(group.trigger_keywords)) {
      const exact = compact(keyword);
      const looseKeyword = loose(keyword);
      const hit = incoming.includes(exact) ||
        (looseKeyword.length >= 2 && looseIncoming.includes(looseKeyword));
      if (!hit) continue;
      if (!best || keyword.length > best.keyword.length) {
        best = { group, keyword };
      }
    }
  }
  return best;
}

export function chooseMediaAsset<T extends MediaAssetLike>(
  assets: T[],
  recentAssetIds: string[] = [],
  randomUnit = Math.random(),
): T | null {
  const candidates = (assets || []).filter((asset) => String(asset?.id || "").trim());
  if (!candidates.length) return null;

  const recent = new Set(recentAssetIds.map((value) => String(value || "").trim()).filter(Boolean));
  const fresh = candidates.filter((asset) => !recent.has(asset.id));
  const pool = fresh.length ? fresh : candidates;
  const normalized = Number.isFinite(randomUnit) ? Math.max(0, Math.min(0.999999, randomUnit)) : Math.random();
  return pool[Math.floor(normalized * pool.length)] || pool[0];
}

export function mediaDownloadUrl(assetId: string): string {
  return "/api/media/" + encodeURIComponent(String(assetId || "").trim());
}

/**
 * SQL for the media groups a persona is allowed to send.
 *
 * A persona sees its own scoped groups plus the shared ones
 * (persona_id = '' AND platform = ''). The union matters because the photo
 * library is shared: while a shared group was invisible to the persona that
 * used it, 星暮 lost its photos and 苏棠 never got any.
 */
export function buildMediaGroupQuery(
  personaId: string,
  platform: string,
  groupId = "",
): { sql: string; params: string[] } {
  const persona = String(personaId || "").trim();
  const normalizedPlatform = String(platform || "").trim().toLocaleLowerCase();
  const starSoulScope = persona === "female" && normalizedPlatform === "soul";
  const scopedClause = starSoulScope
    ? "(persona_id = ? AND platform = ? AND id IN ('daily', 'body'))"
    : "(persona_id = ? AND platform = ?)";
  const sharedClause = "(persona_id = '' AND platform = '')";
  const sql = "SELECT id, name, topic_key, trigger_keywords, persona_id, platform FROM media_groups " +
    "WHERE is_active = 1 AND (" + scopedClause + " OR " + sharedClause + ")" +
    (groupId ? " AND id = ?" : "") +
    " ORDER BY created_at DESC";
  const params = [persona, normalizedPlatform];
  if (groupId) params.push(String(groupId).trim());
  return { sql, params };
}
