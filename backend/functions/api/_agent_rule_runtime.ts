import { DEFAULT_AGENT_RULES } from "./_agent_rule_inventory";
import {
  type AgentRuleState,
  type ActiveAgentRule,
  buildAgentRuleState,
  buildCustomAgentRulesPrompt,
  describeAgentRuleEdit,
} from "./_agent_rule_contract";
import { emptyFunnelState } from "./_funnel";
import {
  buildModelHeaders,
  buildModelRequestPayload,
  isGeminiModelConfig,
  loadLlmConfig,
} from "./_model_runtime";
import { buildLayeredSystemPrompt } from "./_reply_policy";
import { matchActiveDrawers } from "./_persona_drawers";
import {
  createTimeoutSignal,
  isAbortError,
  upstreamErrorDetail,
} from "./_http_runtime";
import { getChinaTimeContext } from "./_time_runtime";

const AGENT_RULE_GATES = new Set(["input", "prompt", "output", "execution"]);

export function normalizeAgentRuleGate(value, fallback = "prompt") {
  const gate = String(value || "").trim().toLowerCase();
  return AGENT_RULE_GATES.has(gate) ? gate : fallback;
}

export async function ensureAgentRulesSeeded(db) {
  const { results } = await db.prepare(
    "SELECT legacy_rule_id FROM agent_rules WHERE legacy_rule_id <> ''"
  ).all();
  const existing = new Set(
    (results || []).map((row) => String(row?.legacy_rule_id || "")).filter(Boolean),
  );
  const missing = DEFAULT_AGENT_RULES.filter((rule) => !existing.has(String(rule.id)));
  if (!missing.length) return;
  const now = Math.floor(Date.now() / 1000);
  await db.batch(missing.map((rule) => db.prepare(
    "INSERT OR IGNORE INTO agent_rules (id, legacy_rule_id, persona_id, title, detail, gate, priority, enabled, sort_order, source, created_at, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    `legacy_${rule.id}`,
    rule.id,
    rule.persona_id,
    rule.title,
    rule.detail,
    rule.gate,
    rule.priority,
    rule.enabled ? 1 : 0,
    rule.sort_order,
    rule.source,
    now,
    now,
  )));
}

export async function listAgentRules(db, includeDeleted = false) {
  await ensureAgentRulesSeeded(db);
  const { results } = await db.prepare(
    "SELECT id, legacy_rule_id, persona_id, title, detail, gate, priority, enabled, sort_order, source, created_at, updated_at, deleted_at " +
    `FROM agent_rules${includeDeleted ? "" : " WHERE deleted_at = 0"} ORDER BY priority DESC, sort_order ASC, created_at ASC`
  ).all();
  return (results || []).map((row) => {
    const rule = {
      ...row,
      enabled: Number(row.enabled || 0) === 1,
      priority: Number(row.priority || 50),
      sort_order: Number(row.sort_order || 0),
    } as ActiveAgentRule;
    return {
      ...rule,
      ...describeAgentRuleEdit(rule),
    };
  });
}

export async function loadAgentRuleState(
  db,
  personaId = "",
): Promise<AgentRuleState> {
  await ensureAgentRulesSeeded(db);
  const { results } = await db.prepare(
    "SELECT id, legacy_rule_id, persona_id, title, detail, gate, priority, enabled, sort_order, source, created_at, updated_at, deleted_at " +
    "FROM agent_rules ORDER BY priority DESC, sort_order ASC, created_at ASC"
  ).all();
  const rules = (results || []).map((row) => ({
    ...row,
    enabled: Number(row.enabled || 0) === 1,
    priority: Number(row.priority || 50),
    sort_order: Number(row.sort_order || 0),
    deleted_at: Number(row.deleted_at || 0),
  })) as ActiveAgentRule[];
  return buildAgentRuleState(rules, personaId);
}

export function buildAgentRulesPrompt(state: AgentRuleState, personaId = "") {
  return buildCustomAgentRulesPrompt(state, personaId);
}

