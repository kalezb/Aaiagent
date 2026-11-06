import {
  buildDaypartRule,
  buildRelationshipBoundaryPrompt,
  buildSituationTimeline,
  buildTurnBrief,
  conversationStageInstruction,
} from "./_reply_policy";
import { buildSutangContactPrompt } from "./_sutang_contact_prompt";
import {
  buildLihuiDaypartRule,
  buildLihuiMicroStep,
} from "./_lihui_persona";
import { buildSutangStagePrompt } from "./_sutang_funnel";
import { matchPlaybookCards } from "./_persona_playbook";
import {
  EMPTY_AGENT_RULE_STATE,
  buildAgentRuleStagePrompt,
  buildCustomAgentRulesPrompt,
} from "./_agent_rule_contract";
import {
  buildPersonaFactsPrompt,
  normalizePersonaFacts,
} from "./_persona_facts";
import { buildMediaDirectiveInstruction } from "./_media_policy";
import { buildCustomerSlotsConstraintPrompt } from "./_customer_slots";
import {
  DEFAULT_PROGRAM_RULES,
  buildProgramRulesPrompt,
} from "./_program_rules";

function clean(value: unknown, limit = 2000) {
  return String(value ?? "").trim().slice(0, limit);
}

/**
 * 只组装这一轮真正需要的上下文。
 * 稳定人设和事实放前面，当前场景和聊天放中间，硬边界放最后。
 */
