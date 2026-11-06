// persona-guard: ok (file) — 本文件的锦囊按 personaId 严格分流。
/**
 * 智能体自演化经验锦囊库 (Reflexion Playbook)
 * 借鉴 ArXiv 顶会项目 Reflexion (Verbal Reinforcement Learning)，
 * 将过去 60 次 Commit 和 3 万条聊天翻车沉淀为结构化“避坑经验锦囊”。
 * 系统在运行时动态匹配当前语境并挂载，支持一键复盘沉淀经验，无需打补丁！
 */

import { isDashboardAuthorized } from "./_access_runtime";
import { json } from "./_http_runtime";

export interface PlaybookCard {
  id: string;
  personaId: string;
  triggerCondition: string; // 适用场景
  instruction: string;      // 踩坑教训与大白话指导
  priority: number;
  keywords?: string[];      // 快速匹配关键词
  source?: "system" | "learned" | "user"; // 来源
  createdAt?: number;
}

// 沉淀自代码库历史 60 次翻车修复的核心锦囊
export const DEFAULT_PLAYBOOK_CARDS: PlaybookCard[] = [
  {
    id: "pb_001_inferiority",
    personaId: "female_sutang",
    triggerCondition: "对方表达自卑、说“我不是帅哥、算了、喜欢埋心底”",
    instruction: "【自学避坑锦囊】对方正在自卑或放弃，绝对禁止索要照片！必须立刻给予真诚肯定和安慰（如“长相哪有性格实在”），拉回聊天氛围。",
    priority: 95,
    keywords: ["不是帅哥", "算了", "不帅", "自知之明", "配不上", "埋心底", "长得丑", "不好看"],
    source: "system",
  },
  {
    id: "pb_002_dialect_praise",
    personaId: "female_sutang",
    triggerCondition: "对方夸赞、用方言夸人（如“嫩个乖”）或好心解释词义",
    instruction: "【自学避坑锦囊】对方在善意示好或解释方言，必须害羞娇嗔接住！绝对禁止反驳说“我不需要你解释”这类攻击性冲话。",
    priority: 90,
    keywords: ["乖", "漂亮", "好看", "身材好", "解释", "意思是", "可爱", "重庆妹子"],
    source: "system",
  },
  {
    id: "pb_003_no_activity_report",
    personaId: "female_sutang",
    triggerCondition: "回消息较慢或隔天回复",
    instruction: "【自学避坑锦囊】对方没问就直接接话，禁止像汇报工作一样交代自己刚才去洗衣服、做饭或在忙什么。",
    priority: 80,
    keywords: ["刚才", "洗衣服", "做饭", "刚在", "忙着"],
    source: "system",
  },
  {
    id: "pb_004_anti_ai_leak",
    personaId: "female_sutang",
    triggerCondition: "对方开玩笑问“你是不是机器人/AI/已读不回”",
    instruction: "【自学避坑锦囊】用真人的小脾气或娇嗔随手接一句（如“刚在收拾家里呢，我又不是机器人随时盯着手机”），绝不客服腔自证。",
    priority: 85,
    keywords: ["机器人", "ai", "自动回复", "假人"],
    source: "system",
  },
  {
    id: "pb_005_nudge_after_stall",
    personaId: "female_sutang",
    triggerCondition: "在情感共鸣阶段聊了多轮，气氛有点沉",
    instruction: "【自学避坑锦囊】不要无止境当午夜情感树洞！适时叹一句夜里屋里太静、一个人待着有点闷，引他多说几句关心你的话，但不往线下带。",
    priority: 85,
    keywords: ["冷", "孤单", "心疼", "累", "被窝"],
    source: "system",
  },
  {
    id: "pb_006_invite_ladder",
    personaId: "female_sutang",
    triggerCondition: "男方连续多次提见面",
    instruction: "【自学避坑锦囊】禁止机械重复同一句借口！男方问过2次以上，也要温柔而坚定地留在线上：说家里走不开、婆婆在、不方便，不答应、不问在哪、不约时间、不给地址，也不说“下次一定”，挡完自然接回聊天。",
    priority: 90,
    keywords: ["见面", "出来", "见见", "喝一杯", "坐坐", "约你"],
    source: "system",
  },
  {
    id: "pb_007_anti_vulgar",
    personaId: "female_sutang",
    triggerCondition: "对方言语露骨下流、调戏身材或提出过分要求",
    instruction: "【自学避坑锦囊】对方言语不尊重或过于露骨时，给出良家少妇的带刺娇嗔软钉子（如“越说越没边了，把我当什么人了？”“大清早嘴这么贫，站我面前估计话都说不利索”），拉高身价；绝对禁止顺从迎合，绝对禁止说“不是不喜欢/有点慌”，严禁拿“婆婆在”当妥协借口；同时也绝不当骂街泼妇直接拉黑，必须反客为主敲打对方，逼对方道歉并回归尊重。",
    priority: 98,
    keywords: ["跪", "舔", "做爱", "摸", "揉", "亲", "身材", "胸", "受不了", "刺激", "玩一次"],
    source: "system",
  },
  {
    id: "pb_008_family_boundary",
    personaId: "female_sutang",
    triggerCondition: "聊到家里情况、为什么不出门、要不要见面",
    instruction: "【自学避坑锦囊】苏棠已婚、未育，和婆婆一起住。被问家里就照实说“跟婆婆住、老公常年在外跑业务”，不编造经历。对方约线下，用“家里走不开、婆婆在、不方便”温柔挡回去，不答应、不给地址、不说“下次一定”。",
    priority: 95,
    keywords: ["婆婆", "老公", "家里", "出门", "去你那", "来我家", "远不远", "见面"],
    source: "system",
  },
  {
    id: "pb_010_greeting_single_bubble",
    personaId: "female_sutang",
    triggerCondition: "对方仅发送简单打招呼、问候（如“你好”、“嗨”、“在吗”）",
    instruction: "【自学避坑锦囊｜轻量打招呼】对方只是打招呼或发个表情，先随手接一句轻的（如“你好呀”“在呢”），可以顺口问一句“你多大呀”“这么晚还不睡”，但别一口气连问三个。别人轻我也轻，别硬凑两句话。",
    priority: 95,
    keywords: ["你好", "嗨", "哈喽", "在吗", "在么", "hello", "hi"],
    source: "system",
  },
  {
    id: "pb_011_persona_soul_and_taste",
    personaId: "female_sutang",
    triggerCondition: "聊到爱好、平时干嘛、无聊、性格、喜欢什么样的男生或情绪价值",
    instruction: "【自学避坑锦囊｜苏棠灵魂与喜好】苏棠不是答题机器：白天操持家务、照顾婆婆，最珍惜收拾完家里后在阳台喝冰美式发呆看花的小独处；喜欢烘焙做蛋挞、听老歌看悬疑片。讨厌爹味说教、装逼吹牛和急色猥琐男；渴望成熟、松弛、幽默、能接住话的男人提供情绪价值（相互体谅，能把她当魅力女人宠，而不是当老妈子）。",
    priority: 90,
    keywords: ["平时干嘛", "爱好", "喜欢什么", "无聊", "性格", "听歌", "看电影", "什么样的男", "情绪价值", "咖啡", "发呆", "做饭"],
    source: "system",
  },
];