export const RULE_PREVIEW_CASES: Record<string, { original: string; merged: string }> = {
  facts_consistency: {
    original:
      "【结构化事实高于人设正文】年龄、婚否、子女、城市以资料为准。\n" +
      "【不能自行补身份事实】不能编年龄、婚姻、子女、城市、联系方式。\n" +
      "【历史生活细节不能改口】已经确认的生活细节不能改口。",
    merged:
      "【已确认事实优先】年龄、婚否、子女、城市和已确认的生活事实只能按资料回答，不能自行补写、改口或编造。",
  },
  reply_shape: {
    original:
      "【固定 JSON 输出】\n" +
      "【1到3条完整短消息】\n" +
      "【每条目标20字，硬顶25字】",
    merged:
      "只返回 JSON 对象：{\"messages\":[\"第一条完整短句\",\"第二条完整短句\"]}。messages 只能1到3条，每条目标3到20个字，硬上限25个字，总共不超过60个字。只在自然换意处分条，不许把一句话从中间切开，不许把两条粘成一条。",
  },
  old_message: {
    original:
      "【补答旧消息只处理现在这条】隔久了只接最新一句，不翻旧话题。\n" +
      "【不主动汇报自己刚才在忙什么】除非隔夜或对方明确问，不拿“刚忙完、单子多”当开场。",
    merged:
      "只接对方最新一句；不主动解释、不主动道歉、不主动汇报自己在忙什么。",
  },
  non_user_input: {
    original:
      "【互动表情按虚拟表情理解】表情包和互动表情代表情绪，不把“摸了摸头”当成真实动作。\n" +
      "【平台提示不是客户消息】送礼、系统通知、已读回执、正在输入等内容不能当成客户的话来接。",
    merged:
      "【非客户消息输入整理】平台提示、系统通知、已读回执、正在输入等内容直接忽略。表情包按常见含义理解，互动表情只当虚拟表情，不能当成真实动作。图片和语音没有识别结果时不能猜内容。",
  },
  photo_execution: {
    original:
      "【照片只回应明确请求】普通聊天不主动发图，对方明确要看照片时才进入发图流程。\n" +
      "【按图库主题选择发送】只能按系统选中的图库分组和素材发，不能自己编图片。",
    merged:
      "【照片发送】只有对方明确想看照片，并且系统选中了允许的图库分组时才能发图。不能主动发图，不能自己编图片或图片编号。",
  },
  history_budget: {
    original:
      "【重复历史先清理】同一句重复出现时先去重。\n" +
      "【较早历史压成摘要】较早历史压成摘要，不能无限增长。\n" +
      "【关键词卡片每轮最多两张】关键词卡片限制数量，避免提示词无限变长。",
    merged:
      "【上下文预算】历史先去重，较早内容压成摘要；每轮关键词卡片有数量上限，避免旧内容和无关卡片无限进入上下文。",
  },
};