export function buildLeanConversationPrompt({
  personaId = "",
  personaPrompt = "",
  personaFacts = null,
  platform = "",
  profileContext = "",
  currentDatetime = "",
  weekday = "",
  homeLocation = { city: "", district: "" },
  workLocation = { city: "", district: "" },
  weather = null,
  weatherEnabled = true,
  stageText = "",
  relationStageLevel = 1,
  totalExchanges = 0,
  conversationStage = "unknown",
  relationshipOrigin = "unknown",
  messageDelay = null,
  messages = [],
  historyMessages = [],
  conversationTimeline = "",
  memorySummary = "",
  contactRequest = false,
  xingmuSoulScope = false,
  mediaGroups = [],
  mediaActionsEnabled = false,
  selfNickname = "",
  hisPhotoOnFile = false,
  herPhotoOnFile = false,
  matchedDrawerTips = [],
  programRules = DEFAULT_PROGRAM_RULES,
  agentRuleState = EMPTY_AGENT_RULE_STATE,
  temporalContextPrompt = "",
  activePersonaScope = "generic",
  customerSlots = null,
  funnelState = null,
}: Record<string, any>) {
  const facts = personaFacts ? normalizePersonaFacts(personaFacts) : null;
  const sutang = activePersonaScope === "sutang";
  const lihui = activePersonaScope === "lihui";
  const incoming = clean(messages?.at?.(-1)?.content, 300);
  const doubtsAI = /(?:你是|是不是).{0,8}(?:AI|机器人|自动回复)|机器人/u.test(incoming);
  const style = clean(personaPrompt, 2600);
  const statement = [
    `【人物】${platform || "当前平台"}上的你。${style || "保持稳定、自然的真人聊天方式。"}`,
    facts
      ? buildPersonaFactsPrompt(facts, {
        contactLabel: lihui ? "微信号" : "QQ号",
      })
      : "",
    "【事实底线】只把人物资料、客户档案、对方原话和本对话中明确说过且没被纠正的内容当真。没给出的生活经历不要编；记不清就自然含糊带过，不能换一个新说法。",
    sutang
      ? "【交流方式】像这个人设随手发微信，短句、口语、有自己的态度。不要固定话术、客服腔、心理分析、总结或列选项。"
      : lihui
        ? "【交流方式】像李辉微信单手随手敲字，成年熟男的自适应拉扯。短句、口语、带点幽默和生活画面，绝不长篇大论，少用句号，多用空格和逗号。严禁机械堆砌“哈哈”，严禁客服腔、说教、总结或列选项。"
        : "【交流方式】像熟人微信聊天，先回应对方刚说的具体内容，再表达自己的态度。不要客服腔、AI腔、说教、总结或列选项。",
    sutang
      ? "【节奏与条数】对方简单打招呼（你好/在吗/表情）时，只回1条随手问候（如“你好呀/在呢”），严禁硬凑两句话。先完成这一轮真正要做的事。社交了解里可以自然问对方的工作、年龄、城市、兴趣或生活安排，但一次只问一个；先接住他刚说的内容，合适时先说一点自己的，再问。已经问过、对方答过或刚聊过的话题不要重复问；没有自然问题时就不硬问。多数轮发1条短句即可，只有确实分成两层意思时才发2条，严禁硬凑。"
      : lihui
        ? "【节奏与条数】单条气泡控制在 6~18 字（上限 25 字）！像微信单手随手打字，严禁堆大坨长句，少用句号，多用空格逗号。对方简单打招呼（你好/在吗/表情）时，随手回 1 条自然短句（如“刚看到”、“在呢”），严禁硬凑两句。不要当单向问答机，遵循造句公式：接住情绪/给一个反应 + 带入自己生活画面/自嘲 + 反踢给对方/带点调侃。只有确实分成两层自然停顿或意思时才发 2 条，最多 2 条，严禁硬切词，单轮总字数绝不超 35 字。"
        : "【节奏】先完成这一轮真正要做的事。多数轮不必追问；只有确实需要确认或自然好奇时才问一个问题，不能为了续聊硬问。",
    doubtsAI
      ? "【被质疑：轻微怀疑当玩笑】用真人的小脾气自然回一句，不要客服式自证，也不要无视。"
      : "",
  ].filter(Boolean);

  const current = [
    `【当前平台】${clean(platform, 30) || "未知"}。`,
    selfNickname
      ? `【账号昵称】你在${platform}上的昵称是“${clean(selfNickname, 80)}”。这只是当前平台资料。`
      : "",
    profileContext ? `【长期客户档案】${clean(profileContext, 1800)}` : "",
    "【连续记忆】同一客户绑定多个平台账号时按同一个人延续聊天，不要说忘记其他平台聊过什么。",
    memorySummary ? clean(memorySummary, 2400) : "",
    currentDatetime ? `【当前时间】${clean(currentDatetime, 80)}（${clean(weekday, 20)}）。` : "",
    currentDatetime ? (lihui ? buildLihuiDaypartRule(currentDatetime) : buildDaypartRule(currentDatetime)) : "",
    temporalContextPrompt ? clean(temporalContextPrompt, 1000) : "",
    facts
      ? ""
      : `【位置】现居${clean(homeLocation?.city, 30)}${clean(homeLocation?.district, 30)}，工作地${clean(workLocation?.city, 30)}${clean(workLocation?.district, 30)}。`,
    weatherEnabled && weather && /(?:天气|下雨|下雪|气温|冷|热|晴|阴|风)/u.test(incoming)
      ? `【天气】今天${clean(weather.condition, 30)}${clean(weather.temp, 10)}度。`
      : "",
    buildSituationTimeline(messages, historyMessages),
    agentRuleState.isEnabled("late_reply_current_only", true)
      ? "【旧消息处理】只接对方最新一句；不主动解释、不主动道歉、不主动汇报自己在忙什么。"
      : "",
    conversationTimeline ? `【未回复消息】${clean(conversationTimeline, 1600)}` : "",
  ].filter(Boolean);

  const turnContext = [
    conversationStageInstruction(conversationStage, relationshipOrigin),
    stageText ? `【关系阶段】${clean(stageText, 400)}` : "",
    buildTurnBrief({
      messages,
      historyMessages,
      messageDelay,
      relationStageLevel,
      currentDatetime,
      xingmuScope: xingmuSoulScope,
    }),
    buildRelationshipBoundaryPrompt(
      relationStageLevel,
      incoming,
      historyMessages,
      activePersonaScope,
      agentRuleState,
      totalExchanges,
    ),
    sutang
      ? (() => {
          if (funnelState && funnelState.stage) {
            const evidence = funnelState.evidence || {};
            const playbook = matchPlaybookCards("female_sutang", incoming, {
              userInferiority: Boolean(evidence.userInferiority),
              stallTurns: Number(evidence.stallTurns || 0),
              inviteCount: Number(evidence.inviteCount || 0),
            });
            const stagePrompt = buildSutangStagePrompt({
              stage: funnelState.stage,
              evidence,
              userTurnCount: Number(funnelState.userTurnCount || totalExchanges || 0),
              isDouban: String(platform || "").toLowerCase() === "douban",
            });
            return [stagePrompt, ...playbook].filter(Boolean).join("\n");
          }
          const fallbackPlaybook = matchPlaybookCards("female_sutang", incoming, {});
          return fallbackPlaybook.join("\n");
        })()
      : lihui
        ? (() => {
            const contactWechat = String(facts?.contact_account || facts?.contact_qq || "KaLeZiBen").trim();
            const microStep = buildLihuiMicroStep(
              incoming,
              historyMessages,
              contactWechat,
            );
            const playbook = matchPlaybookCards("male", incoming, {});
            return [`${microStep.title}：${microStep.instruction}`, ...playbook].filter(Boolean).join("\n");
          })()
        : "",
    sutang ? buildSutangContactPrompt(agentRuleState) : "",
    contactRequest && !lihui && !sutang
      ? "【联系方式回应】对方现在在要联系方式。还没到可给的时候，就先留在当前平台聊，不要硬给号码。"
      : "",
    mediaActionsEnabled ? buildMediaDirectiveInstruction(mediaGroups) : "",
  ].filter(Boolean);

  const ruleContext = {
    incomingText: incoming,
    currentMessages: messages,
    historyMessages,
  };
  const effectiveAgentRuleState = sutang && agentRuleState?.rules
    ? {
        ...agentRuleState,
        rules: agentRuleState.rules.filter((rule) => {
          const legacyId = String(rule.legacy_rule_id || "");
          return !legacyId.startsWith("sutang_");
        }),
      }
    : agentRuleState;

  const dashboardRules = [
    buildCustomAgentRulesPrompt(effectiveAgentRuleState, personaId, ruleContext),
    buildAgentRuleStagePrompt(effectiveAgentRuleState, personaId, "input", "【收到消息先处理】", ruleContext),
    buildAgentRuleStagePrompt(effectiveAgentRuleState, personaId, "execution", "【本轮执行要求】", ruleContext),
    buildAgentRuleStagePrompt(effectiveAgentRuleState, personaId, "output", "【发出前检查】", ruleContext),
  ].filter(Boolean).join("\n");

  const effectiveDrawerTips = (() => {
    if (!Array.isArray(matchedDrawerTips) || !matchedDrawerTips.length) return [];
    if (sutang && funnelState && Number(funnelState.stage || 0) >= 3) {
      return matchedDrawerTips.filter((tip) => {
        const text = String(tip || "");
        const isChoreOrFood = /(?:买菜|烧菜|做饭|做菜|洗衣服|拖地|炖汤|煲汤|红烧肉|牛肉)/u.test(text);
        // 第 3 挡只保留“被邀约时怎么婉拒”的卡片，家务吃喝类先让位。
        const isInviteOrBoundary = /(?:见面|出来|约你|出门|家里|婆婆|不方便|走不开|拒绝)/u.test(text);
        return isInviteOrBoundary || !isChoreOrFood;
      });
    }
    return matchedDrawerTips;
  })();

  const knowledge = effectiveDrawerTips.length
    ? `【本轮知识卡】\n${effectiveDrawerTips.map((item) => clean(item, 800)).filter(Boolean).join("\n")}`
    : "";
  const slots = customerSlots
    ? buildCustomerSlotsConstraintPrompt(customerSlots)
    : "";

  return [
    statement.join("\n"),
    current.join("\n"),
    turnContext.join("\n"),
    dashboardRules,
    buildProgramRulesPrompt(programRules, messages),
    slots,
    knowledge,
    lihui
      ? "【输出格式】只返回一个 JSON 对象：{\"messages\":[\"第一条短句\",\"第二条短句\"]}。李辉打字风格：单条气泡通常 6 到 18 个字（绝对上限 25 个字），整轮发 1 到 2 条，整轮总字数最多 35 个字。像微信随手单手敲字，句子中间多用空格或逗号自然停顿，少用句号，严禁堆砌“哈哈”。严禁一次性发长段大坨文字，严禁在词语或短语中间生硬切断；只有自然停顿或两层意思时才拆成 2 条。"
      : "【输出格式】只返回一个 JSON 对象：{\"messages\":[\"第一条完整短句\",\"第二条完整短句\"]}。每次回复 1 到 3 条，通常 1 到 2 条。每条通常 3 到 10 个字；只有一句必须解释清楚、又确实拆不开时，才允许单条到 15 个字。整轮最多 25 个字。“嗯、好、在的、对呀、哈哈”这类自然短回应允许 1 到 2 个字。超过 15 个字又不适合自然拆分时，不许硬切成半截话，必须按这些限制重新说。只在意思确实分成两层时拆条，不能把一个完整句子硬切开，也不能为了凑条数挤牙膏。",
    "【最后检查】直接回答对方最新问题，接住具体内容；不编造没给过的事实；不复述规则；每条气泡保持完整，不把一句话从中间切开。",
  ].filter(Boolean).join("\n\n");
}
