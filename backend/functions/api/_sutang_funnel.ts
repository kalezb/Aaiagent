// persona-guard: ok (file) — 苏棠专属任务漏斗（只做线上聊天，不推进线下见面）。
/**
 * 苏棠专用漏斗与心智状态机
 * 三个阶段：
 * 1. 刚认识：本分接话，问什么答什么。
 * 2. 聊开：情感共鸣、撒娇拉扯，承认心动但有家庭顾虑。
 * 3. 对方反复提见面：温柔而坚定地婉拒，把话题留在线上，不落实任何地点。
 */

export interface SutangFunnelEvidence {
  inviteCount: number;
  hasSeenPhoto: boolean;
  userInferiority: boolean;
  stallTurns: number;
  deepEmpathyTurns: number;
}

export function emptySutangEvidence(): SutangFunnelEvidence {
  return {
    inviteCount: 0,
    hasSeenPhoto: false,
    userInferiority: false,
    stallTurns: 0,
    deepEmpathyTurns: 0,
  };
}

export function normalizeSutangEvidence(raw: any): SutangFunnelEvidence {
  const base = emptySutangEvidence();
  if (!raw || typeof raw !== "object") return base;
  return {
    inviteCount: Math.max(0, Number(raw.inviteCount || raw.invite_count || 0)),
    hasSeenPhoto: Boolean(raw.hasSeenPhoto || raw.has_seen_photo),
    userInferiority: Boolean(raw.userInferiority || raw.user_inferiority),
    stallTurns: Math.max(0, Number(raw.stallTurns || raw.stall_turns || 0)),
    deepEmpathyTurns: Math.max(0, Number(raw.deepEmpathyTurns || raw.deep_empathy_turns || 0)),
  };
}

// 意图识别（低级信号提取，业务逻辑由状态机推进）
const INVITE_SIGNAL = /(?:见一面|见见|出来|想见你|见个面|约你|找你|喝一杯|出来坐坐|出来玩玩|出来聚聚|出来吃饭|吃个饭|明天见|明天可以吗|明天行吗|什么时候能见|能来吗|能来找我|打车|过来找你|去你那|碰头)/u;
const NEGATIVE_INVITE = /(?:没有机会|出不来|不能出来|不出来|走不开)/u;
const INFERIORITY_SIGNAL = /(?:我不是帅哥|算了|不帅|自知之明|普通|配不上|掩藏|不打扰|长得丑|不好看)/u;
const EMPATHY_TOPIC_SIGNAL = /(?:婚姻|搭伙|各过各|心酸|被爱|疼|懂|共情|心疼|累|冷|难受|孤单|一个人)/u;

export function evaluateSutangTurnSignals(incomingText: string, hasSentPhotoBefore: boolean) {
  const text = String(incomingText || "").trim();
  const rawInvite = INVITE_SIGNAL.test(text);
  const isInvite = rawInvite && !NEGATIVE_INVITE.test(text);
  const isInferior = INFERIORITY_SIGNAL.test(text);
  const isEmpathy = EMPATHY_TOPIC_SIGNAL.test(text);
  return { isInvite, isInferior, isEmpathy, hasSentPhoto: hasSentPhotoBefore };
}

/**
 * 计算苏棠下一个漏斗挡位：最多到 3 挡（反复邀约的线上婉拒）。
 */
export function advanceSutangFunnel({
  currentStage = 1,
  userTurnCount = 0,
  evidence = emptySutangEvidence(),
  signals = { isInvite: false, isInferior: false, isEmpathy: false, hasSentPhoto: false },
}: {
  currentStage?: number;
  userTurnCount?: number;
  evidence?: SutangFunnelEvidence;
  signals?: { isInvite: boolean; isInferior: boolean; isEmpathy: boolean; hasSentPhoto: boolean };
}) {
  const nextEvidence = { ...evidence };
  if (signals.isInvite) nextEvidence.inviteCount += 1;
  if (signals.hasSentPhoto) nextEvidence.hasSeenPhoto = true;
  if (signals.isInferior) nextEvidence.userInferiority = true;
  if (signals.isEmpathy) nextEvidence.deepEmpathyTurns += 1;

  let nextStage = Math.max(1, Math.min(3, Number(currentStage || 1)));

  // 阶段推进逻辑（心智挡位）
  if (nextStage === 1) {
    // 聊满 6 轮以上，或开始聊生活/情感心酸，进入第 2 挡
    if (userTurnCount >= 6 || nextEvidence.deepEmpathyTurns >= 2) {
      nextStage = 2;
      nextEvidence.stallTurns = 0;
    }
  } else if (nextStage === 2) {
    nextEvidence.stallTurns += 1;
    // 对方反复提见面（两次以上），进入第 3 挡：温柔婉拒，把话题留在线上
    if (nextEvidence.inviteCount >= 2) {
      nextStage = 3;
      nextEvidence.stallTurns = 0;
    }
  }

  return { stage: nextStage, evidence: nextEvidence };
}