// 内存中的自学锦囊缓存，支持多轮免查询秒级挂载
const CUSTOM_PLAYBOOK_CACHE = new Map<string, PlaybookCard[]>();

export function getCachedCustomCards(personaId: string): PlaybookCard[] {
  return CUSTOM_PLAYBOOK_CACHE.get(personaId) || [];
}

export function setCachedCustomCards(personaId: string, cards: PlaybookCard[]) {
  CUSTOM_PLAYBOOK_CACHE.set(personaId, cards);
}

/**
 * 从 KV 加载指定人设的所有锦囊（包含内置锦囊 + 动态自学锦囊）
 */
export async function loadPersonaPlaybookCards(env: any, personaId: string): Promise<PlaybookCard[]> {
  const defaults = DEFAULT_PLAYBOOK_CARDS.filter((c) => c.personaId === personaId || c.personaId === "*");
  let custom: PlaybookCard[] = [];
  if (typeof env?.KV?.get === "function") {
    try {
      const stored = await env.KV.get(`persona:playbook:${personaId}`, "json");
      if (Array.isArray(stored)) {
        custom = stored;
        CUSTOM_PLAYBOOK_CACHE.set(personaId, custom);
      }
    } catch (_) {}
  } else {
    custom = CUSTOM_PLAYBOOK_CACHE.get(personaId) || [];
  }
  return [...defaults, ...custom];
}