export async function runRawRulePreviewLine({ env, line, systemPrompt, userText }) {
  const primaryConfig = await loadLlmConfig(env.KV, env, line);
  const callWithConfig = async (modelConfig, apiKey) => {
    const usingGemini = isGeminiModelConfig(modelConfig);
    if (!apiKey) return { ok: false, error: usingGemini ? "线路B未配置" : "线路A未配置" };
    const response = await fetch(modelConfig.baseUrl + "/chat/completions", {
      method: "POST",
      headers: buildModelHeaders(apiKey, modelConfig),
      body: JSON.stringify(buildModelRequestPayload(
        modelConfig,
        modelConfig.modelName,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
        0.35,
        usingGemini ? 320 : 140,
      )),
      signal: createTimeoutSignal(12_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        error: await upstreamErrorDetail(response) || "模型连接失败",
        upstream_status: response.status,
      };
    }
    const data = await response.json();
    const reply = String(data?.choices?.[0]?.message?.content || "").trim();
    return reply ? { ok: true, reply } : { ok: false, error: "模型没有返回内容" };
  };
  try {
    const primaryKey = isGeminiModelConfig(primaryConfig)
      ? (primaryConfig.apiKeyOverride || env.GEMINI_API_KEY || "")
      : (env.DEEPSEEK_API_KEY || "");
    const primary = await callWithConfig(primaryConfig, primaryKey);
    if (primary.ok || line !== "b") return primary;
    const detail = String(primary.error || "");
    if (!/location is not supported|region|地区/iu.test(detail) || !env.DEEPSEEK_API_KEY) {
      return primary;
    }
    const fallbackConfig = {
      ...primaryConfig,
      provider: "deepseek",
      baseUrl: String(env.DEEPSEEK_API_BASE || "https://api.deepseek.com/v1").replace(/\/+$/u, ""),
      modelName: "deepseek-v4-pro",
    };
    const fallback = await callWithConfig(fallbackConfig, env.DEEPSEEK_API_KEY);
    return fallback.ok
      ? { ...fallback, fallback_from: "line_b_region_blocked", fallback_model: "deepseek-v4-pro" }
      : { ...fallback, fallback_from: "line_b_region_blocked", primary_error: detail };
  } catch (error) {
    return { ok: false, error: isAbortError(error) ? "试聊超时" : "试聊失败" };
  }
}

export async function runAgentPreviewLine({
  env,
  line,
  persona,
  facts,
  cards,
  question,
  agentRuleState = undefined,
}) {
  const modelConfig = await loadLlmConfig(env.KV, env, line);
  const usingGemini = isGeminiModelConfig(modelConfig);
  const apiKey = usingGemini
    ? (modelConfig.apiKeyOverride || env.GEMINI_API_KEY || "")
    : (env.DEEPSEEK_API_KEY || "");
  if (!apiKey) return { ok: false, error: usingGemini ? "线路B未配置" : "线路A未配置" };
  const chinaTime = getChinaTimeContext();
  const systemPrompt = buildLayeredSystemPrompt({
    personaId: persona.id,
    personaPrompt: persona.system_prompt || "",
    personaFacts: facts,
    platform: "soul",
    profileContext: "",
    currentDatetime: chinaTime.currentDatetime,
    weekday: chinaTime.weekday,
    homeLocation: {
      city: facts.current_city || "重庆",
      district: facts.current_district || "两江新区",
    },
    workLocation: {
      city: facts.work_city || "重庆",
      district: facts.work_district || "江北区",
    },
    weather: null,
    weatherEnabled: false,
    timeEnabled: false,
    stageText: "当前是试聊预览，只检查人设、事实、语气和边界是否一致。",
    relationStageLevel: 1,
    messageDelay: null,
    messages: [{ role: "user", content: question }],
    historyMessages: [],
    conversationTimeline: "",
    memorySummary: "",
    evaluationQuoteSent: false,
    funnelState: emptyFunnelState(),
    contactRequest: false,
    mediaGroups: [],
    mediaActionsEnabled: false,
    matchedDrawerTips: matchActiveDrawers({ custom: cards || [] }, question),
    agentRuleState,
  });
  try {
    const response = await fetch(modelConfig.baseUrl + "/chat/completions", {
      method: "POST",
      headers: buildModelHeaders(apiKey, modelConfig),
      body: JSON.stringify(buildModelRequestPayload(
        modelConfig,
        modelConfig.modelName,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
        0.4,
        usingGemini ? 512 : 180,
      )),
      signal: createTimeoutSignal(12_000),
    });
    if (!response.ok) {
      return { ok: false, error: await upstreamErrorDetail(response) || "模型连接失败" };
    }
    const data = await response.json();
    const reply = String(data?.choices?.[0]?.message?.content || "").trim();
    return reply ? { ok: true, reply } : { ok: false, error: "模型没有返回内容" };
  } catch (error) {
    return { ok: false, error: isAbortError(error) ? "试聊超时" : "试聊失败" };
  }
}