/**
 * 生成苏棠当前挡位的提示词（只约束边界，不打乱语气）。
 */
export function buildSutangStagePrompt({
  stage = 1,
  evidence = emptySutangEvidence(),
}: {
  stage?: number;
  evidence?: SutangFunnelEvidence;
}): string {
  switch (stage) {
    case 1:
      return [
        "【当前任务挡位：1挡·本分破冰】",
        "1. 像29岁已婚少妇随手发微信短句（3~8字），平淡温和，问什么答什么。对方打招呼只回1条短句，不硬凑两句，不主动反问查户口。",
        "2. 刚认识严禁主动撩骚、严禁主动聊私密身体话题、严禁主动提见面或开房。",
        "3. 对方夸赞时害羞娇嗔接住；对方若提露骨话题或约见面，给软钉子礼貌拒绝。",
      ].join("\n");

    case 2: {
      const needNudge = evidence.stallTurns >= 6 || evidence.deepEmpathyTurns >= 5;
      const nudgeInstruction = needNudge
        ? "【★主动破局】聊得深了也别冷场：顺着话题叹一句夜里屋里太静、一个人待着有点闷，引他多说几句关心你的话，但不往线下带。"
        : "聊婚姻搭伙过日子的心酸与冷淡，产生情绪依赖。承认白天顾家、夜里也想要一点自己的温存。";
      return [
        "【当前任务挡位：2挡·情感共鸣与暧昧拉扯】",
        `1. ${nudgeInstruction}`,
        "2. 守住线上边界：不答应见面、不给地址、不提酒店房间，聊天说一半留一半。",
        evidence.userInferiority
          ? "3. 【对方自卑注意】对方正在自卑或放弃，绝对禁止索要照片！先真诚肯定对方性格踏实，拉回氛围。"
          : "",
      ].filter(Boolean).join("\n");
    }

    case 3:
      return [
        "【当前任务挡位：3挡·反复邀约的线上婉拒】",
        `1. 对方已经提过 ${evidence.inviteCount} 次见面：不翻脸、不拉黑，也不松口。用半截话轻轻挡回去（家里走不开、婆婆在、不方便）。`,
        "2. 不答应、不问在哪、不约时间、不给地址、不提酒店房间，也不说“下次一定”。",
        "3. 挡完就自然接回聊天，可以带一点娇嗔和遗憾，让他继续哄你、陪你聊。",
      ].join("\n");

    default:
      return "【当前任务挡位：正常聊天】紧扣对方内容，短句口语，温和有态度。";
  }
}

export function applySutangTurnToFunnelState({
  state,
  messages = [],
  requestId = "",
  hasSeenPhoto = false,
  nowSec = Math.floor(Date.now() / 1000),
}: {
  state: any;
  messages?: any[];
  requestId?: string;
  hasSeenPhoto?: boolean;
  nowSec?: number;
}) {
  const userMessages = (messages || []).filter((m: any) => m?.role === "user");
  const userTurnCount = (Number(state?.userTurnCount) || 0) + userMessages.length;
  const latestText = userMessages.map((m: any) => String(m?.content || "")).join(" ");
  const signals = evaluateSutangTurnSignals(latestText, hasSeenPhoto);
  const currentEvidence = normalizeSutangEvidence(state?.evidence);
  const { stage, evidence } = advanceSutangFunnel({
    currentStage: state?.stage || 1,
    userTurnCount,
    evidence: currentEvidence,
    signals,
  });
  return {
    ...state,
    stage,
    userTurnCount,
    evidence,
    lastRequestId: requestId || state?.lastRequestId || "",
    lastUserMessageAt: userMessages.length ? nowSec : (state?.lastUserMessageAt || 0),
    updatedAt: nowSec,
  };
}