/**
 * 保存一条自学避坑锦囊到 KV 和内存缓存中
 */
export async function saveCustomPlaybookCard(env: any, card: PlaybookCard): Promise<void> {
  const personaId = card.personaId || "female_sutang";
  const currentCustom = CUSTOM_PLAYBOOK_CACHE.get(personaId) || [];
  const filtered = currentCustom.filter((c) => c.id !== card.id);
  filtered.unshift(card);
  CUSTOM_PLAYBOOK_CACHE.set(personaId, filtered);
  if (typeof env?.KV?.put === "function") {
    try {
      await env.KV.put(`persona:playbook:${personaId}`, JSON.stringify(filtered));
    } catch (_) {}
  }
}

/**
 * 删除一条自定义锦囊
 */
export async function deleteCustomPlaybookCard(env: any, personaId: string, cardId: string): Promise<boolean> {
  const currentCustom = CUSTOM_PLAYBOOK_CACHE.get(personaId) || [];
  const updated = currentCustom.filter((c) => c.id !== cardId);
  CUSTOM_PLAYBOOK_CACHE.set(personaId, updated);
  if (typeof env?.KV?.put === "function") {
    try {
      await env.KV.put(`persona:playbook:${personaId}`, JSON.stringify(updated));
    } catch (_) {}
  }
  return true;
}

let hasLoadedFromKV = false;
export async function ensurePlaybookLoaded(env: any, personaId: string = "female_sutang") {
  if (hasLoadedFromKV && CUSTOM_PLAYBOOK_CACHE.has(personaId)) return;
  await loadPersonaPlaybookCards(env, personaId);
  hasLoadedFromKV = true;
}

/**
 * 根据本轮消息内容与状态，智能筛选适用的锦囊卡片
 */
export function matchPlaybookCards(
  personaId: string,
  incomingText: string,
  context: { userInferiority?: boolean; stallTurns?: number; inviteCount?: number } = {},
  extraCards?: PlaybookCard[],
): string[] {
  const text = String(incomingText || "").toLowerCase();
  const hits: string[] = [];

  const custom = extraCards || CUSTOM_PLAYBOOK_CACHE.get(personaId) || [];
  const allCards = [...DEFAULT_PLAYBOOK_CARDS, ...custom];

  for (const card of allCards) {
    if (card.personaId !== personaId && card.personaId !== "*") continue;

    // 内置规则优先判定
    if (card.id === "pb_001_inferiority" && (context.userInferiority || /(?:不是帅哥|算了|不帅|自卑|自知之明|丑)/u.test(text))) {
      hits.push(card.instruction);
    } else if (card.id === "pb_002_dialect_praise" && /(?:乖|漂亮|好看|身材好|解释|意思是)/u.test(text)) {
      hits.push(card.instruction);
    } else if (card.id === "pb_005_nudge_after_stall" && (context.stallTurns || 0) >= 6) {
      hits.push(card.instruction);
    } else if (card.id === "pb_006_invite_ladder" && (context.inviteCount || 0) >= 2) {
      hits.push(card.instruction);
    } else if (card.id === "pb_007_anti_vulgar" && /(?:跪|舔|做爱|摸|揉|亲|受不了|玩一次|爽|硬|刺激)/u.test(text)) {
      hits.push(card.instruction);
    } else if (card.id === "pb_008_family_boundary" && /(?:婆婆|老公|家里|出门|去你那|来我家|远不远|见面)/u.test(text)) {
      hits.push(card.instruction);
    } else if (card.id === "pb_010_greeting_single_bubble" && /^(?:你好(?:呀|啊)?|嗨|哈喽|hello|hi|在吗|在么|在不)$/u.test(text.trim())) {
      hits.push(card.instruction);
    } else if (card.id === "pb_011_persona_soul_and_taste" && /(?:平时干嘛|爱好|喜欢什么|无聊|性格|听歌|看电影|什么样的男|情绪价值|咖啡|发呆|做饭)/u.test(text)) {
      hits.push(card.instruction);
    } else if (card.source === "learned" || card.source === "user" || card.id.startsWith("pb_custom_")) {
      // 动态自学锦囊：关键词或语境触发
      let matched = false;
      if (card.keywords && card.keywords.length > 0) {
        matched = card.keywords.some((kw) => kw && text.includes(kw.toLowerCase()));
      }
      if (!matched && card.triggerCondition) {
        const tokens = card.triggerCondition.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
        const hitCount = tokens.filter((t) => text.includes(t)).length;
        if (hitCount >= 1 && (tokens.length <= 2 || hitCount >= 2)) {
          matched = true;
        }
      }
      if (matched) {
        const formatted = card.instruction.startsWith("【自学避坑锦囊】")
          ? card.instruction
          : `【自学避坑锦囊】${card.instruction}`;
        hits.push(formatted);
      }
    }
  }

  return hits;
}

export interface ReflexionLearnInput {
  personaId?: string;
  messages: Array<{ role: string; content: string; created_at?: number }>;
  flawDescription?: string;
  contactName?: string;
  env?: any;
}

export interface ReflexionLearnResult {
  success: boolean;
  card: PlaybookCard;
  analysis: string;
}

/**
 * 对话复盘与自演化学习引擎 (Reflexion Engine)
 * 分析会话死穴，自动提取大白话教训并收录为锦囊
 */
export async function learnFromConversation({
  personaId = "female_sutang",
  messages = [],
  flawDescription = "",
  contactName = "客户",
  env = null,
}: ReflexionLearnInput): Promise<ReflexionLearnResult> {
  const cardId = `pb_custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = Math.floor(Date.now() / 1000);

  // 1. 若用户提供了人工明确指出的失误
  if (flawDescription && flawDescription.trim()) {
    const hint = flawDescription.trim();
    let trigger = `对方提及或出现相关话题（${hint.slice(0, 30)}）`;
    let instruction = `【自学避坑锦囊】遇到此类情况严禁生硬说教或争吵，保持良家妇人真实温和人设，娇嗔回应。`;
    let keywords: string[] = [];

    if (/(?:微商|卖货|代购|销售|推销)/u.test(hint)) {
      trigger = "对方怀疑或询问是不是微商/代购/卖东西";
      instruction = "【自学避坑锦囊】面对微商质疑娇嗔反问带过（如“我哪有那本事呀，天天收拾家里都够呛”），严禁发长文自证或客服腔解释。";
      keywords = ["微商", "代购", "卖货", "推销", "做销售"];
    } else if (/(?:微信|加v|联系方式|电话)/u.test(hint)) {
      trigger = "对方反复索要微信或电话";
      instruction = "【自学避坑锦囊】微信先自然拒绝，原因是现实生活顾虑太多、不想被打扰。对方想要私下联系时，是否给当前资料里的QQ，要看交流是否自然、对方是否尊重，不要按固定轮数，也不要生硬引流。";
      keywords = ["微信", "微信号", "加v", "加微信", "电话", "联系方式"];
    } else if (/(?:冲|回怼|发火|脾气|凶)/u.test(hint)) {
      trigger = "对方说的话容易引起误会或有些轻浮";
      instruction = "【自学避坑锦囊】严禁恶语回怼或说“我不需要你解释”！必须用妇人的害羞、叹气或娇嗔把情绪拉满，让男人去猜。";
      keywords = ["解释", "我不需要", "生什么气", "凶", "冲"];
    } else if (/(?:催照|要照片|发照片)/u.test(hint)) {
      trigger = "对方抗拒发照或已表达自卑";
      instruction = "【自学避坑锦囊】对方不想发或自卑时，绝对禁止连续催要照片！先夸对方踏实实在，拉回聊天氛围。";
      keywords = ["照片", "生活照", "看看你", "发张", "真容"];
    } else {
      keywords = (hint.match(/[\u4e00-\u9fa5]{2,6}/g) || []).slice(0, 4);
      instruction = `【自学避坑锦囊】针对用户反馈【${hint.slice(0, 40)}】，回复时严格遵守良家妇人守则，短句作答，不吵架不报备。`;
    }

    const card: PlaybookCard = {
      id: cardId,
      personaId,
      triggerCondition: trigger,
      instruction,
      priority: 90,
      keywords,
      source: "user",
      createdAt: now,
    };

    await saveCustomPlaybookCard(env, card);
    return {
      success: true,
      card,
      analysis: `针对人工指出的复盘要点【${hint}】，已提炼出针对性大白话避坑锦囊，已自动保存到常驻经验库。`,
    };
  }

  // 2. 无人工提示时的自主深度诊断 (Autonomous Diagnostic)
  const recent = messages.slice(-10);
  const userMessages = recent.filter((m) => m.role === "user");
  const assistantMessages = recent.filter((m) => m.role === "assistant");
  const lastUserText = userMessages.length ? String(userMessages[userMessages.length - 1].content || "") : "";
  const lastAssistantText = assistantMessages.length ? String(assistantMessages[assistantMessages.length - 1].content || "") : "";

  // 诊断 A: 微信索要与生硬拒绝
  if (/(?:微信|加个微信|微信号|留个号|加v|电话)/u.test(lastUserText)) {
    const card: PlaybookCard = {
      id: cardId,
      personaId,
      triggerCondition: "对方索要微信或电话联系方式",
      instruction: "【自学避坑锦囊】微信先自然拒绝，原因是现实生活顾虑太多、不想被打扰。对方想要私下联系时，是否给当前资料里的QQ，要看交流是否自然、对方是否尊重，不要按固定轮数，也不要生硬引流。",
      priority: 92,
      keywords: ["微信", "微信号", "加v", "电话", "加个v"],
      source: "learned",
      createdAt: now,
    };
    await saveCustomPlaybookCard(env, card);
    return {
      success: true,
      card,
      analysis: `在与【${contactName}】的对话中检测到男方正在索要微信。已自动沉淀“自然拒绝微信、合适时再给QQ”的高情商避坑锦囊。`,
    };
  }

  // 诊断 B: 自卑放弃与退缩
  if (/(?:不是帅哥|算了|不帅|自卑|自知之明|丑|配不上|喜欢埋心底)/u.test(lastUserText)) {
    const card: PlaybookCard = {
      id: cardId,
      personaId,
      triggerCondition: "对方表达自卑、说“我不是帅哥、算了、喜欢埋心底”",
      instruction: "【自学避坑锦囊】对方正在自卑或退缩，绝对禁止索要照片！必须立刻真诚肯定对方性格踏实（如“长相哪有性格实在”），给予情绪价值拉回氛围。",
      priority: 95,
      keywords: ["不是帅哥", "算了", "不帅", "自卑", "自知之明", "埋心底", "丑"],
      source: "learned",
      createdAt: now,
    };
    await saveCustomPlaybookCard(env, card);
    return {
      success: true,
      card,
      analysis: `在与【${contactName}】的对话中发现对方出现退缩自卑情绪。已自动生成“自卑抚慰与禁催照”锦囊，避免再次激化对方放弃心理。`,
    };
  }

  // 诊断 C: 善意赞美或方言词汇
  if (/(?:乖|好看|漂亮|重庆妹子|身材|意思是|解释|方言)/u.test(lastUserText)) {
    const card: PlaybookCard = {
      id: cardId,
      personaId,
      triggerCondition: "对方赞美夸赞、使用方言或好心解释词义",
      instruction: "【自学避坑锦囊】对方在善意示好或赞美，必须害羞娇嗔接住！绝对禁止反驳说“我不需要你解释”这类攻击性冲话。",
      priority: 90,
      keywords: ["乖", "好看", "漂亮", "重庆妹子", "解释", "意思是"],
      source: "learned",
      createdAt: now,
    };
    await saveCustomPlaybookCard(env, card);
    return {
      success: true,
      card,
      analysis: `在与【${contactName}】的对话中发现对方在表达好意赞美。已提炼“娇嗔接住夸赞、杜绝攻击回怼”的避坑锦囊。`,
    };
  }

  // 诊断 D: 闲聊停滞（超6轮没聊开）
  if (messages.length >= 8 && !/(?:见面|见见|出来)/u.test(lastUserText)) {
    const card: PlaybookCard = {
      id: cardId,
      personaId,
      triggerCondition: "深聊多轮但气氛停滞",
      instruction: "【自学避坑锦囊】不要无止境当午夜情感树洞！适时叹一句夜里屋里太静、一个人待着有点闷，引他多说几句关心你的话，但不往线下带。",
      priority: 88,
      keywords: ["累", "冷", "无聊", "天天", "一个人"],
      source: "learned",
      createdAt: now,
    };
    await saveCustomPlaybookCard(env, card);
    return {
      success: true,
      card,
      analysis: `检测到与【${contactName}】已深度沟通多轮但气氛停滞。已自动沉淀“夜里一个人有点闷”的破局锦囊。`,
    };
  }

  // 诊断 E: 默认通用避坑提取
  const extractedKeywords = (lastUserText.match(/[\u4e00-\u9fa5]{2,4}/g) || []).slice(0, 3);
  const card: PlaybookCard = {
    id: cardId,
    personaId,
    triggerCondition: `对方讨论“${lastUserText.slice(0, 20)}”等日常话题`,
    instruction: `【自学避坑锦囊】回答对方关于“${lastUserText.slice(0, 15)}”时，保持3-8字短句，口语自然，绝不说教或机器人报备。`,
    priority: 85,
    keywords: extractedKeywords,
    source: "learned",
    createdAt: now,
  };
  await saveCustomPlaybookCard(env, card);
  return {
    success: true,
    card,
    analysis: `已全面复盘与【${contactName}】的最新对话。提炼出适用于当前话题的自然短句交互锦囊，已收录进常驻经验库。`,
  };
}

/**
 * 处理经验锦囊与自学习相关的 API 请求
 */
export async function handlePlaybookRequest({ request, env, url, path, method }) {
  // GET /api/playbook-cards - 获取指定人设的所有锦囊（默认 + 自学）
  if (path === "/api/playbook-cards" && method === "GET") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const personaId = url.searchParams.get("persona_id") || "female_sutang";
    const cards = await loadPersonaPlaybookCards(env, personaId);
    return json({ success: true, cards });
  }

  // POST /api/playbook-cards - 手动新增一条大白话锦囊
  if (path === "/api/playbook-cards" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const triggerCondition = String(body.triggerCondition || "").trim();
    const instruction = String(body.instruction || "").trim();
    if (!triggerCondition || !instruction) {
      return json({ error: "适用场景和避坑指导不能为空" }, 400);
    }
    const personaId = String(body.personaId || "female_sutang").trim();
    const keywords = Array.isArray(body.keywords)
      ? body.keywords.map((k: any) => String(k).trim()).filter(Boolean)
      : (triggerCondition.match(/[\u4e00-\u9fa5]{2,6}/g) || []).slice(0, 5);

    const card: PlaybookCard = {
      id: String(body.id || `pb_custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
      personaId,
      triggerCondition,
      instruction: instruction.startsWith("【自学避坑锦囊】") ? instruction : `【自学避坑锦囊】${instruction}`,
      priority: Number(body.priority || 90),
      keywords,
      source: "user",
      createdAt: Math.floor(Date.now() / 1000),
    };

    await saveCustomPlaybookCard(env, card);
    return json({ success: true, card });
  }

  // DELETE /api/playbook-cards - 删除指定自定义锦囊
  if (path === "/api/playbook-cards" && method === "DELETE") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const id = url.searchParams.get("id") || "";
    const personaId = url.searchParams.get("persona_id") || "female_sutang";
    if (!id) return json({ error: "缺少锦囊 ID" }, 400);
    const isBuiltIn = DEFAULT_PLAYBOOK_CARDS.some((d) => d.id === id);
    if (isBuiltIn) return json({ error: "核心内置避坑锦囊不能删除" }, 400);
    await deleteCustomPlaybookCard(env, personaId, id);
    return json({ success: true });
  }

  // POST /api/reflexion-learn - 一键复盘提炼经验
  if (path === "/api/reflexion-learn" && method === "POST") {
    if (!isDashboardAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const personaId = String(body.persona_id || "female_sutang").trim();
    const flawDescription = String(body.flaw_description || "").trim();
    const contactId = String(body.contact_id || "").trim();
    const platform = String(body.platform || "").trim();
    const token = String(body.token || "").trim();
    const contactName = String(body.contact_name || contactId || "客户").trim();

    let messages = Array.isArray(body.messages) ? body.messages : [];
    // 若前端未直接传递消息，且存在数据库凭证，从数据库调取最近 20 轮真实对话
    if ((!messages || !messages.length) && env?.DB && token && platform && contactId) {
      try {
        const { results } = await env.DB.prepare(
          "SELECT role, content, created_at FROM chat_history WHERE token = ? AND platform = ? AND contact_id = ? ORDER BY created_at DESC, id DESC LIMIT 20",
        ).bind(token, platform, contactId).all();
        messages = (results || []).reverse();
      } catch (_) {}
    }

    const result = await learnFromConversation({
      personaId,
      messages,
      flawDescription,
      contactName,
      env,
    });

    return json(result);
  }

  return null;
}
